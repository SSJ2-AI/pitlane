# PitLane — Live Demo Runbook

Use this when you're walking a service-fixed-ops decision-maker through
PitLane end-to-end. The flow takes **~7 minutes** and shows the full
Aria-to-CDK-to-dashboard loop on real screens, not slides. Every step
below is a real command or a real click.

The whole demo runs against the seeded Porsche Toronto dealer
(`+19063760066`, customer `cust_005` = Sulaim Siddiqi, his 2023 GT3 RS).
You can run it from a laptop in any meeting room.

---

## Pre-meeting checklist (do this 30 min before)

| | |
|---|---|
| ☐ | `/health` on the voice service returns `version: "1.2.0"` (or newer) and a `default_dealer` block. If not, hit **Deploy** in Railway → `pitlane-voice` and wait for the new build. |
| ☐ | Open `https://pitlane-production-3a47.up.railway.app/dashboard` in one browser tab; verify the **Aria** dot in the header is green ("Aria online"). |
| ☐ | Open `https://pitlane-production-3a47.up.railway.app/service-desk` in a second tab. |
| ☐ | Open `https://pitlane-production-3a47.up.railway.app/calls` in a third tab. |
| ☐ | Have a terminal open with the curl commands below loaded as snippets. |
| ☐ | Phone in hand. |

If you want a fully live phone call instead of the curl-driven walkthrough, also confirm:
- ElevenLabs agent `agent_2701ktpgkyr7f37vq8dmgxjw4bkt` Security tab has the pre-call URL set to `https://pitlane-voice-production.up.railway.app/webhook/pre-call`.
- The Twilio number ringing to your demo phone forwards into ElevenLabs.

---

## The script

### Beat 1 — "Here's what your service desk sees right now"

Show the empty `/dashboard` page. Point at the **Aria** pill in the header (green) and the **Service desk** + **Calls** nav links. Say:

> "This is what your advisor sees on a quiet morning. Nothing's loaded — they're waiting for the next call. The green dot means Aria is online and listening on your service line."

### Beat 2 — "Now a customer dials in"

Run, from the terminal:

```bash
curl -X POST https://pitlane-voice-production.up.railway.app/demo/simulate-inbound \
  -H 'Content-Type: application/json' \
  -d '{"phone": "+16475457709"}'
```

Within ~1 second on the dashboard tab:
- The red **Incoming Call** screen-pop slides in from the bottom right with Sulaim's name, vehicle, loyalty tier, recall warnings, and upcoming appointment.
- The page **automatically fills in his phone number** and loads his full profile underneath — vehicles, service history, recalls, lifetime spend.
- The **Aria phone log** in the sidebar lights up with the call (status: live).

Say:

> "Aria has already pulled his record from CDK and identified him by phone number. The advisor knows it's Sulaim, knows he owns a 2023 GT3 RS, knows he has an open recall, and knows he has a track-prep appointment booked for June 20th — all before the advisor has even said hello. The advisor and Aria are looking at the exact same person."

### Beat 3 — "Watch Aria do the actual work"

From the terminal, simulate Aria booking the new appointment (this is what happens mid-call when the customer asks for service):

```bash
curl -X POST https://pitlane-voice-production.up.railway.app/tools/book-appointment \
  -H 'Content-Type: application/json' \
  -d '{
    "customer_id": "cust_005",
    "vehicle_id": "veh_005a",
    "service_type": "Brake Service",
    "date": "2026-07-15",
    "time": "10:00",
    "call_id": "demo_call_001"
  }'
```

Show the response. Then run the upsell + loaner Aria flags during the same call:

```bash
curl -X POST https://pitlane-voice-production.up.railway.app/tools/log-upsell \
  -H 'Content-Type: application/json' \
  -d '{
    "customer_id": "cust_005",
    "vehicle_id": "veh_005a",
    "upsell_type": "PCCB Pad Replacement",
    "description": "Track-rated PCCB pads recommended after Mosport sessions",
    "value_est": 850,
    "call_id": "demo_call_001"
  }'

curl -X POST https://pitlane-voice-production.up.railway.app/tools/request-loaner \
  -H 'Content-Type: application/json' \
  -d '{
    "customer_id": "cust_005",
    "appointment_date": "2026-07-15",
    "loaner_preferred": "Cayenne",
    "call_id": "demo_call_001"
  }'
```

Say:

> "Three things just happened, all driven by Aria's conversation: she booked the brake service, she flagged an $850 PCCB pad upsell for the advisor to follow up on, and she requested a loaner. Notice she also auto-fired a confirmation SMS to Sulaim with the appointment details. Your advisor didn't have to type anything."

### Beat 4 — "Service-desk operational view"

Switch to the **/service-desk** tab and refresh.

The page now shows:
- **Today's arrivals** (and the appointment Aria just booked for July 15th — adjust the demo date if needed).
- **Loaner queue** with Sulaim's request, status `pending`, with **Approve** and **Decline** buttons.
- **Upsell pipeline** showing the $850 PCCB opportunity Aria flagged, with **Accepted** / **Declined** buttons.
- **Upsell pipeline total** at the top — real dollars on the board.

Click **Approve** on the loaner. Click **Accepted** on the upsell.

Say:

> "This is your service manager's morning. Aria handled the call, the operational tasks she generated land here as one-click decisions. The loaner board, the upsell pipeline, today's arrivals — all updated in real time. No spreadsheets, no whiteboard."

### Beat 5 — "The post-call summary writes itself"

Simulate what ElevenLabs sends after the call ends:

```bash
curl -X POST https://pitlane-voice-production.up.railway.app/webhook/post-call \
  -H 'Content-Type: application/json' \
  -d '{
    "conversation_id": "demo_call_001",
    "call_sid": "CA_demo_001",
    "caller_phone": "+16475457709",
    "called_number": "+19063760066",
    "duration_secs": 142,
    "status": "completed",
    "transcript": [
      {"role": "agent", "message": "Hi Sulaim, this is Aria from Porsche Toronto. I see your track prep appointment is coming up June 20th."},
      {"role": "user", "message": "Yes, can I book brake service for July 15th too? I'\''ll need a loaner."},
      {"role": "agent", "message": "Absolutely. I'\''ve also flagged the PCCB pads — Mosport is hard on them. Want me to add that to the quote?"},
      {"role": "user", "message": "Yes, please. Thank you."}
    ]
  }'
```

Switch to the **/calls** tab and refresh.

The new call is at the top of the list, with:
- Outcome pill: **Appointment booked** (green).
- Sentiment pill: **Positive**.
- Topics: brakes, PCCB inspection.
- Action items: "Reserve loaner vehicle", "Confirm appointment details with customer".

Click on the call. The detail drawer expands showing the full transcript, the GPT-4o-mini summary, the appointment we booked, the upsell we flagged, the loaner request we filed.

Say:

> "Aria didn't just take the call — she documented it for you. This is what you'd normally pay an advisor an hour to write up in the CDK notes. Every call gets a structured summary, the transcript is searchable, and the line items Aria created are FK-linked back to the conversation that produced them. When the GM asks 'why did we approve that loaner?' your manager has the answer in one click."

### Beat 6 — "And it scales"

Show the `/health` endpoint:

```bash
curl https://pitlane-voice-production.up.railway.app/health | jq
```

Point at the `default_dealer` block and the `routes` manifest. Say:

> "Every operational row carries a dealer_id from day one. The same deploy you just watched can run all 22 of your Canadian rooftops side by side. Adding the next dealer is a database insert — provision a Twilio number, drop a row in the `dealers` table with the brand and the Fortellis subscription, and the next call to that number routes to the right rooftop with the right CDK creds. We never built a per-dealer fork. No new ElevenLabs agents — one Porsche agent runs every Porsche store, branding comes from the dealer record. Audi, BMW, Mercedes — same architecture, different brand-level prompt."

### Beat 7 — "What it costs and what it returns"

Don't read pricing off a deck. Tie it back to what they just watched:

> "Three things drove revenue in the last 60 seconds: an upsell flagged that the advisor would have missed, a loaner approved before the customer hung up so the appointment is locked in, and a confirmation SMS that cuts no-show rate. Across 22 rooftops you're looking at thousands of those interactions a week. We charge for the platform plus a per-completed-appointment success fee — so we win when Fixed Ops wins, and we never charge per seat. I'd rather earn the dollars after they show up."

### Beat 8 — "Here's the security packet"

Hand over `docs/SECURITY_BRIEF.md` (printed or shared as PDF) before they ask. Say:

> "I know the integration discussion is where deals stall — your IT team needs to vet how we touch CDK before anything else happens. This is what they'll want: data residency, Fortellis OAuth scope, RLS, audit logging, kill switch, SOC 2 status. Happy to walk your security lead through it the same way I just walked you through Aria."

---

## Bail-out commands (if anything goes sideways)

| Symptom | Fix |
|---|---|
| Screen-pop doesn't appear | Verify the **Aria** dot is green. If grey, click it to reconnect. If it stays grey, the voice deploy is down — point at the dashboard and explain "the WebSocket is what drives the screen pop; it's running on Railway." |
| `/tools/*` returns 404 | The voice deploy is on a stale build. Skip to Beat 4 (dashboard tour) and `/health` to show what *should* be live. |
| Supabase is unconfigured | The Aria call activity panel will show "Voice service unavailable" — Phase 5 / MT data won't appear in `/calls` or `/service-desk`. Stick to Beats 1–3 (screen pop + book + SMS dry-run) which work in-memory. |
| You need to reset between demos | `curl -X POST https://pitlane-voice-production.up.railway.app/demo/set-next-caller -H 'Content-Type: application/json' -d '{"as_customer_id":"cust_005"}'` — overrides the next inbound to be Sulaim, regardless of phone. |

---

## Variants by audience

| Audience | Spend time on | Skip |
|---|---|---|
| **Fixed Ops manager** (Rob Morrison) | Beats 2, 3, 4, 5 — operational value | Beat 6 architecture detail |
| **GM / dealer principal** | Beats 2, 4, 7 — top-line revenue impact | Beats 5 transcript detail |
| **IT lead** | Beat 6 + the security brief | The pricing close |
| **OEM rep** | Beat 6 — brand-level agent architecture | Pricing |
