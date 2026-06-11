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

- Aria identifies the caller by phone via `voice/src/routes/tools.ts:customer-lookup`,
  falling back to `lookupByPhoneWithCDK()` which calls the PitLane Next.js
  endpoint `/api/voice/customer-lookup` when `PITLANE_API_URL` is configured.
  When no record exists Aria continues with a normal "tell me about yourself"
  conversation.
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
| 2 | Polished call history panel: customer, time, duration in seconds, direction, summary | ✅ |
| 3 | "Call Customer" dropdown with 4 call types (appointment reminder, recall, follow-up, parts ready) calling the voice service directly with `customer_id` + `call_type` | ✅ |
| 4 | Real CDK data via `src/lib/fortellis.ts` (OAuth client_credentials + Subscription-Id) in `/api/voice/customer-lookup`. Falls back to mock data when env vars are absent. | ✅ scaffold; needs real credentials to go live |
| Next | Loaner workflow, email + ICS calendar invites, advisor "directive to Aria" mid-call context injection, write-back of appointments/notes from Aria to CDK | ⏭ |

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
PITLANE_API_URL=https://pitlane.vercel.app
PITLANE_VOICE_API_KEY=<shared secret with dashboard>
DEALERSHIP_NAME=Porsche Toronto
DEALERSHIP_BRANCH=Don Mills Road
USE_MOCK_DATA=true               # set false once CDK is wired (Phase 4)
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
