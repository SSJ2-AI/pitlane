# PitLane — Compliance Audit for Automotive Dealership Sales

**Audience:** internal (founder / GTM prep). Reference doc for pitching PitLane to dealer IT, procurement, and legal teams.
**Scope:** the entire PitLane codebase at commit `36ab0938` — Next.js dashboard (`/`), pitlane-voice microservice (`voice/`), Supabase schema (`supabase/migrations/`), and existing docs.
**Not legal advice.** Every specific claim in a customer conversation should be validated by a privacy/security lawyer licensed in the target jurisdiction.

---

## 0. TL;DR — is PitLane sellable to a dealer today?

| Buyer question | Honest answer |
|---|---|
| "Do you have SOC 2?" | **No report yet.** Roughly 60–70% of the CC-series controls are implemented in code; missing pieces are formal policies, MFA, vendor risk program, pen test report, and the audit itself. Fastest credible answer is "SOC 2 Type I in progress via Vanta/Drata, Type II to follow." |
| "Are you PIPEDA compliant?" | **Yes, with real evidence.** Data resides in Supabase `ca-central-1` (Montréal). Data minimization migration (`0012`) enforced. Audit logging with anonymised IPs. Documented in `docs/compliance-pipeda.md`. |
| "Quebec Law 25?" | **Sellable to Quebec rooftops** given Canadian residency + audit trail + DPA. Still need: PIA support pack per Quebec dealer, French-language privacy notice text, breach-notification SLA in the DPA. |
| "HIPAA?" | **Does not apply.** Automotive dealerships are not HIPAA covered entities. See §3.3 for the clean explanation to give buyers. |
| "PCI DSS?" | **Does not apply today** — PitLane processes zero card data. See §3.4 for what would trigger it (roadmap: ePayments / Invite-2-Pay). |
| "CASL for SMS?" | **Consent gate + STOP text present.** Missing piece: automated STOP/HELP inbound webhook (currently manual). See §3.5. |
| "SSO / SAML?" | **Not yet.** Supabase email+password auth with MFA planned at the IdP layer. Real gap for enterprise (Lithia-scale) deals. |
| "Pen test?" | **Not done.** Schedule one before pilot signature. |
| "DPA / BAA / MSA?" | Templates to be produced. Outline in §4. |

**Bottom line:** PitLane can walk into a dealer conversation credibly *today* on PIPEDA + Quebec Law 25. To land the enterprise (Lithia-scale) go-live it needs (1) SOC 2 Type I in progress with a named auditor, (2) SSO, (3) pen test scheduled, (4) DPA template ready to send, (5) cyber liability policy bound.

---

## 1. What is already built (evidence in code)

Every row below cites the file and, where relevant, line number that implements the control. This is the "we can prove it" list for a vendor questionnaire.

### 1.1 Authentication and session security

| Control | Where | Notes |
|---|---|---|
| Supabase Auth (email + password) sign-in | `src/app/login/page.tsx:64` | `signInWithPassword` from browser client |
| Password reset flow | `src/app/login/page.tsx:99` + `src/app/auth/callback/route.ts:17` | Magic-link exchange |
| Server-side auth gate for every dashboard route | `src/middleware.ts:40-112` | Redirects unauth users to `/login`; rejects users without an active `staff` row |
| Public-path allowlist (no leaks) | `src/middleware.ts:23-30` | Only `/login`, `/api/auth`, `/api/voice`, `/api/lookup`, `/api/voice-status`, `/auth/callback` |
| Session cookies hardened `HttpOnly / Secure / SameSite=Strict` | `src/lib/supabase-server.ts:30-36` | `hardenCookieOptions()` applied in both server and middleware Supabase clients |
| Password policy client-side mirror (12 chars, digit, special) | `src/lib/password-policy.ts:29-39` + `src/app/login/page.tsx:180-188` | Server-side rule enforced via Supabase Auth project config (documented, not code) |
| Explicit session revocation endpoint | `src/app/api/auth/revoke-session/route.ts:69` | `auth.admin.signOut(staffId)` invalidates all refresh tokens for the target |
| Automatic revoke on staff deactivation | `src/app/api/staff/[id]/route.ts:71-73` | Toggling `is_active=false` invalidates the advisor's session immediately |
| Session expiry / refresh token rotation / login rate limiting | Supabase Dashboard config, documented in `docs/compliance-pipeda.md:17-24` | 8h JWT, refresh-token rotation, 5 attempts / 15 min lockout |

### 1.2 Role-based access control (RBAC)

| Control | Where |
|---|---|
| Three roles: `service_advisor`, `service_manager`, `group_manager` | `supabase/migrations/0010_auth_staff.sql:19-28` |
| Role hierarchy + helpers (`canEditDepartments`, `canManageStaff`, `canViewAnalytics`, `canViewGroupConsole`, `dealerFilter`) | `src/lib/role.ts:24-115` |
| Middleware stamps `x-pitlane-role`, `x-pitlane-dealer`, `x-pitlane-user-id` headers (client cannot forge — middleware overwrites) | `src/middleware.ts:105-110` |
| 403 gates on staff management, departments, group console, manager schedule/loaners, appointment status/reschedule, loaner-request create | `src/app/api/staff/route.ts:77`, `src/app/api/departments/route.ts:65`, `src/app/api/group/summary/route.ts:172`, `src/app/api/manager/schedule/route.ts:106`, `src/app/api/appointments/[id]/status/route.ts:42-46`, others |
| Staff list is role-scoped: advisor sees own row, manager sees dealer, group manager sees all | `src/app/api/staff/route.ts:48-56` |

### 1.3 Row-Level Security (defense-in-depth)

Dashboard API routes run with the Supabase **service-role** key, so RLS is currently defense-in-depth for future anon/JWT callers rather than the primary access gate. It is still meaningful because it protects the DB from a compromised or misconfigured secondary consumer.

| Table | Migration | Policy |
|---|---|---|
| `call_logs`, `appointments`, `upsells`, `loaner_requests`, `sms_log` | `0003_multi_tenancy.sql:93-109` | `dealer_isolation_*` filters `dealer_id = current_setting('app.current_dealer_id')::uuid` |
| `staff` | `0010_auth_staff.sql:45-61` | `staff_self_read`, `staff_self_update_profile` |
| `audit_log` | `0011_audit_log.sql:39-44` | `SELECT using (false)` — default-deny; service-role only |
| `service_schedule`, `schedule_overrides` | `0013_service_schedule.sql:89-212` | Role + dealer scoped SELECT/INSERT/UPDATE/DELETE |
| `loaner_vehicles` | `0014_loaner_fleet.sql:73-134` | Same pattern |
| `appointments` (UPDATE path) | `0015_appointment_status.sql:48-70` | Active staff, same dealer, advisor/manager only |

**Tables without RLS in migrations (a gap for later):** `customers`, `dealers`, `sms_consent`, `callback_requests`, `repair_order_assignments`, `departments`, `cdk_sync_queue`.

### 1.4 Audit logging

| Control | Where |
|---|---|
| `audit_log` table | `supabase/migrations/0011_audit_log.sql:19-28` |
| IP anonymisation (/24 IPv4, /48 IPv6) | `src/lib/audit.ts:53-87` — `anonymiseIp()` |
| Application-layer `recordAudit()` fire-and-forget helper | `src/lib/audit.ts:105-138` |
| Actions logged: `view_customer`, `view_call`, `view_group_summary`, `create/edit/delete_department`, `invite_staff`, `deactivate/activate_staff`, `revoke_session`, `save_service_schedule`, `create/delete_schedule_override`, `create/update/delete_loaner_vehicle`, `loaner_request_created`, `update_appointment_status`, `reschedule_appointment` | Grep `recordAudit` in `src/app/api/**` |
| DB-level audit triggers (dual coverage — write happens even if the route forgets) | `0013_service_schedule.sql:223+`, `0014_loaner_fleet.sql:172-175`, `0015_appointment_status.sql:97-100` |
| 24-month retention (spec) | `docs/compliance-pipeda.md:50-51` — scheduled purge job not yet implemented |

### 1.5 Encryption

| Layer | Control | Where |
|---|---|---|
| In transit | TLS 1.2+ on every public endpoint (Vercel, Railway, Supabase, Twilio, ElevenLabs, OpenAI). WSS on screen-pop socket. | Platform-managed |
| At rest — Supabase | AES-256 on the Postgres volume, managed by Supabase. | Platform-managed |
| At rest — application layer (envelope) | `dealers.fortellis_client_secret` and `fortellis_client_id` encrypted with **AES-256-GCM**, format `enc:v1:<iv>:<tag>:<ct>`. Encryption key `FORTELLIS_ENCRYPTION_KEY` lives in Railway env vars, **never in Supabase**. Decrypt happens on demand at the OAuth call site (not eagerly) so plaintext lifetime is bounded to the OAuth handshake. Two-system compromise required. | `voice/src/lib/secrets.ts:18-165`, decrypt via `voice/src/lib/dealer.ts:205-232` `getDealerFortellisCredentials()`, boot self-test at `voice/src/lib/secrets.ts:173-208`, migration script `voice/src/scripts/encrypt-fortellis-secrets.ts`, health probe surfaces `field_encryption` bit at `voice/src/server.ts:91` |

### 1.6 Webhook signature verification (HMAC)

| Webhook | Status | Where |
|---|---|---|
| ElevenLabs `/pre-call` | **Enforced** — HMAC-SHA256 over `<timestamp>.<raw_body>`, 30-min max age, constant-time compare. 401 on failure. | `voice/src/routes/webhook.ts:54-85`, gated `242-246` |
| ElevenLabs `/post-call` | HMAC checked — **logged on failure but payload still processed** so call data isn't silently dropped. Trade-off documented in-file. | `voice/src/routes/webhook.ts:479-482` |
| Twilio inbound (STOP/HELP) | **Not present** — no inbound Twilio route today. Gap; see §2. | — |
| Raw body capture required for HMAC | `voice/src/server.ts:31-37` | |

### 1.7 Multi-tenant / dealer isolation (application layer)

- Session-scoped dealer resolution: `src/lib/dealer.ts:110-149` (`resolveScopeForRequest()`). Group managers get `dealerId: null` (cross-dealer read). Everyone else is pinned.
- **Every** operational query in the dashboard applies `.eq('dealer_id', dealer.id)` at the application layer. Representative sample:
  - `/api/calls`, `/api/calls/[id]`, `/api/customers`, `/api/customers/by-phone/[phone]`, `/api/callbacks`, `/api/departments`, `/api/staff`, `/api/appointments/[id]/status`, `/api/group/summary`, all of `/api/manager/**`.
- Voice service routes calls by Twilio destination number: `voice/src/lib/dealer.ts:82-114` `getDealerByPhone()`.
- All SMS/DB writes carry `dealer_id`: `voice/src/lib/sms.ts:168,197`.

### 1.8 Data minimization (PIPEDA s.4.4)

- Migration `0012_customers_pipeda_minimization.sql:57-59` **drops `name` and `email`** from `public.customers`.
- The application `CustomerRow` type omits those fields; upserts strip them and log a warning if a caller still passes them (`voice/src/lib/supabase.ts:715-803`).
- Name collected mid-call is **not stored locally** — it is queued to CDK via `queueCustomerNameToCdk()` (`voice/src/lib/supabase.ts:852-909`) so CDK remains the sole customer-name source of truth.
- License plates (in `loaner_vehicles`) are treated as **quasi-PII**: never sent over SMS, email, or CDK sync payloads; only displayed in the staff-only manager surface. Rationale in `supabase/migrations/0014_loaner_fleet.sql:18-20` and `docs/compliance-calendar.md:18-33`.

### 1.9 SMS / CASL controls

- `sms_consent(customer_id, opted_in, ...)` table: `supabase/migrations/0002_sms_layer.sql:16-22`, multi-tenanted in `0003`.
- Consent gate before every outbound send: `voice/src/lib/sms.ts:163-189`. Explicit opt-outs create an `sms_log` row with `status='skipped'` for audit completeness. `hasSmsConsent()` (`voice/src/lib/supabase.ts:262-277`) treats "no row" as implicit opt-in (consistent with CASL implied consent for existing business relationships; document this in the DPA).
- STOP/HELP boilerplate on every transactional message: `voice/src/lib/sms.ts:93`.
- Full `sms_log` audit trail of every send (`status`, Twilio SID, FK back to `call_log_id` / `appointment_id` / `loaner_request_id`).

### 1.10 CDK / Fortellis integration (least privilege)

- OAuth 2.0 **client_credentials** flow, per-dealer credentials, per-dealer `Subscription-Id` header on every call: `voice/src/cdk/fortellis.ts:77-156`.
- Tokens cached in-memory only, ~1-hour TTL, invalidated on 401/403.
- Read scope: customer-by-phone + vehicle + open RO + warranty/recalls. Write scope: appointments + notes. **No portfolio-wide read.**
- Sync worker (`voice/src/cdk/sync-worker.ts`) drains `cdk_sync_queue` with 3 retries → `dead_letter` (migration `0004`). Loaner requests are internal-only — never written to CDK (`sync-worker.ts:227-228`).
- Instant dealer kill-switch: revoke the PitLane app from the Fortellis dashboard.

### 1.11 Inter-service API protection

- `POST/GET /api/voice/customer-lookup` (dashboard) protected by `PITLANE_VOICE_API_KEY` shared secret: `src/app/api/voice/customer-lookup/route.ts:118-131,272-285`. Voice service sends the key via `x-pitlane-voice-key`.
- Voice service is stateless; no publicly writable endpoints beyond the two ElevenLabs webhooks (HMAC-gated) and dashboard-shared endpoints.

### 1.12 Data residency reporting

- `GET /health` on the voice service surfaces `residency.voice_compute_region`, `supabase_residency_target`, and the integration flags (Supabase, Twilio, `field_encryption`, Fortellis, git SHA, build stamp). See `voice/src/server.ts:67-127`. Dealer IT can hit `/health` at any time to verify the deploy claim.

### 1.13 Existing internal docs

- `docs/SECURITY_BRIEF.md` — customer-facing 1-pager for vendor risk reviews.
- `docs/COMPLIANCE_ANALYSIS.md` — honest engineering-side threat model; internal only.
- `docs/compliance-pipeda.md` — PIPEDA + Quebec Law 25 operational playbook.
- `docs/compliance-calendar.md` — Phase 13 schedule/loaner table compliance notes.
- `docs/future-features.md` — roadmap (ePayments, Sales BDC, etc.).

---

## 2. What is missing (per compliance framework)

### 2.1 SOC 2 Type II

SOC 2 evaluates five Trust Services Criteria; the relevant ones for a B2B SaaS are **Security (CC-series)**, **Availability (A-series)**, **Confidentiality (C-series)**, and **Privacy (P-series)**. Processing Integrity is optional and rarely in scope.

**What we have (approximate mapping):**

| Control | Status |
|---|---|
| CC1.x — Control environment (ownership, code of conduct) | Policy docs missing |
| CC2.x — Communication (security policy, incident comms) | Not written |
| CC3.x — Risk assessment | Not formalised |
| CC4.x — Monitoring | Ad hoc — Railway/Vercel/Supabase native logs, no SIEM |
| CC5.x — Control activities | Partial — code review via GitHub, deploy gates informal |
| **CC6.1** — Logical access | ✅ Supabase Auth, 3-tier RBAC, RLS on new tables (`0013`+) |
| **CC6.2** — New user registration / removal | ✅ `invite_staff`, `deactivate_staff` with audit + session revoke |
| **CC6.3** — Access modifications | ✅ Manager-authored, audit-logged |
| **CC6.6** — Boundary protection | ✅ Middleware-stamped headers cannot be forged; API-key-gated cross-service call |
| CC6.7 — Transmission of information | ✅ TLS everywhere |
| CC6.8 — Malware / integrity | Partial — no formal SBOM / SCA scan cadence; Dependabot not enabled in visible config |
| **CC7.2** — Monitoring / audit | ✅ `audit_log` + DB triggers on writes; ⚠ 24-month retention job not yet implemented |
| CC7.3 — Incident response | Runbook + comms plan missing |
| CC7.4 — Recovery | Supabase PITR daily backups; no documented DR test |
| **CC8.1** — Change management | ✅ Numbered idempotent SQL migrations with compliance rationale headers; ⚠ no formal change advisory board / ticketing gate |
| CC9.x — Vendor management | Not formalised (no vendor risk register) |
| A1.1 — Availability commitments | ⚠ No documented SLA / SLO |
| A1.2 — Environmental protections | Inherited from cloud providers |
| C1.x — Confidentiality | ✅ Field-level encryption for Fortellis secrets |
| P-series — Privacy | Partial — PIPEDA controls exist; formal privacy notice + data-subject-request process needs to be written |

**Concrete gaps to close before a Type I audit:**

1. **Written policies.** InfoSec policy, acceptable use, access control, change management, incident response, business continuity, vendor management, cryptography, data classification, backup, secure SDLC. Vanta and Drata generate templates for these; you edit + sign.
2. **MFA.** Not implemented anywhere in code. Blocking for CC6.1 in Type II. Requires either SSO (§2.6) or Supabase Auth's TOTP flow wired into `/login`.
3. **Login rate limiting** — currently only Supabase Dashboard project setting. Need an application-layer log with alerting.
4. **Vendor risk register.** Track every sub-processor (Supabase, Railway, Vercel, Twilio, ElevenLabs, OpenAI, Fortellis, Vanta itself), their SOC 2 reports, contract renewal dates.
5. **Employee onboarding/offboarding checklist** (access grant/revoke, laptop hardening, background checks per HR policy).
6. **Formal risk assessment + risk treatment plan.** One-page annual doc.
7. **Business continuity + disaster recovery plan** with a documented test cadence (annual restore-from-backup drill).
8. **Incident response runbook** with roles, escalation tree, 72-hour breach notification target (PIPEDA-aligned; ISO 27001 also expects this).
9. **Data retention purge job.** `audit_log` 24-month, `loaner_requests` 2-year, `call_logs.transcript` 24-month per dealer config — all specced in migration headers, not implemented.
10. **Post-call webhook HMAC — reject on failure** (currently logs + processes). This is technically correct as a resilience call, but a SOC 2 auditor will want either strict enforcement or an explicit compensating control writeup.
11. **RLS as primary gate** — dashboard routes bypass RLS via the service-role key. To claim RLS as the enforcement layer, the auditor will want to see anon/JWT reads too. Not a blocker if the app-layer `.eq('dealer_id', ...)` pattern is explicitly documented as the primary control.
12. **Pen test.** External, OWASP-aligned, remediation report attached to the SOC 2 workpapers.
13. **Cyber liability insurance.** $1–2M policy for early-stage; the DPA will reference it.

**Cost / timing note (informational):** Vanta or Drata is roughly $10–30K/year; Type I audit adds $10–15K. The pilot deal can be signed under a "Type I in progress" letter; enterprise (Lithia-scale) go-live effectively requires a Type II report on the wall.

### 2.2 ISO 27001

ISO 27001 overlaps heavily with SOC 2 CC-series. If a Canadian dealer IT team asks for it, the honest positioning is: "We are building to ISO 27001 controls via our SOC 2 program. The controls in Annex A that a SOC 2 auditor tests are the same ones an ISO 27001 auditor tests." Most Canadian dealer IT teams accept a SOC 2 report as a substitute; formal ISO 27001 certification is usually only required by European buyers.

**Delta on top of SOC 2:**

- **Statement of Applicability** — a document listing all 93 Annex A controls (2022 revision), marking each as included or excluded with justification.
- **Information Security Management System (ISMS)** — the meta-doc describing scope, objectives, review cadence, management review meetings. SOC 2 doesn't formally require an ISMS document; ISO does.
- **Certification body audit** — Stage 1 (documentation review) + Stage 2 (implementation audit). Larger cost + longer cycle than SOC 2.

**Recommendation:** don't chase ISO 27001 until asked by name. When asked, offer the SOC 2 report + a controls-mapping table (SOC 2 CC → ISO 27001 Annex A) as the interim answer.

### 2.3 HIPAA — does not apply

**Automotive dealers are not HIPAA covered entities and PitLane is not a business associate.** HIPAA regulates protected health information (PHI) handled by covered entities (health plans, health care clearinghouses, and health care providers who transmit health information electronically for HIPAA-defined transactions). A car dealership does not fall in any of those categories.

There is a narrow edge case: if a dealer offers a health-plan-like employee benefit (e.g., a self-funded health plan for its own employees), the HR side of the dealership may itself be a covered entity for that plan. **PitLane never touches that data** — Aria only handles service-department interactions with vehicle-owning customers. There is no PitLane path that ingests, stores, transmits, or produces PHI.

The applicable regimes for the customer data PitLane does touch are **PIPEDA** (federal Canada) and, in Quebec, **Law 25**. See §2.5.

If a buyer asks for a BAA anyway (occasionally happens because their vendor questionnaire has a HIPAA checkbox), the answer is: "PitLane does not process PHI. We are happy to sign a DPA that mirrors BAA-equivalent breach-notification and confidentiality obligations under PIPEDA." That usually satisfies procurement.

### 2.4 PCI DSS — does not apply today; roadmap trigger

**PitLane processes zero card data today.** Aria never asks for a card number; SMS/email templates never include payment info; the database has no `card_*` / `pan_*` columns; the CDK integration does not fetch payment instruments. Nothing in the codebase touches account data (PAN, cardholder name, service code, expiration).

The roadmap has one PCI-relevant item: **ePayments ISV / Invite-2-Pay** (`docs/future-features.md:9-18`). That feature sends the customer an SMS payment link handled by CDK ePayments API; the payment happens in CDK/the processor's environment, and PitLane never sees or stores the PAN. This is architected as a "SAQ-A" scope (fully-outsourced e-commerce payments, hyperlink redirect), which is the lightest PCI regime — no scanning, no ROC. **When (not if) we ship it:**

1. Confirm the payment page runs on the processor's domain in an iframe or full redirect — no card fields on PitLane's page.
2. Complete PCI **SAQ-A** annually (short questionnaire, ~30 min once the templates exist).
3. Add the processor to the vendor risk register + sub-processor list.
4. Update the privacy notice + DPA to reference the payment flow.

**Do not** roll into a PitLane form that submits card data to us. That would move us from SAQ-A to SAQ-A-EP or SAQ-D — orders of magnitude more compliance cost.

### 2.5 Canadian regulations (PIPEDA + Quebec Law 25 + CASL)

**PIPEDA (federal).**

- ✅ Consent: dealer's own customer privacy notice covers Aria + PitLane. Sample language should live in the DPA appendix.
- ✅ Purpose limitation: `call_logs`, `sms_log`, `appointments`, `upsells`, `loaner_requests` are all service-department operational tables.
- ✅ Data minimization: migration `0012` dropped `name`/`email` from local `customers`. `license_plate` handling documented (`0014`).
- ✅ Accuracy: CDK remains system of record; PitLane surface writes back via `cdk_sync_queue`.
- ⚠ Retention: 24-month spec exists (`docs/compliance-pipeda.md:50`) — no scheduled purge job.
- ✅ Security: TLS, at-rest AES-256, envelope encryption for dealer credentials, audit logging, RBAC.
- ⚠ Openness: dealer-facing privacy notice template not yet written. Recommend a canned paragraph in the DPA appendix.
- ⚠ Individual access + correction: no self-service "download my data" flow. For now this is dealer-mediated ("email privacy@pitlane.ai" is stubbed in `SECURITY_BRIEF.md:134`). Formal SLA needed in the DPA.
- ⚠ Breach reporting: no documented internal runbook. Needs a 72-hour target (aligns with the OPC's guidance) and a template notification letter.
- ⚠ Challenging compliance: privacy@pitlane.ai mailbox needs owner + response SLA.

**Quebec Law 25 (in force since Sept 2022, key provisions took effect Sept 2023–2024).**

- ✅ Data residency (Supabase `ca-central-1` / Montréal). Voice compute pinned to Railway `us-east4` because there is no Canadian Railway region as of June 2026; voice is stateless and data only transits in flight under TLS. Documented in `voice/railway.toml` and `docs/COMPLIANCE_ANALYSIS.md`.
- ⚠ Privacy Impact Assessment (PIA) support: Law 25 requires a PIA for personal information disclosed outside Quebec. Because voice compute (Railway) is outside Quebec, we need a **PIA support pack** per Quebec dealer — a one-page technical brief the dealer's privacy officer can append to their own PIA. Not yet produced.
- ⚠ **Chief Privacy Officer designation** — Law 25 requires PitLane to designate one (name + contact publicly available). Fine to be a founder in early days; must be on the website.
- ⚠ Consent granularity — Law 25 requires "specific and separate" consent for each purpose. Dealer's customer notice must list SMS separately from call transcription.
- ⚠ Automated decision-making disclosure — Aria triaging + upsell flagging arguably qualifies. Dealer must disclose the existence of automated processing and the customer's right to a human review. One-line in the notice template.
- ⚠ Breach notification: Law 25 requires notification to the Commission d'accès à l'information and to affected individuals if the breach presents "serious risk of injury". Same 72-hour operational target as PIPEDA.
- ⚠ French-language privacy notice text: needed for Quebec rooftops. Translated once, reused.

**CASL (Canada's Anti-Spam Legislation, applies to SMS + email).**

- ✅ Consent gate before every SMS (`voice/src/lib/sms.ts:163-189`).
- ✅ "Reply STOP to opt out" line on every transactional message (`voice/src/lib/sms.ts:93`).
- ✅ Sender identification: templates include the dealership name.
- ⚠ **STOP/HELP inbound webhook — not implemented.** Comment in `supabase/migrations/0002_sms_layer.sql:13-14` and `SECURITY_BRIEF.md:100` says Twilio STOP/HELP replies "should" flip `opted_in → false`, but no Twilio inbound route exists in the codebase. This is a real gap: today an opt-out relies on Twilio's built-in STOP handler (which stops future messages at the carrier level, satisfying CASL) but does NOT update our `sms_consent` table. **Practical impact:** future PitLane logic that reads `sms_consent` may still attempt a send that Twilio then blocks. Fix: add `POST /webhook/twilio-sms` with Twilio-signature verification, parse STOP/UNSUBSCRIBE/CANCEL/END/QUIT, upsert `sms_consent.opted_in = false`.
- ⚠ Consent record retention: CASL requires records of consent for the period the consent is relied upon. Our `sms_consent.opted_in_at` + `source` covers this; document the retention rule in the DPA.
- ⚠ Implied vs express consent: `hasSmsConsent()` treats "no row" as implicit opt-in. Under CASL, an existing business relationship (dealership↔customer) creates 6- or 24-month implied consent depending on the transaction; we should document this in the DPA and configure a `sms_consent.implied_expires_at` column later.

### 2.6 Enterprise dealer IT requirements

| Ask | Status | Effort to close |
|---|---|---|
| **SSO / SAML / OIDC** | Not implemented. Supabase Auth supports SAML in the paid plan; wire the dealer's Okta / Azure AD / Google Workspace as an identity provider. | Moderate |
| **SCIM provisioning** | Not implemented. Manual invite + deactivate flow exists (`/manager/staff`). SCIM matters at Lithia-scale (22 stores × dozens of advisors) but is often deferred to post-pilot. | Moderate — Supabase does not offer SCIM natively; would need a custom endpoint |
| **MFA enforcement** | Not implemented. Either wire Supabase Auth TOTP or push through IdP once SSO lands. | Small if via IdP; moderate if via Supabase TOTP UI |
| **IP allowlisting** | Not implemented. Supabase network restrictions can pin the DB to Railway/Vercel egress IPs; dashboard IP allowlist is a Vercel feature. | Small |
| **Penetration test report** | Not scheduled. External OWASP-aligned test. Remediation attached to SOC 2 workpapers. | Vendor engagement |
| **Vulnerability scanning cadence** | Ad hoc. Add Dependabot / Snyk / GitHub advanced security + a monthly Trivy container scan on the voice service image. | Small |
| **BAA** | Not applicable (see §2.3). Substitute: PIPEDA-flavoured DPA. | Template needed |
| **DPA (Data Processing Agreement)** | Template not yet in repo. Must cover: sub-processor list + notification, data residency claim, breach notification SLA (72h), retention + deletion SLA, audit rights, cyber insurance evidence, jurisdiction (Ontario), termination + data return. | Template needed — reuse commonly available Canadian SaaS DPA scaffolding |
| **MSA** | Standard SaaS MSA with SLA schedule. | Template needed |
| **Cyber liability insurance certificate** | Not bound. $1–2M policy typical for early-stage SaaS; reference in DPA. | External |
| **Sub-processor page** | Not published. List Supabase (ca-central-1), Railway (us-east4), Vercel, Twilio, ElevenLabs, OpenAI, Fortellis, plus SMS/email delivery vendor. Notification of new sub-processors: 30-day advance notice standard. | Doc + link on marketing site |
| **Status page / uptime commitments** | Not published. Vercel + Railway + Supabase status is externally visible; a simple statuspage.io / hosted-status page listing "PitLane Dashboard / PitLane Voice / Supabase / Fortellis" is cheap. | External vendor |
| **DPIA / PIA support** | Not packaged. Produce a 1-page "PitLane technical PIA" the dealer's privacy officer can append to theirs. | Doc |
| **Retention configurability per dealer** | Documented, not exposed. Currently a global 24-month default. Enterprise buyers want a per-dealer knob. | Config table + backfill job |
| **Right-to-be-forgotten workflow** | Not implemented. Needs a self-service "delete customer" endpoint that removes `call_logs.transcript`, `sms_log.message`, `customers` row, `callback_requests`, and drops FKs on `appointments`/`upsells`/`loaner_requests`. | New endpoint + audit hook |
| **Data export on termination** | Documented ("7 days" in `SECURITY_BRIEF.md:124`), not implemented. Need a per-dealer S3-style export bundle. | Script + runbook |

---

## 3. Miscellaneous framework Q&A the buyer will ask

### 3.1 "Do you train AI models on our data?"

**No.** OpenAI calls use `gpt-4o-mini` with data-retention-off. ElevenLabs is stateless inference (they retain the transcript for their own retention window, which PitLane doesn't control — document this in the DPA under sub-processors). This is a canned answer in `SECURITY_BRIEF.md:122`; keep it consistent.

### 3.2 "Can you show us your data flow?"

`docs/SECURITY_BRIEF.md:15-47` has an ASCII diagram we can send in the first email. For a live technical walk-through: `README.md:15-47` shows the same flow with more detail.

### 3.3 "What if the dealer's IT team wants to run their own security scan against your service?"

Fine for the dashboard (`https://<dealer>.pitlane.ai`) — Vercel handles the traffic. Voice service is Railway-managed; a scan against `/health` is fine. A full DAST/pen-test against production should be coordinated (rate limits, IP allowlist for the scanner, avoid triggering the ElevenLabs/OpenAI cost meters). The DPA should require 5 business days advance notice for scheduled scans.

### 3.4 "What about breach notification timing?"

PIPEDA + Quebec Law 25 both target "as soon as feasible". Operational commitment we can make in the DPA:

- Detection → internal triage: 24 hours
- Internal triage → PitLane notifies dealer: within 72 hours of confirmed breach
- Dealer → downstream customer notification: driven by dealer under their own privacy notice
- OPC / CAI notification: 72-hour SLA on PitLane's side; dealer files with the regulator under their own name

### 3.5 "What happens to our data when we terminate?"

Current documented answer (`SECURITY_BRIEF.md:124`): "Full export within 7 days; cryptographic erasure within 30 days." Neither is implemented as a self-service action. Roadmap: `POST /admin/export-dealer/<id>` producing a signed JSON bundle + a `DELETE /admin/dealer/<id>` that cascades. Until those exist, the operational answer is "manual export via `pg_dump` filtered on `dealer_id`, delivered under NDA".

---

## 4. What to produce for a dealer's IT / legal sign-off

The following are the concrete artifacts a Canadian dealer procurement team will ask for. Producing them once and reusing them will collapse the sales cycle from "months of back-and-forth" to "one round of redlines".

### 4.1 Contract templates (customer-facing)

1. **Master Services Agreement (MSA)** — standard SaaS terms, Ontario law, uncapped for gross negligence + wilful misconduct, cap-at-fees for everything else, mutual indemnity.
2. **Data Processing Agreement (DPA)** with these sections:
   - Definitions (personal information per PIPEDA + Law 25).
   - Roles: dealer is controller, PitLane is processor.
   - Sub-processor list + 30-day change notification.
   - Data residency claim (Supabase ca-central-1; Railway us-east4 for stateless compute; explanation).
   - Security measures (link to `SECURITY_BRIEF.md` or embed).
   - Breach notification SLA (72 hours to dealer; PitLane assists dealer's regulator notification).
   - Data-subject-request assistance SLA (10 business days).
   - Retention + deletion (24-month default; per-dealer configurable; 30-day deletion after termination).
   - Audit rights (annual, at dealer's cost, or acceptance of SOC 2 report in lieu).
   - Cyber insurance evidence.
   - International transfers appendix (US processing for OpenAI, ElevenLabs, Twilio → covered by their respective standard contractual clauses + adequacy analysis).
3. **Service Level Agreement (SLA)** — availability target (99.5% dashboard, 99.9% voice inbound), response time to P1/P2/P3 tickets, service credits.
4. **Acceptable Use Policy (AUP)** — standard; prohibits using Aria to circumvent do-not-call lists, etc.

### 4.2 Security artifacts (send under NDA)

1. **PitLane Security & Data Privacy Brief** — `docs/SECURITY_BRIEF.md`, ready today.
2. **SOC 2 Type I / II report** — pending. Interim: "SOC 2 readiness letter" from Vanta/Drata.
3. **Pen test report + remediation summary** — pending.
4. **Cyber liability insurance certificate** — pending (bind first).
5. **Sub-processor list** — one-pager, machine-readable JSON also acceptable.
6. **Security questionnaire responses** — pre-fill the SIG Lite (~120 questions) once; reuse. CAIQ v4 also common.
7. **Business continuity plan summary** — 1 page: RPO/RTO targets, backup cadence, DR test cadence.
8. **Incident response runbook summary** — 1 page: who does what, escalation tree.
9. **Change management summary** — 1 page: PR review, migration cadence, deploy approval.

### 4.3 Privacy artifacts (send under NDA; some are dealer-facing)

1. **Privacy Notice paragraph the dealer inserts into their own customer-facing notice.** Sample:
   > "This dealership uses PitLane, a Canadian-hosted AI service provider, to answer service calls, transcribe conversations, and coordinate service appointments. Call transcripts, SMS messages, and appointment records are stored in Canada. Personal information is processed for the purpose of delivering vehicle service and related communications. To request access to or deletion of your personal information, please contact us."
2. **Privacy Impact Assessment (PIA) technical support pack** — 2–3 pages the Quebec dealer's privacy officer can append to their own PIA.
3. **Data-Subject-Request runbook** — internal doc; explains how to answer access, correction, and deletion requests within the SLA.
4. **CASL compliance memo** — one-pager explaining the STOP/HELP flow, implied vs. express consent, record retention.
5. **French-language versions of all customer-facing text** (for Quebec).

### 4.4 Corporate / procurement artifacts

1. **W-9 / GST number / vendor onboarding form** — standard.
2. **Certificate of good standing** — from your incorporation registry.
3. **Bank details / ACH form** — standard.
4. **Insurance certificates** — cyber, E&O, general liability if the dealer asks.
5. **Chief Privacy Officer designation letter** (Law 25 requirement).
6. **Named security contact + 24/7 incident inbox** — mailbox owner assigned and monitored.

### 4.5 Marketing / trust artifacts

1. **Public status page** — statuspage.io or equivalent.
2. **Public sub-processor list** on the marketing site.
3. **Public privacy policy** — even for a B2B tool, dealer procurement will Google `pitlane.ai/privacy` and expect a page.
4. **Public trust page** — one place listing SOC 2 status, ISO 27001 status, pen test cadence, sub-processors. Vanta/Drata offer a hosted one.

---

## 5. Priority order (if we can only do a few things before the next dealer call)

1. **Sign up for Vanta or Drata** and kick off SOC 2 Type I. The "in progress" story is enough to keep the pilot conversation open.
2. **Draft the DPA + MSA templates.** These get redlined at every deal; having them ready removes the biggest source of sales-cycle friction.
3. **Bind cyber liability insurance.** $1–2M policy. Referenced in the DPA.
4. **Publish the public privacy policy + sub-processor list + trust page.** Dealer procurement teams Google these first.
5. **Ship the Twilio STOP/HELP inbound webhook** and update `sms_consent` on opt-out. Small change; closes the one visible CASL gap.
6. **Implement the retention purge job** for `audit_log` (24 months) and `call_logs.transcript` (24 months, dealer-configurable). This backs up the retention claims in the DPA.
7. **Wire MFA** — even as an optional flag per staff member — to close the CC6.1 gap for SOC 2.
8. **Pen test** — schedule with a Canadian firm (Bishop Fox, TrustedSec, Coalition, etc.). Report attached to SOC 2 workpapers.
9. **SSO / SAML** — Supabase Auth SAML for the enterprise deals. Deferable until the first Lithia-scale conversation.

Items 1–4 unblock the *conversation*; items 5–9 unblock the *contract*.

---

## Appendix A — evidence map (control → migration / code)

| Control | Evidence |
|---|---|
| Multi-tenancy foundation | `supabase/migrations/0003_multi_tenancy.sql` |
| RLS dealer isolation | `supabase/migrations/0003_multi_tenancy.sql:93-109` |
| Staff RBAC | `supabase/migrations/0010_auth_staff.sql`; `src/lib/role.ts` |
| Audit log + IP anonymisation | `supabase/migrations/0011_audit_log.sql`; `src/lib/audit.ts:53-138` |
| Data minimization | `supabase/migrations/0012_customers_pipeda_minimization.sql`; `voice/src/lib/supabase.ts:715-803` |
| Envelope encryption for Fortellis secrets | `voice/src/lib/secrets.ts:18-208`; `voice/src/lib/dealer.ts:205-232` |
| HMAC webhook verification | `voice/src/routes/webhook.ts:54-85` |
| Session cookie hardening | `src/lib/supabase-server.ts:30-36` |
| Password policy | `src/lib/password-policy.ts:29-39` |
| Session revocation | `src/app/api/auth/revoke-session/route.ts`; `src/app/api/staff/[id]/route.ts:71-73` |
| SMS consent gate | `voice/src/lib/sms.ts:163-189`; `voice/src/lib/supabase.ts:262-277` |
| Cross-service API key | `src/app/api/voice/customer-lookup/route.ts:118-131` |
| Residency reporting | `voice/src/server.ts:67-127` |
| Schedule + loaner RLS + audit triggers | `supabase/migrations/0013_service_schedule.sql`; `0014_loaner_fleet.sql` |
| Appointment status RLS + audit trigger | `supabase/migrations/0015_appointment_status.sql:48-100` |

## Appendix B — known gaps (single-page pull-out)

| Gap | Impact | Effort to fix |
|---|---|---|
| No SOC 2 report | Enterprise IT will not sign go-live | External audit engagement |
| No MFA in code | CC6.1 blocker for Type II | Moderate |
| No SSO/SAML | Enterprise IT deal-breaker at scale | Moderate |
| No Twilio STOP/HELP inbound handler | CASL: opt-outs don't reach `sms_consent` (Twilio still blocks the send at carrier level) | Small |
| Post-call HMAC logs but doesn't reject | SOC 2 compensating-control writeup needed | Small |
| No retention purge job | 24-month claim unenforceable | Small–moderate |
| No self-service delete-customer endpoint | PIPEDA + Law 25 individual-rights response is manual | Moderate |
| No DPA / MSA / SLA templates | Every deal starts from scratch | Legal / doc |
| No cyber insurance bound | DPA reference impossible | External |
| No pen test | SOC 2 workpapers incomplete | External |
| Login rate limiting only at Supabase Dashboard, not app layer | Alerting gap | Small |
| RLS bypassed by service-role key in dashboard routes | Not a bug, but the auditor will want the app-layer `.eq('dealer_id')` pattern explicitly documented as the primary control | Doc |
| No public status page | Procurement will notice | External vendor |
| No sub-processor list on the marketing site | Procurement will notice | Doc |
| No French-language privacy notice | Quebec dealers | Translation |
| No PIA support pack per dealer | Quebec dealers | Doc |

---

*Prepared as an internal reference. Update alongside every migration that touches a compliance-relevant table.*
