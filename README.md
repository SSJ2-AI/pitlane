# PitLane

A Porsche dealership service-advisor dashboard wired up to **Aria**, an AI voice
agent that takes inbound and outbound calls, identifies customers from CDK
(Fortellis), records every interaction back to the dealership, schedules
appointments, and surfaces a live screen-pop on the advisor's screen.

The repo has two deployable units:

| Folder | What it is | Where it runs |
|---|---|---|
| `/` (Next.js app) | PitLane advisor dashboard + customer-facing API | Vercel |
| `voice/` | Aria voice microservice (ElevenLabs + WebSocket screen-pop + call-event store) | Railway |

## Architecture

```
   ┌──────────────────────┐
   │  Customer dials       │
   │  +1 (906) 376-0066    │
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │  Twilio → ElevenLabs  │
   │       (Aria)          │
   └──────────┬───────────┘
              │ GET /tools/customer-lookup/:phone
              ▼
   ┌──────────────────────┐       ┌─────────────────────────┐
   │  voice/ microservice  │──────▶│  PitLane Next.js        │
   │  (Railway)            │       │  GET /api/voice/        │
   │                       │       │      customer-lookup    │
   │  - call-event store   │       │  (CDK/Fortellis lookup) │
   │  - /tools/* webhooks  │◀──────│                         │
   │  - /calls/* outbound  │       └─────────────────────────┘
   │  - /events/* webhooks │                  │
   │  - WS screen-pop /ws  │                  ▼
   └──────────┬───────────┘       ┌─────────────────────────┐
              │                    │  PitLane advisor        │
              │  WebSocket         │  dashboard /dashboard   │
              └───────────────────▶│  - screen pop           │
                                   │  - call history         │
                                   │  - voice status dot     │
                                   │  - outbound call btn    │
                                   └─────────────────────────┘
```

## Multi-tenancy

Every operational table (`call_logs`, `appointments`, `upsells`,
`loaner_requests`, `sms_log`, `sms_consent`, `cdk_sync_queue`) carries a
`dealer_id` FK to the new `dealers` table. The intended deploy model is
**one Railway deploy per service + one Supabase project, hosting many
dealerships**. Twilio number → dealer routing happens in the voice
service; subdomain → dealer routing happens on the dashboard.

| Where | Resolution strategy |
|---|---|
| Voice — pre/post-call webhook | `getDealerByPhone(called_number)` → `dealers.phone_number`. Falls back to `DEFAULT_DEALER` (Porsche Toronto) when no row matches. |
| Voice — Aria tools | `resolveDealerForCall(conversation_id)` → reads `call_logs.dealer_id` set by pre-call. |
| Dashboard — every `/api/*` route | `resolveDealerForRequest(request)` → `?dealer_id=` query → `x-dealer-id` header → subdomain (`porsche-toronto.pitlane.ai` → `dealers.subdomain`) → DEFAULT. |

### Adding a new dealer

1. Provision a Twilio number.
2. Insert a `dealers` row with `phone_number`, `subdomain`, `brand`,
   `elevenlabs_agent_id` (reuse the brand-level agent), and CDK creds.
3. Point Twilio's voice webhook at the existing
   `https://<voice>/webhook/pre-call` + `https://<voice>/webhook/post-call`.
4. (Optional) Add the subdomain to your DNS / hosting so the dashboard
   resolves it.

Zero code changes. The shared agent uses dynamic variables for per-dealer
branding (`{{dealership_name}}`, `{{dealership_branch}}`,
`{{dealership_brand}}`).

### RLS (defense-in-depth)

Migration 0003 enables Row-Level Security on every tenanted table with a
`dealer_isolation_*` policy that filters by `current_setting('app.current_dealer_id')`.
The voice service and dashboard API routes use the Supabase service-role
key which *bypasses RLS*, so today's writes/reads aren't constrained by
the policy — the policy is the safety net for any future caller that
uses an anon or per-user JWT key.

## Phase 5 — SMS layer

PitLane sends transactional SMS through Twilio via two endpoints, both backed
by a single dispatcher (`voice/src/lib/sms.ts`) that:

1. Renders one of seven canonical templates (or echoes a `custom_text`).
2. Checks `sms_consent.opted_in` for the customer.
3. Calls Twilio via `voice/src/lib/twilio.ts` (dry-runs when `TWILIO_*` env
   vars are unset).
4. Writes an `sms_log` row with the Twilio SID, status, and FK back-refs to
   the originating call_log / appointment / loaner_request.

| Route | Caller | Purpose |
|---|---|---|
| `POST /sms/send` | PitLane dashboard, internal | Generic dispatcher. Accepts `customer_id` or `to_phone`, any `message_type`, optional `custom_text` override, `context` bag. |
| `POST /tools/send-sms` | Aria (ElevenLabs) | Mid-call tool. `customer_id` + `message_type` (+ optional `custom_text` + `context`). Records a `NOTE_ADDED` event on the call. |

Message types: `appointment_confirmation`, `appointment_reminder`,
`loaner_confirmed`, `car_ready`, `parts_arrived`, `update`, `custom`.

**Auto-confirmation**: every successful `POST /tools/book-appointment`
automatically fires an `appointment_confirmation` SMS — no extra Aria
tool call required.

**Apply the migration before going live**:
`supabase/migrations/0002_sms_layer.sql` adds `sms_log` (audit) and
`sms_consent` (opt-in/out). Apply with `supabase db push` or paste into
the SQL editor.

## Deployment troubleshooting

The voice service deploy on Railway runs from the `voice/` subdirectory
and has its own `voice/railway.json`. If new endpoints come back as 404
("Cannot POST /webhook/pre-call"), the running deploy is stale.

`/health` exposes the live build metadata for diagnosis:

```json
{
  "version": "1.1.0",
  "build_started_at": "2026-06-11T19:47:37.864Z",
  "git_sha": "<from RAILWAY_GIT_COMMIT_SHA>",
  "routes": { ... }
}
```

If `/health` reports an older `version` than `voice/package.json`, the
Railway service hasn't picked up the latest main. Fix:

1. Railway → `pitlane-voice` service → **Settings** → **Source**: confirm
   the repo is `SSJ2-AI/pitlane`, branch is `main`, **Root Directory** is
   `voice`, and **Watch Paths** is empty (or `voice/**`).
2. Settings → **Deploys**: confirm automatic deploys are ON.
3. Hit **Deploy** to force a rebuild from the latest commit.

## Dashboard surface

| Route | Purpose |
|---|---|
| `/dashboard` | Service-advisor view per customer: profile, vehicles, recalls, service history, **warranty badge**, **upsells offered for this customer**, Aria call activity (filtered + all), outbound call dropdown, screen-pop with live caller. |
| `/calls` | Aria call log: list + filters (customer / outcome / date range), detail drawer with transcript, AI summary, appointments booked, upsells flagged, loaner requests. Deep-linkable via `?customer_id=…`. |
| `/service-desk` | Live operations queue: today's arrivals, loaner queue with Approve/Decline, upsell pipeline with Accepted/Declined. 15 s auto-refresh. |

## Aria tools (mid-call webhooks)

| Tool | Method + path | Purpose |
|---|---|---|
| `customer_lookup` | `GET POST /tools/customer-lookup` | Legacy mid-call ID fallback; superseded by `/webhook/pre-call` for new agents. |
| `book_appointment` | `POST GET /tools/book-appointment` | Books an appointment, writes to `appointments`, queues a `cdk_sync_queue` row. Returns `{confirmed, confirmation_number, advisor, duration_est_hours}`. |
| `log_upsell` | `POST GET /tools/log-upsell` | Records an upsell against the customer + call, returns `{logged, upsell_id}`. |
| `request_loaner` | `POST GET /tools/request-loaner` | Adds a pending loaner request the service desk approves, returns `{requested, status, loaner_id}`. |
| `repair_eta` | `GET /tools/repair-eta/:ro_id` | Status + ETA for an existing repair order. Mock-derived today, Fortellis RO Async in Phase 3. |
| `warranty` | `GET /tools/warranty/:vehicle_id` | Factory + CPO expiry, open recalls. Mock-derived today, Fortellis Vehicle API in Phase 3. |
| `check_ro_status` | `POST GET /tools/check-ro-status` | Legacy lookup of open RO by customer or RO number (`repair_eta` is the preferred replacement). |
| `send_sms` | `POST GET /tools/send-sms` | Sends a transactional SMS to the caller via Twilio. `message_type` selects one of seven templates; `custom_text` overrides. |

All tools accept `call_id` (the ElevenLabs conversation id) so the resulting Supabase row is FK-linked back to the right `call_logs.id`. The pre-call webhook will have already opened the `call_logs` row; the tools resolve the conversation_id via `getOrCreateCallLogIdForConversation`.

## Phase 1 — what's wired today

- **Aria identifies the caller during the ring**, before audio connects, via
  `POST /webhook/pre-call`. ElevenLabs hits this endpoint with the Twilio
  caller_id; we look the customer up (Fortellis when configured, mocks
  otherwise), broadcast the screen pop to the advisor dashboard, persist the
  call in the event store, and reply with
  `conversation_initiation_client_data` so Aria opens the conversation with
  the customer's name, vehicle, tier, upcoming appointment, open RO/recall,
  and advisor notes already injected into her prompt as dynamic variables.
  See `voice/src/routes/webhook.ts`.
- The legacy `POST /tools/customer-lookup` endpoint is still in place as a
  mid-call fallback ("let me look you up") and behaves the same as before.
  When no record exists Aria continues with a normal
  "tell me about yourself" conversation.
- Every call (inbound or outbound) is persisted to the in-memory event store at
  `voice/src/store/callStore.ts`, keyed by `callId` and indexed by `customerId`.
  Tools (`book-appointment`, `check-ro-status`) and the post-call webhook all
  push events into the store.
- New voice routes:
  - `GET /calls/:callId` — full call detail (events, transcript, summary).
  - `GET /calls/customer/:customerId/timeline` — every call Aria has ever had
    with this customer.
  - `POST /events/notes` — attach a free-form note to a call (used by Phase 2
    when the advisor pushes a directive back to Aria mid-call).
- The PitLane advisor dashboard (`src/app/dashboard/page.tsx`) auto-loads the
  caller's full profile the moment Aria identifies them, shows live voice
  service connectivity, lists recent Aria calls, and lets the advisor trigger an
  outbound AI call from the customer profile.

## Phase roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: voice event store, dashboard auto-load, call history, outbound button, status dot | ✅ on `main` |
| 2 (legacy) | Polished call history panel: customer, time, duration in seconds, direction, summary | ✅ |
| 3 (legacy) | "Call Customer" dropdown with 4 call types (appointment reminder, recall, follow-up, parts ready) | ✅ |
| 4 (legacy) | Real CDK data via `src/lib/fortellis.ts` in `/api/voice/customer-lookup`. Falls back to mock when env vars are absent. | ✅ scaffold; needs creds to go live |
| Pre-call | `POST /webhook/pre-call`: ElevenLabs `conversation_initiation_client_data` with 16 dynamic variables; auto-loads dashboard during ring; optional HMAC. | ✅ on `main` |
| 2A | `POST /webhook/post-call`: GPT-4o-mini summary (outcome, topics, upsells, action items, sentiment, loaner_needed) + Supabase persistence + loaner queue auto-insert. | ✅ this PR |
| 2C | Supabase migration: `call_logs`, `appointments`, `upsells`, `loaner_requests`, `cdk_sync_queue`. | ✅ this PR |
| 2B | 5 new Aria tools (`book-appointment`, `log-upsell`, `request-loaner`, `repair-eta`, `warranty`) wired to Supabase + CDK sync queue. | ✅ this PR |
| 4A | `/calls` page: list + filters (customer / outcome / date range), call detail drawer with transcript, AI summary, appointments booked, upsells flagged, loaner requests. Honors `?customer_id=…` deep links from the dashboard. | ✅ |
| 4B | `/service-desk` page: today's arrivals, loaner queue with Approve/Decline actions, upsell pipeline with Accepted/Declined actions, live 15 s auto-refresh. | ✅ this PR |
| 4C | Customer-profile enhancements: `WarrantyBadge` (live from `/tools/warranty`) with status + factory/CPO expiry + recall list; `CustomerUpsellsPanel` reading from Supabase; "Open full call log" deep link. | ✅ |
| 5 | SMS layer: Twilio dispatcher + 7 templates + sms_log/sms_consent schema + auto-confirmation on book-appointment + `POST /tools/send-sms` Aria tool + `POST /sms/send` generic. Observable `/health` build-stamp. | ✅ this PR |
| 6 | Full CDK data pull (closed ROs, technicians, parts, loaner fleet, capacity) hourly into Supabase for analytics. | ⏭ next |
| 7 | `/analytics` page — service manager BI: revenue, fill rate, upsell conversion, retention, AI weekly insights. | ⏭ |
| 8 | Proactive outreach: service-interval reminders, recall follow-up, warranty expiry, declined-upsell re-engagement, weekly revenue-opportunity email. | ⏭ |
| 9 | `/book` public customer portal — xtime replacement. | ⏭ |
| 3 (new) | Full CDK write-back via Fortellis: `appointments` + notes + RO updates pushed through `cdk_sync_queue` worker. | ⏭ |

## Development

### Dashboard (Next.js)

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
```

Environment variables (`.env.local`):

```
NEXT_PUBLIC_VOICE_SERVICE_URL=https://pitlane-voice-production.up.railway.app
PITLANE_VOICE_API_KEY=<shared secret with voice service>
ELEVENLABS_API_KEY=<for outbound calls via /api/voice/calls/outbound>
ELEVENLABS_AGENT_ID=agent_2701ktpgkyr7f37vq8dmgxjw4bkt
ELEVENLABS_PHONE_NUMBER_ID=phnum_0301ktpjb9pvfwbvwkezwrt5c1c7

# ─── Phase 4: Fortellis / CDK ─────────────────────────────────────────
# When all three are set, /api/voice/customer-lookup queries Fortellis
# instead of returning hardcoded mock data. When unset, the dashboard
# silently falls back to the demo data so the POC keeps working.
FORTELLIS_CLIENT_ID=<>
FORTELLIS_CLIENT_SECRET=<>
FORTELLIS_SUBSCRIPTION_ID=<per-dealership subscription id>

# Optional overrides (defaults shown):
# FORTELLIS_TOKEN_URL=https://identity.fortellis.io/oauth2/aus1p1ixy7YL8cMq02p7/v1/token
# FORTELLIS_CUSTOMER_API_URL=https://api.fortellis.io/cdkservices/customer-information/v1/customers
```

### Voice service

```bash
cd voice
npm install
npm run dev          # http://localhost:3001
npm run build        # tsc → dist/
npm start            # node dist/server.js
```

Environment variables:

```
PORT=3001
ELEVENLABS_API_KEY=<>
ELEVENLABS_AGENT_ID=<>
ELEVENLABS_PHONE_NUMBER_ID=<>
# Pre-call + post-call webhook HMAC secret. When set, /webhook/* requires a
# valid ElevenLabs-Signature header. Leave unset for local dev / demo.
ELEVENLABS_WEBHOOK_SECRET=<shared with ElevenLabs agent>
PITLANE_API_URL=https://pitlane.vercel.app
PITLANE_VOICE_API_KEY=<shared secret with dashboard>
DEALERSHIP_NAME=Porsche Toronto
DEALERSHIP_BRANCH=Don Mills Road
USE_MOCK_DATA=true               # set false once CDK is wired (Phase 4)

# ─── Phase 5: SMS via Twilio ──────────────────────────────────────────
# When all three are set, /sms/send and /tools/send-sms dispatch real
# Twilio messages. Unset = dry-run mode (templates still render + are
# logged to sms_log if Supabase is configured).
TWILIO_ACCOUNT_SID=<>
TWILIO_AUTH_TOKEN=<>
TWILIO_FROM_PHONE=+1XXXXXXXXXX

# ─── Phase 2A: Post-call intelligence ─────────────────────────────────
# When OPENAI_API_KEY is set, /webhook/post-call uses GPT-4o-mini to
# turn the transcript into structured JSON (outcome, topics,
# upsells_flagged, action_items, sentiment, loaner_needed, summary_text).
# Unset = deterministic heuristic fallback. Either way the summary is
# persisted to Supabase if configured.
OPENAI_API_KEY=<>

# ─── Phase 2C: Supabase persistence ───────────────────────────────────
# When BOTH SUPABASE_URL and a key are set, call_logs / appointments /
# upsells / loaner_requests / cdk_sync_queue rows are written to
# Supabase. Unset = in-memory only (demo mode).
SUPABASE_URL=<https://<project>.supabase.co>
SUPABASE_SERVICE_ROLE_KEY=<service-role key from Supabase dashboard>
# SUPABASE_ANON_KEY=<>   # alternative when service-role isn't available
```

### Applying the Supabase migration

The schema for the Aria intelligence layer lives at
`supabase/migrations/0001_aria_intelligence_layer.sql`. Apply it once per
environment:

- **Supabase CLI**:
  ```bash
  supabase link --project-ref <project-ref>
  supabase db push
  ```
- **Supabase Dashboard**: open the SQL editor, paste the migration file,
  click Run.

Tables created:

| Table | Purpose |
|---|---|
| `call_logs` | One row per Aria call. `in_progress` from pre-call webhook → `completed` once post-call summary lands. Holds transcript + structured summary JSON. |
| `appointments` | Created by Aria's `book-appointment` tool. `cdk_id` filled in by the async sync worker. |
| `upsells` | Service upsells Aria surfaces during a call (`status: pending / accepted / declined`). |
| `loaner_requests` | Service-desk loaner queue. Auto-populated when post-call summary has `loaner_needed: true`. |
| `cdk_sync_queue` | Outbound CDK write queue drained by the Phase 3 background worker. |

### Configuring the ElevenLabs pre-call webhook

In the ElevenLabs agent dashboard for Aria
(`agent_2701ktpgkyr7f37vq8dmgxjw4bkt`):

1. Open the agent → **Security** tab.
2. Enable **"Allow conversation initiation from third party endpoints"**.
3. Set the **webhook URL** to
   `https://pitlane-voice-production.up.railway.app/webhook/pre-call`.
4. (Recommended) Set a webhook secret and add the same value to Railway as
   `ELEVENLABS_WEBHOOK_SECRET` — requests without a valid
   `ElevenLabs-Signature` header will be rejected with a 401.

### Dynamic variables Aria receives

The pre-call webhook returns these `{{variables}}` for use in Aria's system
prompt and first message:

| Variable | Known caller | Unknown caller |
|---|---|---|
| `{{customer_name}}` | "James Whitfield" | "valued customer" |
| `{{first_name}}` | "James" | "" |
| `{{last_name}}` | "Whitfield" | "" |
| `{{vehicle}}` | "2021 Porsche Cayenne S AWD" | "your vehicle" |
| `{{vehicles_summary}}` | "2021 Porsche Cayenne S AWD and 2020 Porsche 911 Carrera S Cabriolet" | "" |
| `{{tier}}` | "Gold" / "Platinum" / etc. | "Standard" |
| `{{upcoming_appointment}}` | "2026-06-18 at 10:00 — Annual Service B + Brake Fluid Exchange" | "None scheduled" |
| `{{open_repair_order}}` | "Air suspension compressor replacement (status: awaiting parts, ETA 2026-06-14)" | "" |
| `{{open_recall}}` | "Battery Management System: Software update — 45 min, no charge" | "" |
| `{{advisor_notes}}` | "Prefers loaner vehicle for any service over 4 hours…" | "" |
| `{{last_visit}}` | "2026-04-12" | "" |
| `{{preferred_language}}` | "en" / "fr" | "en" |
| `{{dealership_name}}` | "Porsche Toronto" | "Porsche Toronto" |
| `{{dealership_branch}}` | "Don Mills Road" | "Don Mills Road" |
| `{{is_known_caller}}` | `"true"` | `"false"` |
| `{{caller_phone}}` | _(not set)_ | "+15551234567" |

Suggested Aria system-prompt snippet:

```
You are Aria, the AI service advisor at {{dealership_name}} - {{dealership_branch}}.

The caller is {{customer_name}}. They own {{vehicles_summary}}.
Their loyalty tier is {{tier}}. Their preferred language is {{preferred_language}}.
Upcoming appointment: {{upcoming_appointment}}.
Open repair order: {{open_repair_order}}.
Open recall: {{open_recall}}.
Advisor notes: {{advisor_notes}}.

If {{is_known_caller}} is "true", greet them warmly by first name and reference
their vehicle immediately. Do NOT ask them to confirm their identity — you
already know who they are.

If {{is_known_caller}} is "false", greet them as a new customer and politely
ask for their name and which vehicle they are calling about.
```

## Testing the Phase 1 flow

1. `cd voice && npm run dev` and `npm run dev` (in the repo root) in another
   shell.
2. Open `http://localhost:3000/dashboard` — the **Aria** status dot should turn
   green within a couple seconds.
3. Fire a simulated inbound call:
   ```bash
   curl -X POST http://localhost:3001/demo/simulate-inbound \
     -H 'Content-Type: application/json' \
     -d '{"phone": "+16475550101"}'
   ```
4. The IncomingCallPopup appears AND the dashboard auto-loads James Whitfield's
   profile.
5. Hit `http://localhost:3001/calls/customer/cust_001/timeline` to see every
   call event recorded for that customer.
