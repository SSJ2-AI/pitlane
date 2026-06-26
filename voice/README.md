# PitLane Voice — AI Telephony Microservice

AI receptionist + outbound calling for Porsche dealerships, powered by ElevenLabs Conversational AI and CDK/Fortellis.

## What it does

**Inbound calls**
Customer calls your Twilio number → ElevenLabs "Aria" picks up → looks up the caller in CDK → greets them by name → handles appointment booking, repair order status, recall notifications → screen pop appears on the PitLane dashboard with full customer context.

**Outbound calls**
Advisor triggers from PitLane (or automated cron) → Aria calls the customer → delivers appointment reminder, recall notification, parts-ready alert, or service follow-up.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Voice AI | ElevenLabs Conversational AI v3 (Aria) |
| Telephony | Twilio (via ElevenLabs native integration) |
| Microservice | Node.js 20 + TypeScript + Express |
| Real-time | WebSocket — screen pop to PitLane |
| Customer data | Mock Fortellis CDK layer (swap for live in Phase 2) |
| Deploy | Railway |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/tools/customer-lookup` | ElevenLabs mid-call webhook — returns customer profile |
| `POST` | `/tools/book-appointment` | Books a service appointment |
| `POST` | `/tools/check-ro-status` | Returns open repair order status |
| `POST` | `/calls/outbound` | Triggers single outbound AI call |
| `POST` | `/calls/batch` | Triggers bulk outbound calls |
| `GET` | `/calls/history` | Recent call log |
| `POST` | `/events/call-completed` | ElevenLabs post-call transcript webhook |
| `POST` | `/demo/simulate-inbound` | Demo only — fires screen pop without a real call |
| `WS` | `/ws` | WebSocket — screen pop events to PitLane dashboard |

---

## ElevenLabs Agent

Agent **Aria** was created on your ElevenLabs account:
```
Agent ID: agent_2701ktpgkyr7f37vq8dmgxjw4bkt
API Key:  sk_9b5b0a51eb1ca11e60edccf664d9ad7855f1bac5cd48f687 (PitLane Voice key)
```

Agent is configured with:
- System prompt: see [`src/aria-prompt.ts`](src/aria-prompt.ts) — version-controlled source of truth. The live prompt running on the ElevenLabs dashboard MUST be kept in sync with this file. The prompt explicitly distinguishes `request_callback` (log + stay on call) from `transfer_call` (live Twilio handoff + drop off) so Aria doesn't hang up on callers who just asked for a follow-up call.
- Tools: `customer_lookup`, `book_appointment`, `check_repair_order_status`, `request_callback`, `transfer_call`, `log_upsell`, `request_loaner`, `send_sms`, `update_customer_name`, `repair_eta`, `warranty`
- ElevenLabs Turbo v2 voice (Aria — calm, professional)
- Post-call webhook: `{RAILWAY_URL}/webhook/post-call` (legacy alias: `/events/call-completed`)

> After deploying to Railway, update the tool webhook URLs in the ElevenLabs dashboard to your actual Railway domain.

---

## Mock Customers (for demo)

| Name | Phone | Vehicles | Status |
|------|-------|----------|--------|
| James Whitfield | +1-647-555-0101 | 2021 Cayenne S, 2020 911 Carrera S | RO awaiting parts |
| Priya Mehta | +1-416-555-0202 | 2022 Taycan 4S | Appointment tomorrow + open recall |
| David Okafor | +1-437-555-0303 | 2022 Macan GTS | Vehicle in shop TODAY |
| Sophie Tremblay | +1-514-555-0404 | 2022 718 Cayman GTS | Bilingual (FR) |

---

## Setup

### 1. Install & run locally

```bash
npm install
npm run dev
```

Server starts at `http://localhost:3001`

Test the demo screen pop:
```bash
curl -X POST http://localhost:3001/demo/simulate-inbound \
  -H "Content-Type: application/json" \
  -d '{"phone": "+14165550202"}'
```

### 2. Deploy to Railway

1. Push this folder to a GitHub repo
2. Create a new Railway project → Deploy from GitHub
3. Set environment variables:
   ```
   ELEVENLABS_API_KEY=sk_9b5b0a51eb1ca11e60edccf664d9ad7855f1bac5cd48f687
   ELEVENLABS_AGENT_ID=agent_2701ktpgkyr7f37vq8dmgxjw4bkt
   ELEVENLABS_PHONE_NUMBER_ID=<from step 3 below>
   NODE_ENV=production
   PITLANE_DASHBOARD_URL=https://your-pitlane-domain.vercel.app
   USE_MOCK_DATA=true
   ```
4. Railway will auto-deploy. Copy your public URL (e.g. `https://pitlane-voice.up.railway.app`)

### 3. Connect Twilio to ElevenLabs (5 minutes)

1. Go to [ElevenLabs → Agents → Phone Numbers](https://elevenlabs.io/app/agents/phone-numbers)
2. Click **Import Number**
3. Fill in:
   - Label: `Porsche Toronto Demo`
   - Phone Number: your Twilio number
   - Twilio Account SID: from [Twilio Console](https://console.twilio.com)
   - Twilio Auth Token: from [Twilio Console](https://console.twilio.com)
4. ElevenLabs **automatically configures the Twilio webhook** — no TwiML needed
5. Under "Inbound calls", select **Aria — PitLane Service AI** as the agent
6. Copy the **Phone Number ID** → add to Railway env as `ELEVENLABS_PHONE_NUMBER_ID`

### 4. Update agent webhook URLs

After Railway deployment, go to ElevenLabs → Agents → Aria → Tools and update each webhook URL from `https://pitlane-voice.up.railway.app` to your actual Railway domain (if different).

### 5. Integrate PitLane dashboard

See `PITLANE_UI_SPEC.md` — send to Cursor/Perplexity to add:
- `VoiceProvider` (WebSocket client)
- `IncomingCallPopup` (screen pop)
- `CallHistory` panel
- `OutboundCallButton` on customer profile

---

## Demo Script (for management)

**Inbound flow:**
1. Call your Twilio number from one of the mock phone numbers (or use `+1-647-555-0101` from any phone)
2. Aria answers: *"Good day, thank you for calling Porsche Toronto..."*
3. PitLane dashboard shows the screen pop with James Whitfield's profile
4. Ask Aria: *"What's the status of my repair?"* → Aria reports the suspension part is on order
5. Ask Aria: *"Can I book an appointment for my 911?"* → Aria books it

**Outbound flow:**
1. In PitLane, click "AI Call" → "Recall Notification" on Priya Mehta
2. Aria calls Priya's phone and delivers the recall notification
3. Dashboard shows "Outbound Initiated" event

**Screen pop demo (no phone needed):**
```bash
curl -X POST https://pitlane-voice.up.railway.app/demo/simulate-inbound \
  -H "Content-Type: application/json" \
  -d '{"phone": "+14375550303"}'
```
→ David Okafor's screen pop fires on the dashboard (vehicle in shop today)

---

## Expanding to other dealership systems

| System | Integration path |
|--------|----------------|
| CDK Drive (live) | Replace mock with real Fortellis OAuth + REST calls in `src/mock/customers.ts` |
| Reynolds & Reynolds ERA | Their CDK-style REST API — same swap, different auth |
| DealerSocket | REST API + OAuth — same pattern |
| Tekion | REST API — same pattern |
| Xtime (Cox) | Cox Automotive API — appointment booking |

All integrations follow the same shape: `lookupByPhone(phone)` returns a `Customer` object. Swap the mock for a live API call — the agent, WebSocket, and PitLane UI require zero changes.
