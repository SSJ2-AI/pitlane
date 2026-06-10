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

| Phase | Scope |
|---|---|
| 1 (this PR) | Foundation: event store, dashboard auto-load, call history, outbound button, status dot |
| 2 | Note + appointment write-back endpoints on PitLane, live in-call panel (intent / proposed booking), advisor "directive to Aria" channel using ElevenLabs `conversation_initiation_client_data` |
| 3 | Loaner workflow: `request_loaner` tool, `LOANER_REQUESTED` WS event, loaner queue widget on dashboard, Approve/Decline-with-counter, email + ICS calendar invite, callback from Aria on counter |
| 4 | Replace JSON event store with real Fortellis/CDK read+write per dealership |

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
# Pre-call webhook HMAC secret. When set, /webhook/pre-call requires a valid
# ElevenLabs-Signature header. Leave unset for local dev / demo.
ELEVENLABS_WEBHOOK_SECRET=<shared with ElevenLabs agent>
PITLANE_API_URL=https://pitlane.vercel.app
PITLANE_VOICE_API_KEY=<shared secret with dashboard>
DEALERSHIP_NAME=Porsche Toronto
DEALERSHIP_BRANCH=Don Mills Road
USE_MOCK_DATA=true               # set false once CDK is wired (Phase 4)
```

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
