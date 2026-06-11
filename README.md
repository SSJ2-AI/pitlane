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
| 2B | 5 new Aria tools (`book-appointment`, `log-upsell`, `request-loaner`, `repair-eta`, `warranty`) wired to Supabase. | ⏭ next |
| 4 (new) | `/calls` page (call log + AI summaries + transcript), `/service-desk` page (today's arrivals, loaner queue, in-shop ETA, upsell pipeline), vehicle-detail enhancements. | ⏭ |
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
