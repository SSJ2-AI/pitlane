# PitLane Compliance Audit (Codebase + Docs)

_Last updated: 2026-07-01_  
_Scope reviewed: `/src`, `/voice/src`, `supabase/migrations`, and all files in `/docs`_

> Internal working document for sales + IT/procurement conversations.  
> Not legal advice.

---

## Executive summary

PitLane already has meaningful compliance/security controls implemented in code (multi-tenant data model, role-based auth, session hardening, encryption patterns, audit logging primitives, and PIPEDA-driven data minimization work).  

The biggest blockers for enterprise dealership sign-off today are:

1. **Controls that are documented but not fully operationalized** (retention purge, DSAR/deletion workflow, incident response runbook, formal evidence artifacts).
2. **Inconsistent tenant-scoping patterns across APIs** (`resolveScopeForRequest` exists, but many routes still use legacy `resolveDealerForRequest` behavior).
3. **SMS/CASL gaps** (implicit opt-in defaults and no inbound STOP/HELP webhook handling in code).
4. **Enterprise assurance gaps** (SOC 2 Type II report absent, no ISO 27001 ISMS artifacts, no SSO/SAML yet, no published pen test report in repo).

---

## 1) Compliance/security features already built (concrete, in code/docs)

### 1.1 Data minimization and privacy-by-design

- **PIPEDA minimization migration shipped**: `supabase/migrations/0012_customers_pipeda_minimization.sql`
  - Drops local `customers.name` and `customers.email`.
  - Positions CDK as source of truth for identity profile fields.
- **Voice-side enforcement present**: `voice/src/lib/supabase.ts`
  - `upsertCustomerByPhone` ignores name/email and warns if passed.
- **Schedule tables intentionally non-PII**: `supabase/migrations/0013_service_schedule.sql`.
- **IP anonymization logic exists for audit records**: `src/lib/audit.ts` (`anonymiseIp`).

### 1.2 Tenant isolation and access control

- **Dealer tenancy model implemented at schema level**: `supabase/migrations/0003_multi_tenancy.sql`
  - `dealer_id` on operational tables.
- **RLS enabled on multiple key tables**: `call_logs`, `appointments`, `upsells`, `loaner_requests`, `sms_log`, `staff`, `audit_log`, `service_schedule`, `schedule_overrides`, `loaner_vehicles`.
- **Role hierarchy implemented**: `src/lib/role.ts`
  - `service_advisor`, `service_manager`, `group_manager`.
- **Session-aware scope resolver exists**: `src/lib/dealer.ts` (`resolveScopeForRequest`).

### 1.3 Session/auth security

- **Supabase Auth middleware gate**: `src/middleware.ts`
  - Redirects unauthenticated dashboard traffic.
  - Stamps role/dealer/user headers from authenticated session.
- **Cookie hardening implemented**: `src/lib/supabase-server.ts`
  - `HttpOnly`, `Secure` (in prod), `SameSite=Strict`.
- **Staff activation/deactivation paths present**:
  - Documented in `docs/compliance-pipeda.md`
  - Routes in `src/app/api/staff/*` and auth revoke flow.

### 1.4 Encryption and secrets handling

- **Webhook signature verification present**: `voice/src/routes/webhook.ts`
  - ElevenLabs HMAC verification logic.
- **Fortellis secret envelope encryption implemented**:
  - `voice/src/lib/secrets.ts`
  - Used in dealer credential resolution path (`voice/src/lib/dealer.ts`)
  - Operational script support in voice scripts/package scripts.
- **Health endpoint exposes encryption/integration state**: `voice/src/server.ts` (`/health`).

### 1.5 Auditability and traceability

- **`audit_log` table + RLS default-deny read policy**: `supabase/migrations/0011_audit_log.sql`.
- **`recordAudit()` helper implemented**: `src/lib/audit.ts`.
- **Operational logs persisted**:
  - Calls: `call_logs`
  - SMS: `sms_log`
  - CDK queue: `cdk_sync_queue`
  - Related migrations: `0001_aria_intelligence_layer.sql`, `0002_sms_layer.sql`.

### 1.6 Security/compliance documentation already in repo

- `docs/SECURITY_BRIEF.md`
- `docs/COMPLIANCE_ANALYSIS.md`
- `docs/compliance-pipeda.md`
- `docs/compliance-calendar.md`

These provide a strong narrative baseline, but several claims are roadmap-level vs fully enforced in runtime code.

---

## 2) What is missing / needs to be added

## 2.1 SOC 2 Type II (controls present vs gaps)

### What exists (helpful for SOC 2 readiness)

- Logical access foundation (Supabase Auth + role model + middleware).
- Tenant-aware schema design + partial RLS coverage.
- Audit log schema + insert helper.
- Security-focused migrations with rationale comments.
- Health/status observability endpoint in voice service.

### Major gaps before SOC 2 Type II readiness

- **No SOC 2 report artifacts in repo** (Type I/Type II report package absent).
- **No formal evidence system** (control ownership, periodic reviews, exceptions, remediation tracking).
- **No formal IR plan artifacts** (playbook, severity matrix, notification SOP).
- **No formal vuln management evidence** (SAST/DAST cadence, dependency scanning policy, remediation SLA).
- **Auth surface inconsistency**:
  - Voice endpoints like `/tools/*`, `/sms/send`, `/ws`, and demo/admin-style routes are not uniformly authenticated in code.
- **Tenant enforcement inconsistency**:
  - Legacy `resolveDealerForRequest` (query/header-driven dealer selection) still used by many API routes.

---

## 2.2 ISO 27001 (if dealer IT asks)

### What exists

- Technical controls that map to Annex A areas:
  - Access control mechanisms.
  - Logging/audit primitives.
  - Encryption controls in selected paths.
  - Multi-tenant segregation architecture.

### Gaps to close for credible ISO 27001 posture

- No formal **ISMS** artifacts in repo:
  - Information security policy suite
  - Risk register/treatment plans
  - Statement of Applicability
  - Control owner assignment and evidence schedule
- No documented management review/internal audit cycle.
- No certified external audit evidence.
- Incomplete operational governance docs:
  - Incident management
  - BCP/DR testing records
  - Supplier assurance process evidence.

---

## 2.3 HIPAA (why it does not apply here)

HIPAA generally does **not** apply to PitLane’s current automotive dealership use case.

- PitLane is not operating as a healthcare provider/plan/clearinghouse system in this product context.
- Data model is dealership service operations data (calls, appointments, ROs, reminders), not healthcare operations.

What **does** apply in practice:

- **PIPEDA** (federal private-sector privacy),
- **Quebec Law 25** (especially for Quebec dealers and transfer assessments),
- **CASL** for SMS/electronic messaging obligations.

Note: transcripts can still contain sensitive personal content; that is a privacy risk under Canadian privacy law even if not HIPAA PHI context.

---

## 2.4 PCI DSS (if PitLane ever handles payment cards)

Current repo shows no card-processing implementation, so PCI scope is currently low/non-applicable.

If card payments are added:

- Prefer hosted/tokenized payment pages to keep PitLane out of direct cardholder-data handling.
- Avoid storing PAN/CVV in transcripts, logs, SMS, or DB rows.
- Implement masking/redaction + strict logging controls immediately.
- Re-scope architecture and compliance posture (likely SAQ changes and stronger segmentation requirements).

---

## 2.5 Canadian law: PIPEDA + Quebec Law 25 + CASL

### PIPEDA / Law 25 strengths

- Data minimization work has started in schema and voice code.
- Audit trail foundation exists.
- Session/auth controls are significantly stronger than early-phase architecture.

### PIPEDA / Law 25 gaps

- DSAR/delete/export operational workflows are not fully productized in code.
- Retention schedules are documented, but purge automation evidence is limited/roadmap.
- Cross-border processing posture needs clear, consistent representation:
  - Supabase residency is documented as Canada-focused.
  - Voice compute residency claims vary across docs; this inconsistency should be corrected for procurement confidence.

### CASL gaps (important)

- `sms_consent` exists, but consent behavior still defaults to implicit opt-in when no row exists (`voice/src/lib/supabase.ts`).
- STOP/HELP automation is referenced in docs/comments, but inbound STOP/HELP handling route is not clearly implemented in voice code.
- This is a high-priority legal/commercial gap before broader dealer rollout.

---

## 2.6 Dealer enterprise IT expectations (common asks)

Likely asks and current status:

- **SSO/SAML (Okta/Azure AD):** not implemented yet (docs frame as future).
- **Pen test report:** not present in repo (only roadmap statements).
- **SOC 2 evidence package:** not present yet.
- **DPA + subprocessor exhibit:** not present in repo as templates/artifacts.
- **Security questionnaire package (SIG Lite/CAIQ-style):** not present as completed packet.
- **Formal incident response docs and DR test records:** not present as operational evidence.

---

## 3) What to produce for dealer IT/legal sign-off

Minimum package to prepare:

1. **Legal pack**
   - DPA template (processor terms, breach notification, subprocessors, deletion/return terms).
   - MSA security/privacy schedule.
   - Subprocessor list with notice/update commitments.

2. **Security assurance pack**
   - Current architecture/data-flow diagram.
   - Access control model and role matrix.
   - Encryption/key-management summary.
   - Vulnerability management policy + latest scan evidence.
   - Pen test report (or at minimum signed engagement letter + scheduled date + remediation plan).
   - Incident response plan and contact/escalation matrix.

3. **Privacy operations pack**
   - Data inventory and retention schedule.
   - DSAR workflow (access/correction/deletion/export).
   - CASL consent workflow documentation (including STOP/HELP processing evidence).
   - Quebec Law 25 transfer impact assessment template (for Quebec rooftops).

4. **Trust/compliance maturity pack**
   - SOC 2 roadmap with milestones (Type I/Type II trajectory).
   - Control matrix mapping (SOC 2 + high-level ISO 27001 alignment).
   - Change management + release control evidence.

---

## 4) Priority remediation roadmap (practical order)

### High priority

1. Implement inbound STOP/HELP handling and tighten consent defaults for CASL.
2. Standardize tenant scoping to session-bound resolver on all dashboard API routes.
3. Add authentication/authorization controls for sensitive voice endpoints and remove/guard demo/admin endpoints in production mode.
4. Publish incident response + breach notification playbook.

### Medium priority

5. Implement retention purge automation and DSAR/delete/export flows.
6. Complete security evidence package (pen test, vuln program, subprocessor list, DPA templates).
7. Resolve regional/compliance doc inconsistencies.

### Strategic priority

8. Advance SOC 2 program from readiness to audited report.
9. Build SSO/SAML pathway for enterprise dealer IAM requirements.

---

## 5) Final position for dealership procurement conversations

PitLane can credibly present itself as **security-conscious and compliance-aware with real technical controls already in place**, but should not over-claim full enterprise compliance maturity yet.  

The strongest near-term win is to pair current implemented controls with a clean remediation/evidence plan (especially CASL, access-surface hardening, DSAR/retention operations, and formal assurance artifacts).

