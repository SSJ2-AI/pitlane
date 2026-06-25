# PitLane Compliance — PIPEDA + Quebec Law 25

Operational playbook for the auth + privacy posture introduced in Phase 11.
This file is for the dealer's IT / compliance officer; engineers update it
whenever the relevant settings change.

PitLane operates in Canada only at this stage. **No GDPR / CCPA text is in
scope.** The dashboard is a B2B internal tool for dealership staff — cookie
consent banner requirements do not apply.

---

## 1. Session security (Supabase Auth dashboard)

Set the following on the Supabase project (Dashboard → Auth → Configuration):

| Setting | Value | Why |
| --- | --- | --- |
| `JWT expiry` | `28800` (8h) | Spec: 8 hours of inactivity = session expires. |
| `Refresh token rotation` | `Enabled` | Standard rotation; mitigates replay if a refresh token leaks. |
| `Refresh token reuse interval` | `10s` | Tightens the race window during legitimate rotation. |
| `Rate limit: sign-in attempts` | `5 / 15 min` | Supabase Auth built-in lockout; spec calls for 5 failed attempts → 15-minute lockout. |
| `Site URL` | The production dashboard URL | Where magic links + password reset emails resolve. |
| `Additional redirect URLs` | `<site>/auth/callback` | Used by the magic-link sign-up and reset-password flows. |

### Cookie attributes
Code-level (already enforced in `src/lib/supabase-server.ts` via
`hardenCookieOptions`):

- `HttpOnly` — JS in the page never reads the cookie.
- `Secure` — set in `NODE_ENV === 'production'`.
- `SameSite=Strict` — the dashboard never embeds in a third-party context;
  Strict eliminates the CSRF surface entirely.

---

## 2. Audit logging (PIPEDA + Quebec Law 25)

Migration `0011_audit_log.sql` creates `public.audit_log`. Every access of
a customer record writes one row:

| Field | Notes |
| --- | --- |
| `staff_id` | FK to `public.staff`; NULL on unauthenticated mock-mode requests. |
| `dealer_id` | FK to `public.dealers`; scopes the audit query for the compliance officer. |
| `action` | `view_customer`, `view_call`, `view_callbacks`, `view_schedule`, `view_group_summary`, `edit_department`, `create_department`, `delete_department`, `invite_staff`, `deactivate_staff`, `activate_staff`, `revoke_session` |
| `resource_type` / `resource_id` | The target row (`customer` + phone, `call_log` + id, etc.). |
| `ip_address` | **/24 truncated** for IPv4, **/48 truncated** for IPv6. The last octet (or last 80 bits) is zeroed before insert via `anonymiseIp()` in `src/lib/audit.ts`. |

**Retention**: roll forward to 24 months. A scheduled job to age the table
out lands in Phase 12.

**Reads**: the table denies all authenticated SELECTs via RLS. A future
`/admin/audit` surface for the compliance officer will read via the
service-role key with explicit attribution.

---

## 3. Data minimization (CDK-first principle)

Migration `0012_customers_pipeda_minimization.sql` drops `name` + `email`
from `public.customers`. The local row holds metadata only:

```
phone           anchor for call history when CDK doesn't have the caller yet
dealer_id       routing key
is_new_customer derived flag
total_calls     derived counter
last_seen_at    derived timestamp
last_sentiment  Aria-bucketed (positive/neutral/negative/frustrated)
aria_notes      Aria's free-text session observations — must NOT contain PII
cdk_customer_id pointer into CDK once matched
created_at / updated_at
```

Aria's `update_customer_name` tool no longer writes the name locally.
Instead it queues a `customer_name_collected` job in `cdk_sync_queue` so
the Phase 3 worker can push the name to CDK Customer API. Until that
worker is wired for customer writes, the name lives in
`call_logs.transcript` only (which is itself transcript data, retained
under the call_logs retention policy).

**Aria's summariser prompt** must enforce that `aria_notes` content does
not include PII. The summariser system prompt
(`voice/src/lib/summarizer.ts` `SYSTEM_PROMPT`) describes the operational-
note style explicitly. If a future summariser change re-emits PII into
this field, that is a compliance regression and must trigger a rollback.

---

## 4. Staff deactivation (Canadian employment law)

`POST /api/auth/revoke-session?staffId=<uuid>` invalidates all active
Supabase refresh tokens for the target staff. Service managers can revoke
advisors in their own dealer; manager-on-manager revoke requires a group
manager and is intentionally not exposed in the dashboard UI yet.

The `is_active=false` PATCH on `/api/staff/[id]` calls
`supabase.auth.admin.signOut(userId)` automatically — toggling an advisor
off in `/manager/staff` immediately invalidates their session.

---

## 5. Password policy

Enforced server-side via Supabase Auth project config (Dashboard → Auth →
Configuration → Passwords):

| Setting | Value |
| --- | --- |
| `Minimum password length` | `12` |
| `Password strength` | Required character classes: number + special |

Client-side mirror lives in `src/lib/password-policy.ts` so the `/login`
page surfaces the requirements while the user is typing (rather than
showing a generic Supabase error after submit). Same rules used by the
hosted magic-link sign-up + reset-password pages.

---

## 6. Data residency

Supabase project lives in `ca-central-1` (Montréal). Railway voice service
is pinned to `us-east4` per `voice/railway.toml`; there is no Canadian
Railway region available at this time and the trade-off is documented in
`docs/COMPLIANCE_ANALYSIS.md`.

**Do not move the Supabase project to a non-Canadian region.** Doing so
would re-open the PIPEDA cross-border data-transfer review and is out of
scope for the current dealer rollout.

---

## 7. What is explicitly NOT in scope

- **GDPR / CCPA**: PitLane is Canada-only at this stage.
- **Cookie consent banner**: B2B internal tool. Staff sessions don't
  require a public-facing consent prompt.
- **Voice biometric verification**: tracked in `docs/future-features.md`.
