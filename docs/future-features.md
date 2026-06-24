# PitLane — Future Feature Roadmap

Tracks the high-value surfaces we know we want next but haven't scoped
into a phase yet. Each entry is a one-paragraph brief on what the
feature does, why it matters, and what's blocking it.

---

## ePayments ISV / Invite-2-Pay

`POST /payments` + `GET /payment/{promiseId}` via CDK's ePayments API.
After a service call, Aria sends an SMS payment link. Payment settles
inside CDK DMS automatically — no cashier handoff, no second visit to
the dealer cashbox. Requires a separate Fortellis ePayments ISV
registration (not bundled with the standard dealer app). High impact:
eliminates the cashier bottleneck that's currently the #1 service
checkout complaint.

---

## Sales BDC Aria (CRM / Elead integration)

CDK CRM / Elead 7-API bundle. A second, sales-focused Aria agent
handles inbound sales calls: qualifies leads, pushes them to Elead CRM,
logs activities as CRM touchpoints, and queries Elead scheduling for
test drives. Entirely separate ElevenLabs agent from the service Aria —
different persona, different system prompt, different dynamic
variables. Requires a CDK CRM subscription bundle (cost lives in
sales-org budget rather than service-org budget).

---

## Parts Sales Async — Proactive Parts Notifications

CDK Drive Async Closed Parts Sales webhook. When ordered parts arrive
at the dealer, Aria proactively calls or texts the customer ("Your
brake pads are in — when works for installation?"). Eliminates the
missed-parts-pickup problem that today only gets caught when an advisor
manually scans the parts shelf. Part of the CDK Drive RO Bundle the
dealer already has access to — pending implementation, not
subscription.

---

## F&I Coverage Lookup

CDK Drive Get FI Sales API. Before Aria quotes any service cost she
checks the customer's prepaid maintenance plan, VSC (Vehicle Service
Contract), GAP, and extended warranty product details. "Your prepaid
oil change covers today's service, no charge" — turns a price
objection into a delight moment. 7-year lookback on historical F&I
deals.

---

## CDK Scheduling Unlock (DevCare ticket required)

CDK Service Appointment scheduling currently returns 403 Forbidden
without manual grant from CDK. Phase 10 wires the
`getAvailableSlots()` + `bookServiceAppointment()` Fortellis client
paths with a mock fallback, so the booking pipeline is plumbed end-to-
end. Once the dealer's billing is approved, submit a DevCare support
ticket to flip the entitlement; the code path is already in place.

---

## Multi-Dealer Support

Expand from single-dealer to full multi-tenant. The `dealers` table
already exists; the dashboard already resolves dealer per request.
Remaining work: per-dealer Aria agent provisioning (separate
ElevenLabs agent + Twilio number per rooftop), per-dealer CDK
credentials (Fortellis client secret per dealer, encrypted at rest),
and white-label routing under `pitlaneai.ca/<dealer-slug>` or
per-dealer subdomains.

---

## CDK Workshop Management — Full Tech Integration

Real-time technician availability and skill matching via the Workshop
Management API. Phase 9b's tech-assignment dropdown today is a flat
list; the next step is to score each tech against the service code
based on specialty + current workload, then default the assignment to
the best match. Pulls from Fortellis directly (no PitLane data
storage), in line with the CDK-first principle.

---

## Repair Order Write (CDK)

Today PitLane *reads* ROs from CDK and writes notes + line items into
Supabase. Next: Aria creates RO notes and line items directly in CDK
via the Repair Order V2 API. Already researched: the API's
`jobStarted` boolean prevents updates to active lines, so writes go
through a "create + immediately submit" pattern rather than mutation.

---

## Sentiment Trend Analytics on /analytics

The existing /analytics page shows headline KPIs. Future: a sentiment
trend chart (positive / neutral / negative / frustrated stacked over
time) + a callback-reason word cloud + per-advisor sentiment
attribution so the service manager can see who's calming frustrated
callers down vs. who's escalating them.

---

## Voice biometric caller verification

When a known phone calls in we currently inject the customer's name
into Aria's prompt and let her greet them. A future surface: use
voice-print verification to confirm the caller actually IS the
account holder before disclosing service history or PII. Especially
relevant for high-value F&I conversations and any future ePayments
flow that takes payment details over the phone.
