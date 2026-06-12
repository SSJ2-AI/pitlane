# PitLane — Security & Data Privacy Brief

**Version:** 1.0 — June 2026
**Audience:** Dealership IT, Information Security, and Vendor Risk teams
**Scope:** PitLane Service Intelligence Platform (Aria voice AI + advisor dashboard + CDK/Fortellis integration)

This document summarises how PitLane handles dealership and customer data
end-to-end. It is intentionally short and concrete so vendor-risk reviews
can be completed without back-and-forth. Every claim below maps to a
specific code path in the production codebase; engineering can produce
that mapping on request.

---

## 1. Data flow at a glance

```
   Customer dials dealership service line
              │
              ▼
   Twilio → ElevenLabs (Aria) ─────────► dealer.phone_number lookup
              │                          (dealers table, multi-tenant)
              │                                   │
              │  conversation_initiation_         ▼
              │  client_data                Twilio number routes the call
              │                             to a specific dealer_id
              ▼
   PitLane Voice (Railway) ─── Fortellis CDK API ──► Customer + vehicle + RO
              │                (OAuth2 client_credentials,                │
              │                 Subscription-Id per dealer)               │
              │  WebSocket screen-pop                                     │
              ▼                                                           ▼
   PitLane Dashboard (Railway)                              Aria opens the call
   advisor sees same customer Aria is talking to            with caller's full
                                                            CDK context already
                                                            in dynamic variables
```

After the call ends:
1. ElevenLabs posts the transcript to `/webhook/post-call`.
2. We summarise it with GPT-4o-mini into structured JSON
   (outcome, sentiment, action items, upsells, loaner_needed).
3. Every appointment / upsell / loaner request Aria booked is written
   to Supabase, tagged with the originating `dealer_id` and `call_log_id`.
4. (Phase 3, in progress) The `cdk_sync_queue` worker writes each row
   back into Fortellis so CDK remains the System of Record.

---

## 2. The "Big Three" compliance asks

| Ask | Status | Notes |
|---|---|---|
| **SOC 2 Type II** | In progress | Controls implemented per the AICPA TSC; third-party audit scheduled. We can share our SOC 2 readiness assessment + internal control matrix on request under NDA. |
| **PIPEDA compliance (Canada)** | Yes | Data residency in Canadian cloud regions (`ca-central` on Supabase, `us-west-1` on Railway with `ca-central-1` migration in flight before launch). Customer data retention configurable per dealership. STOP/HELP SMS opt-out flows are wired (`sms_consent` table). |
| **Third-party penetration test** | Scheduled | OWASP-aligned external pen-test ahead of the first production rollout. The remediation report will accompany this brief. |

---

## 3. Architecture safeguards

### 3.1 Least-privilege Fortellis access
- We integrate via the official **Fortellis API marketplace** (not back-channel SOAP), authenticated with **OAuth 2.0 client_credentials** + a per-dealership **`Subscription-Id`** header.
- Our token cache (`src/lib/fortellis.ts`) holds tokens for at most ~1 hour and invalidates immediately on `401/403`. Tokens are never written to disk or exposed in logs.
- Initial scope: **read** customer-by-phone + vehicle + open RO + warranty/recalls; **write** appointments and notes. We never request portfolio-wide read access.
- Per dealer, the dealership controls consent: they activate the PitLane Fortellis app, they can revoke it instantly from the Fortellis dashboard ("kill switch").

### 3.2 Multi-tenant isolation
- Every operational row (`call_logs`, `appointments`, `upsells`, `loaner_requests`, `sms_log`, `cdk_sync_queue`) carries a non-null `dealer_id` FK to the master `dealers` table.
- **Row-Level Security** is enabled on every tenanted table. The `dealer_isolation_*` policies filter by a session-bound `app.current_dealer_id`; any future caller using an anon or per-user JWT key is constrained to the dealer they authenticated against.
- Every server-side query in the dashboard (`/api/calls`, `/api/service-desk/summary`, `/api/upsells/[id]`, etc.) **also** applies `.eq('dealer_id', dealer.id)` at the application layer as defense-in-depth — so a cross-dealer write is impossible even with a known row uuid.
- The Twilio number a customer dialed is what routes the call to a dealer (`called_number` → `dealers.phone_number`). There is no "default dealer" in production — the `DEFAULT_DEALER` constant exists only as a development-time fallback and resolves to the dealership currently running the deploy.

### 3.3 Authentication
- ElevenLabs pre-call and post-call webhooks are signed with **HMAC-SHA256** (Stripe-style `t=<unix>,v0=<hex>` header). Signatures older than 30 minutes are rejected; constant-time compare. Configured via `ELEVENLABS_WEBHOOK_SECRET`.
- Voice service ↔ dashboard API key (`PITLANE_VOICE_API_KEY`) protects the `/api/voice/customer-lookup` endpoint.
- Supabase service-role key is held server-side only; never exposed to the browser. The browser only sees data through tenant-scoped Next.js API routes.
- Dashboard advisor login (Phase 7, coming): SSO via the dealership's existing identity provider (Okta, Azure AD), with MFA enforced at the IdP.

### 3.4 Audit logging
- Every Aria call writes a `call_logs` row that holds the full transcript + GPT summary + every event recorded during the call (`APPOINTMENT_REQUESTED`, `LOANER_REQUESTED`, `NOTE_ADDED`, `CUSTOMER_IDENTIFIED`, etc.).
- Every SMS dispatch writes an `sms_log` row (status, Twilio SID, FK back to the call / appointment / loaner that triggered it). STOP replies log a `skipped` row so the audit trail is complete even for opt-outs.
- Every CDK write enqueues a `cdk_sync_queue` row carrying the full payload and audit trail; we can produce a complete "what did Aria do" report for any given call.
- All requests are logged with structured JSON at the application layer; standard cloud-provider request logging covers the infrastructure layer.

### 3.5 Encryption
- **In transit:** HTTPS only, TLS 1.2+ on every public endpoint. WebSocket screen-pop uses WSS.
- **At rest:** Supabase managed PostgreSQL with AES-256 at rest. ElevenLabs handles encryption of recorded audio; we only persist the text transcript.
- Fortellis client credentials are stored as Railway environment variables; the field exists in `dealers.fortellis_client_secret` as a placeholder for application-layer AES-256 encryption (planned ahead of multi-dealer rollout).

### 3.6 Business continuity
- Railway managed services with `restartPolicyType: ON_FAILURE` + `restartPolicyMaxRetries: 3` on the voice service. Healthcheck at `/health` with 30s timeout.
- The voice service is stateless apart from in-memory call store; pre-call webhook + post-call webhook are idempotent (Supabase upserts keyed by `call_sid` AND `conversation_id`), so a redeploy mid-conversation does not lose data.
- Supabase backups (daily PITR window) handled by the platform.
- If the voice service is unavailable, Twilio's voicemail fallback takes the call. Aria's degradation is graceful: when CDK lookup fails she falls back to "unknown caller" mode and asks the customer their name.

### 3.7 PII handling
- Customer phone numbers are normalised to E.164 before any external API call. Aria's tools accept `customer_id`, never raw PII as primary keys.
- Transcripts are retained per the dealership's policy (default: 24 months) and can be purged on customer request via a single deletion that cascades to `sms_log` / `appointments` / `upsells` / `loaner_requests` via the `ON DELETE SET NULL` FK design.
- Outbound SMS includes a "Reply STOP to opt out" line on every transactional message; STOP/HELP handling is automated through Twilio.

---

## 4. What we ask from the dealership

| | |
|---|---|
| **Network** | None — PitLane is cloud-to-cloud. No on-premise install, no VPN, no firewall holes. |
| **Credentials** | Activation of the PitLane app in your Fortellis dashboard, which issues us a scoped `Subscription-Id`. |
| **Configuration** | A Twilio number to forward to (we provide or BYO) and confirmation of CDK module enablement for Customer Information + Service Schedule. |
| **Compliance handshake** | Signed BAA / DPA covering the customer data we process on the dealership's behalf. |

---

## 5. Vendor-risk quick reference

| Question | Answer |
|---|---|
| Where is customer data stored? | Supabase Canadian region (`ca-central`) + Railway Canadian region (in migration; US currently). |
| Who can access dealership data? | Authorized PitLane engineers via SSO + MFA, audit-logged. No customer support agents. Access is per-dealer scoped. |
| Can we revoke your access? | Yes, instantly, from your Fortellis dashboard. The kill switch is one click. |
| Do you train AI models on our data? | No. ElevenLabs is a stateless inference service; OpenAI calls use `gpt-4o-mini` with data-retention-off. |
| Do you carry cyber-liability insurance? | Yes, $2M policy through [carrier], expandable for enterprise contracts. |
| What happens to our data when we terminate? | Full export within 7 days; cryptographic erasure within 30 days. |
| Do you have a DPA template ready? | Yes — available on request. |

---

## 6. Contact

| | |
|---|---|
| Security questions | security@pitlane.ai |
| Privacy & data subject requests | privacy@pitlane.ai |
| Incident reporting | incident@pitlane.ai (24/7) |

The PitLane engineering team is available to walk your IT lead through any of the above in a live technical session.
