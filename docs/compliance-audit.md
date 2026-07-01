# PitLane Compliance Audit for Automotive Dealer Procurement

Internal engineering review for dealership IT, legal, and procurement
conversations. This is not legal advice; have counsel validate external claims
before sending this outside PitLane.

## Executive summary

PitLane has meaningful compliance foundations already in the codebase: Supabase
Auth-backed staff access, role-aware dashboard routing, dealer-scoped data
models, RLS on several operational tables, PIPEDA/Law 25-oriented audit logging,
field-level encryption for Fortellis client secrets, SMS consent/logging
plumbing, and Canada-first data residency documentation.

The posture is not yet enterprise-complete. The biggest gaps for dealer IT are:
SOC 2 Type II is not complete, ISO 27001 is not mapped, SSO/SAML is not
implemented, SMS/CASL opt-out handling is incomplete, retention/deletion jobs
are documented but not automated, several voice-service endpoints need stronger
authentication, and vendor paperwork such as a DPA, subprocessor list, incident
response runbook, pen-test report, and security questionnaire answers must be
packaged.

## Evidence reviewed

- Dashboard app: `src/app`, `src/lib`, `src/middleware.ts`
- Voice service: `voice/src`, especially webhooks, tools, SMS, CDK/Fortellis,
  Supabase helpers, and health checks
- Supabase schema: `supabase/migrations/0001` through `0016`
- Existing docs: `README.md`, `docs/SECURITY_BRIEF.md`,
  `docs/COMPLIANCE_ANALYSIS.md`, `docs/compliance-pipeda.md`,
  `docs/compliance-calendar.md`, `docs/future-features.md`, `voice/README.md`,
  `voice/railway.toml`

## 1. Compliance and security features already built in

### Authentication and session security

Concrete features:

- Supabase Auth middleware guards dashboard routes in `src/middleware.ts`.
  Unauthenticated users are redirected to `/login`; users without an active
  `staff` row are denied.
- Staff session context is stamped into server-only request headers:
  `x-pitlane-role`, `x-pitlane-dealer`, `x-pitlane-user-id`,
  `x-pitlane-staff-id`.
- Auth cookies are configured server-side in `src/lib/supabase-server.ts` with
  `HttpOnly`, production `Secure`, and `SameSite=Strict`.
- Staff deactivation calls Supabase Admin sign-out in
  `src/app/api/staff/[id]/route.ts`, invalidating active sessions.
- `src/app/api/auth/revoke-session/route.ts` allows manager-triggered session
  revocation.
- Password complexity is represented in `src/lib/password-policy.ts` and
  documented in `docs/compliance-pipeda.md`.

Important limitation:

- This is Supabase email/password and invite-based auth today. Dealer SSO/SAML
  and MFA enforcement at the dealer IdP are not implemented in code.

### Role-based access control

Concrete features:

- Roles are centralized in `src/lib/role.ts`: `service_advisor`,
  `service_manager`, and `group_manager`.
- Permission helpers gate manager/group features such as department edits,
  staff management, analytics, and group console access.
- Staff and manager routes check role before write operations, including
  department management, staff invites/deactivation, schedule overrides, loaner
  vehicle management, appointment status changes, and reschedules.
- `resolveScopeForRequest()` in `src/lib/dealer.ts` uses the middleware session
  to scope dealer-level vs. group-level access.

Important limitations:

- Some older routes still use legacy dealer resolution that accepts
  `?dealer_id=` or `x-dealer-id`. Those should be migrated to
  `resolveScopeForRequest()` before enterprise deployment.
- Group-manager write restrictions should be reviewed route-by-route.

### Multi-tenancy and row-level security

Concrete features:

- `supabase/migrations/0003_multi_tenancy.sql` adds `dealer_id` to operational
  tables and enables RLS on `call_logs`, `appointments`, `upsells`,
  `loaner_requests`, and `sms_log`.
- Later migrations add staff-aware RLS for `staff`, `service_schedule`,
  `schedule_overrides`, `loaner_vehicles`, and appointment status updates.
- Dashboard API routes commonly add application-layer `.eq('dealer_id', ...)`
  filters.
- The voice service resolves the dealership from the dialed Twilio number via
  `voice/src/lib/dealer.ts`.

Important limitations:

- The dashboard and voice service use Supabase service-role keys server-side,
  which bypass RLS. Application-layer dealer filtering is therefore critical.
- The RLS policies in `0003` depend on `app.current_dealer_id`, but the current
  service-role path does not set that value.
- Several tables lack complete RLS coverage, including `customers`, `dealers`,
  `sms_consent`, `cdk_sync_queue`, `callback_requests`,
  `repair_order_assignments`, and `departments`.

### Audit logging

Concrete features:

- `supabase/migrations/0011_audit_log.sql` creates `audit_log` for staff access
  and actions.
- `src/lib/audit.ts` anonymizes IP addresses before logging:
  - IPv4 truncated to `/24`
  - IPv6 truncated to `/48`
- API routes call `recordAudit()` for many sensitive reads/writes, including
  customer views, call list views, callback views, staff changes, department
  edits, group summary access, schedule changes, loaner changes, and appointment
  lifecycle actions.
- Schedule and loaner migrations include database triggers that write audit
  entries for data changes.
- Operational audit trails also exist:
  - `call_logs` stores call metadata, transcript, summary, status, and IDs.
  - `sms_log` stores outbound SMS attempts and status.
  - `cdk_sync_queue` stores outbound CDK write payloads and sync status.

Important limitations:

- Audit coverage is not complete. High-sensitivity detail routes, especially
  call transcript detail views, should be reviewed for `recordAudit()` coverage.
- Audit logging is best-effort and logs failures to the console; there is no
  alerting/SIEM integration.
- There is no built dashboard UI for compliance officers to review audit logs.

### Data minimization and PIPEDA/Law 25 design

Concrete features:

- `supabase/migrations/0012_customers_pipeda_minimization.sql` removes local
  `customers.name` and `customers.email`; CDK is treated as source of truth.
- The local `customers` table is documented as a metadata index: phone,
  dealer, CDK pointer, new/returning flag, call counts, sentiment, and
  operational notes.
- `voice/src/lib/supabase.ts` ignores deprecated name/email fields passed to
  customer upsert and logs a warning.
- `queueCustomerNameToCdk()` queues collected names to CDK instead of storing
  them locally in `customers`.
- Audit IP anonymization is implemented for data minimization.
- Loaner fleet docs and schema treat license plates as quasi-PII and state they
  should not be sent over SMS or CDK sync payloads.
- The post-call webhook now persists missing caller phones as SQL `NULL` and
  skips customer auto-creation when no phone is found.

Important limitations:

- PitLane still stores first-party PII in `call_logs.caller_phone`,
  `call_logs.transcript`, `call_logs.summary`, `sms_log.to_phone`,
  `sms_log.message`, and some free-text operational notes.
- Retention and deletion are documented but not automated.
- There is no formal DSAR/deletion workflow or admin UI.

### Encryption and key management

Concrete features:

- Supabase platform encryption at rest is relied on for Postgres storage.
- TLS is used in transit for browser/API/vendor calls.
- `voice/src/lib/secrets.ts` implements AES-256-GCM envelope encryption for
  `dealers.fortellis_client_secret`.
- `FORTELLIS_ENCRYPTION_KEY` lives in the voice-service environment, not in
  Supabase.
- Fortellis secrets are decrypted on demand in `voice/src/lib/dealer.ts`, not
  eagerly at service boot.
- There is a script for encrypting existing Fortellis secrets:
  `voice/src/scripts/encrypt-fortellis-secrets.ts`.
- The voice `/health` endpoint reports whether field encryption is configured.

Important limitations:

- There is no documented automated key rotation process.
- Supabase service-role keys remain highly privileged secrets.
- Transcripts, phone numbers, SMS bodies, and license plates are not
  application-layer encrypted column-by-column.

### Webhook and integration security

Concrete features:

- ElevenLabs pre-call webhook supports HMAC-SHA256 verification with a timestamp
  replay window and constant-time signature comparison in
  `voice/src/routes/webhook.ts`.
- Raw body capture for signature verification is configured in
  `voice/src/server.ts`.
- The dashboard voice customer lookup route supports an API key through
  `PITLANE_VOICE_API_KEY`.
- Fortellis OAuth tokens are cached in memory and invalidated on authorization
  failures.

Important limitations:

- The post-call webhook currently logs signature failures and continues
  processing. This was intentional for availability, but dealer IT may see it
  as a control weakness.
- Several voice endpoints need authentication hardening before enterprise use:
  `/tools/*`, `/events/call-completed`, `/sms/send`, `/cdk/drain`, demo routes,
  and WebSocket screen-pop.
- There is no application-level rate limiting or WAF configuration in the repo.

### SMS consent and CASL-related features

Concrete features:

- `supabase/migrations/0002_sms_layer.sql` creates `sms_consent` and `sms_log`.
- `voice/src/lib/sms.ts` checks consent before dispatch when a customer ID is
  known.
- Opted-out sends are logged as `skipped` in `sms_log`.
- SMS sends are centralized through the voice SMS dispatcher.
- Transactional SMS templates exist for appointment confirmations, reminders,
  loaners, car-ready messages, parts-arrived messages, updates, and custom
  messages.

Important limitations:

- CASL is not named or mapped in the docs.
- Missing `sms_consent` rows are treated as implicitly opted in.
- STOP/HELP inbound handling is documented as expected but not implemented.
- Not all SMS templates include explicit STOP language.
- Consent capture source/timestamp process is not production-ready.

### Data residency and hosting transparency

Concrete features:

- The docs state that PII at rest should live in Supabase `ca-central-1`
  (Canada).
- `voice/railway.toml` documents that Railway voice compute is pinned to
  `us-east4` because Railway has no Canadian region available in this setup.
- The voice service is designed as stateless compute; the stated residency
  anchor is Supabase, not Railway.
- `/health` exposes residency and integration flags for operational checks.

Important limitations:

- Voice data transits through US compute during calls.
- Existing docs contain inconsistent statements about Railway Canadian
  availability and whether the voice service is in the same region as Supabase.
  Clean these up before sharing externally.

## 2. Framework-specific gaps and additions needed

### SOC 2 Type II

Controls that already map well:

- Logical access: Supabase Auth, staff table, role hierarchy, session revocation.
- Tenant isolation: `dealer_id` data model, many application-level dealer
  filters, partial RLS.
- Auditability: `audit_log`, `call_logs`, `sms_log`, `cdk_sync_queue`.
- Change management evidence: numbered Supabase migrations and documented
  compliance comments.
- Encryption: Supabase at-rest encryption plus Fortellis secret envelope
  encryption.
- Availability basics: stateless voice service and graceful no-op behavior when
  optional integrations are missing.

Gaps before Type II readiness:

- Formal control owner matrix and evidence collection program.
- Completed SOC 2 Type I/Type II report from an auditor.
- Comprehensive access review process for engineers and production systems.
- MFA/SSO enforcement for employees and dealer users.
- Formal incident response plan, tabletop exercises, and breach notification
  workflow.
- Vendor/subprocessor risk management records for Supabase, Railway,
  ElevenLabs, OpenAI, Twilio, Fortellis/CDK, and any monitoring vendors.
- Automated retention/deletion jobs and evidence that they run.
- Complete audit logging coverage and audit-log review workflow.
- Centralized logging, alerting, and security monitoring.
- Auth hardening for all voice endpoints.
- Pen-test report and remediation tracking.
- Vulnerability management and dependency scanning evidence.
- Backup/restore testing evidence and RPO/RTO statements.

### ISO 27001

What exists:

- Several controls can be mapped to ISO Annex A themes: access control,
  logging, cryptography, supplier relationships, data minimization, and change
  management through migrations.

What is missing:

- No ISO 27001 certification, ISMS scope, Statement of Applicability, risk
  register, internal audit process, management review process, or Annex A
  control mapping is present in the repo.
- No documented asset inventory, acceptable use policy, secure development
  policy, access review policy, supplier review policy, incident response
  policy, or business continuity test evidence.

Recommended answer if a dealer asks:

> PitLane is not ISO 27001 certified today. We can provide a security brief,
> architecture overview, control mapping, DPA, subprocessor list, and SOC 2
> readiness materials. If ISO 27001 becomes a contractual requirement, we need
> to build an ISMS and complete a formal certification process.

### HIPAA

Why HIPAA generally does not apply:

- PitLane is an automotive dealership service platform.
- Automotive dealers are not HIPAA covered entities by virtue of selling or
  servicing vehicles.
- PitLane is not providing services to a healthcare covered entity or health
  plan in this use case.
- PitLane should not sign a HIPAA BAA for ordinary dealership deployments
  because the product is not designed as a HIPAA business associate service.

What still matters:

- Call transcripts may incidentally capture sensitive personal information,
  such as a customer volunteering a medical condition to explain scheduling
  needs. That is not automatically HIPAA PHI in this context, but it is still
  sensitive personal information under general privacy and contractual security
  obligations.
- PIPEDA, Quebec Law 25, provincial privacy expectations, and contractual DPA
  terms are the relevant framework for Canadian dealerships.

Recommended answer if a dealer asks:

> HIPAA is not the governing framework for PitLane in an automotive dealership
> deployment. We do not process protected health information on behalf of a
> healthcare covered entity. We treat any sensitive information incidentally
> disclosed during calls as personal information under our privacy and security
> controls.

### PCI DSS

Current state:

- No cardholder data environment is implemented in the repo.
- No card numbers, CVV, magnetic stripe data, or payment authorization flows are
  processed by PitLane today.
- `docs/future-features.md` discusses possible CDK ePayments / Invite-2-Pay
  payment links, but this is not an active code path.

If PitLane adds payments:

- Keep PitLane out of PCI scope by redirecting customers to a PCI-compliant
  hosted payment page controlled by CDK/payment processor.
- Do not collect, transmit, log, or store PAN/CVV in PitLane, ElevenLabs,
  Twilio SMS bodies, transcripts, or support tools.
- Add payment-specific logging redaction and transcript redaction rules.
- Obtain the payment processor AOC and define PitLane's SAQ scope, likely SAQ A
  if PitLane only redirects and never handles card data.
- Update privacy policy, DPA, incident response plan, and vendor questionnaire
  answers.

### Canadian law: PIPEDA, Quebec Law 25, and CASL

PIPEDA controls already present:

- Accountability and audit logging through `audit_log`.
- Data minimization through the CDK-first `customers` table redesign.
- Safeguards through auth, role gates, encryption, and tenant scoping.
- Transparency docs around PII inventory and cross-border processing.
- Retention principles documented for transcripts, audit logs, and loaners.

PIPEDA gaps:

- No automated retention/deletion jobs.
- No DSAR workflow, deletion API, or export process.
- No finalized customer-facing privacy notice language.
- No complete audit review process.

Quebec Law 25 controls already present:

- Canada-at-rest data residency posture with Supabase `ca-central-1`.
- Audit logging and IP minimization.
- Data minimization of local customer profile fields.
- Documentation acknowledges cross-border transfer obligations.

Quebec Law 25 gaps:

- No privacy impact assessment template for Quebec dealers.
- No finalized contractual language for cross-border transfers/subprocessors.
- Voice compute currently transits US infrastructure.
- No documented privacy officer process, breach notification workflow, or
  French-language consumer rights process.

CASL/SMS controls already present:

- `sms_consent` schema.
- Consent gate in SMS dispatcher.
- `sms_log` audit trail.
- STOP language exists in at least one transactional template.

CASL/SMS gaps:

- No explicit CASL policy or mapping.
- No inbound STOP/HELP webhook that flips `sms_consent.opted_in` to false.
- Missing consent defaults are permissive.
- Consent source and express/implicit consent basis must be captured from CDK or
  dealership systems.
- STOP language should be included consistently.
- Marketing/promotional SMS should be disallowed unless express consent and all
  CASL identification/unsubscribe requirements are met.

### General dealer enterprise IT requirements

Common requirements PitLane does not yet fully satisfy:

- SSO/SAML/OIDC with Okta, Azure AD, or Google Workspace.
- Enforced MFA through the dealer IdP.
- SCIM or automated user lifecycle management.
- Formal RBAC matrix by dealer role.
- Annual penetration test report.
- SOC 2 Type II report or bridge letter.
- Cyber insurance certificate.
- DPA and subprocessor list.
- Privacy policy and product-specific data handling addendum.
- Data retention schedule and deletion certificate process.
- Incident response plan with notification timelines.
- Security questionnaire package.
- Vulnerability management and dependency scanning evidence.
- Centralized logging/SIEM and alerting.
- Backup/restore test evidence.
- Disaster recovery and business continuity plan.
- Production access policy for PitLane engineers.
- Customer data export and secure deletion process.
- Support access workflow and audit trail.
- Rate limiting and abuse protection on public endpoints.
- Security headers/CSP/HSTS on the dashboard.

## 3. Vendor sign-off package needed for dealer IT/legal

Produce these artifacts before a serious enterprise procurement review:

### Legal and privacy documents

- Master services agreement template.
- Data processing agreement template.
- Canadian privacy addendum covering PIPEDA and Quebec Law 25.
- Subprocessor list:
  - Supabase
  - Railway
  - ElevenLabs
  - OpenAI
  - Twilio
  - Fortellis/CDK
  - Any monitoring/logging vendors
- Subprocessor change notification terms.
- Customer-facing privacy notice language dealerships can add to their own
  privacy policy.
- Call recording/transcription disclosure language.
- Quebec Law 25 privacy impact assessment template.
- Data retention and deletion policy.
- DSAR/export/deletion request procedure.
- Incident notification and breach response terms.
- Optional: DPA schedules describing data categories, purposes, retention,
  subprocessors, cross-border transfers, and security measures.

### Security documentation

- Dealer-facing security brief refreshed to remove stale or overstated claims.
- Architecture diagram with data flows:
  - Dealer/customer phone call
  - ElevenLabs
  - PitLane voice service
  - Supabase
  - Dashboard
  - Twilio SMS
  - OpenAI summarization
  - Fortellis/CDK
- Data inventory and classification table.
- Access control/RBAC matrix.
- Encryption and key management summary.
- Production access policy for PitLane personnel.
- Logging and audit policy.
- Vulnerability management policy.
- Secure SDLC/change management policy.
- Backup, disaster recovery, and business continuity plan.
- Incident response runbook.
- Pen-test report and remediation summary.
- SOC 2 readiness/control matrix; eventually SOC 2 Type II report.
- Cyber insurance certificate.
- Security questionnaire answer bank.

### Technical remediation before external claims

- Enforce authentication/signature validation for all voice write endpoints, or
  isolate internal-only endpoints from the public internet.
- Decide whether post-call HMAC failures should be rejected in production.
- Add Twilio inbound STOP/HELP webhook and update `sms_consent`.
- Make SMS opt-out language consistent.
- Implement retention/deletion jobs for transcripts, SMS logs, audit logs, and
  resolved operational records.
- Add a DSAR/deletion/export workflow.
- Complete audit logging coverage for transcript/detail reads.
- Migrate legacy dealer resolution routes to session-scoped resolution.
- Add SSO/SAML/OIDC and MFA support.
- Add rate limiting and security headers.
- Add centralized logging/alerting and operational security monitoring.
- Clean up residency contradictions in docs before sharing them.

## 4. Recommended procurement positioning

For pilots:

> PitLane has implemented core safeguards for dealership data: scoped staff
> access, dealer-level data segregation, audit logging, Canadian data residency
> at rest, encrypted Fortellis secrets, and documented PIPEDA/Law 25 controls.
> For a pilot, we can provide the security brief, architecture, DPA,
> subprocessor list, and questionnaire responses.

For enterprise rollouts:

> Before broad rollout, PitLane should provide SOC 2 evidence or a formal
> readiness package, a completed pen test, SSO/MFA support, automated retention
> and deletion controls, a finalized incident response process, and complete
> CASL/SMS opt-out handling.

Avoid saying:

- "We do not store PII." PitLane stores transcripts, phone numbers, summaries,
  and SMS bodies.
- "HIPAA compliant." HIPAA is not the applicable framework for automotive
  dealership deployments.
- "SOC 2 certified." The docs say SOC 2 is in progress, not complete.
- "STOP/HELP is fully automated." The consent table exists, but the inbound
  STOP/HELP handler is not implemented.
- "All data stays in Canada." Supabase is Canada-at-rest, but voice compute
  currently transits US infrastructure.

## 5. Priority gap list

1. Package DPA, privacy addendum, subprocessor list, and security questionnaire
   answers.
2. Implement SSO/SAML/OIDC and MFA support for dealer users.
3. Harden voice endpoint authentication and production webhook verification.
4. Implement CASL-grade SMS STOP/HELP handling and consent capture.
5. Automate retention, deletion, and data export workflows.
6. Complete audit logging coverage and add audit review tooling.
7. Fix legacy dealer scoping routes that can accept client-supplied dealer IDs.
8. Produce incident response, vulnerability management, access review, and
   backup/DR policies.
9. Complete a third-party penetration test and track remediation.
10. Enter and evidence a SOC 2 Type I/Type II program before enterprise-scale
    rollout.
