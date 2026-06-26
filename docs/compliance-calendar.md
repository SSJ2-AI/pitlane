# PitLane Phase 13 — Calendar & Loaner Fleet Compliance Brief

This document covers the privacy + security posture of the four new tables
introduced by migrations `0013_service_schedule.sql` and
`0014_loaner_fleet.sql`. It is the companion to `docs/COMPLIANCE_ANALYSIS.md`
and `docs/SECURITY_BRIEF.md`; the same controls (RLS, server-side role
validation, audit trail, ca-central-1 hosting, AES-256 at rest) apply.

## 1. Data classification

| Table | Sensitive fields | Classification | Source of truth |
| --- | --- | --- | --- |
| `public.service_schedule` | `dealer_id`, `day_of_week`, `open_time`, `close_time`, `slot_duration_mins`, `max_concurrent_bookings`, `created_by` (staff FK) | Operational metadata (no customer PII) | PitLane (manager-authored) |
| `public.schedule_overrides` | `dealer_id`, `override_date`, `is_blocked`, `reason`, `open_time`, `close_time`, `max_concurrent_bookings`, `created_by` (staff FK) | Operational metadata (no customer PII) | PitLane |
| `public.loaner_vehicles` | `dealer_id`, `make`, `model`, `year`, `license_plate`, `color`, `notes` | Inventory metadata + **quasi-PII** (`license_plate`) | PitLane |
| `public.loaner_requests` (extended) | new cols: `loaner_vehicle_id`, `start_date`, `end_date` | Operational metadata (links to existing `customer_id` PII) | PitLane |

### `license_plate` — quasi-PII note

The plate identifies the vehicle, not the driver. In combination with the
dealer's `loaner_requests` table (which references `customer_id`), a plate
could be linked back to a specific customer's loaner trip. PitLane treats
plates as personal information under PIPEDA:

- Read access is restricted to staff of the same dealer (RLS + dealer
  filter in the API).
- The plate value is **never** sent over outbound SMS, email, or CDK
  sync payloads. The loaner-request confirmation references only
  make / model / color.
- The plate is displayed only on the staff-only
  `/manager/calendar → Loaner Fleet` tab and the service-desk loaner
  queue.

## 2. Access matrix

| Role | service_schedule | schedule_overrides | loaner_vehicles | loaner_requests |
| --- | --- | --- | --- | --- |
| `service_advisor` (same dealer) | Read | Read | Read | Read + create (manual request from customer profile) |
| `service_manager` (same dealer) | Read + write | Read + write | Read + write (create / patch / soft-delete) | Read + write |
| `group_manager` (all dealers) | Read | Read | Read | Read |
| Unauthenticated / other dealer | Denied (RLS + API) | Denied | Denied | Denied |

Defense layers, in order of precedence:

1. **RLS policies** on every table (migrations 0013, 0014). Subject = the
   `auth.uid()` resolved against `public.staff`.
2. **Server-side role validation** in every write API route, reading
   `x-pitlane-role` set by `src/middleware.ts`. The header is server-only
   — clients can't fabricate it because the middleware overwrites any
   client-supplied value with the session-derived role.
3. **Audit trail** — every write is logged twice:
   - The Postgres trigger (`audit_schedule_change` /
     `audit_loaner_vehicle_change`) writes a row to `audit_log` with
     `auth.uid()`, the dealer, the resource type, and the resource id.
   - The API route calls `recordAudit()` with `session.userId` so
     service-role writes (which RLS bypasses) still attribute to the
     acting staff member.

## 3. Retention policy

| Data | Retention | Purge mechanism |
| --- | --- | --- |
| `service_schedule` | Indefinite while the dealer is active. Cascade-deleted when the dealer row is deleted. | `ON DELETE CASCADE` |
| `schedule_overrides` | Indefinite while the dealer is active; manager-deleted when no longer relevant. | Manual / cascade |
| `loaner_vehicles` | Indefinite for active vehicles. Soft-delete (`is_available = false`) preserves the FK for historical `loaner_requests` reads. | Soft delete via DELETE API |
| `loaner_requests` (resolved) | **Resolved rows older than 2 years are eligible for purge.** Status `approved` / `declined` / `fulfilled` with `resolved_at < now() − interval '2 years'` may be deleted by the scheduled retention job (spec'd for Phase 14). Aligns with the 24-month `audit_log` retention from migration 0011. | Scheduled job + DELETE |

The 2-year window is the smaller of:
- PIPEDA s.4.5 "data shall be retained only as long as necessary for the
  fulfilment of those purposes" — loaner accounting needs the row
  long enough to reconcile any incident claims (Ontario default
  limitation period is 2 years).
- The dealership's operational need for historical loaner trends, which
  the analytics layer aggregates to monthly counters that don't expire.

## 4. SOC 2 controls mapping

| Control | Implementation |
| --- | --- |
| **CC6.1** — Logical access | Supabase Auth + 3-tier role hierarchy (`staff.role`). RLS on every new table. Service-role key never reaches the browser; all reads go through Next.js API routes. |
| **CC6.6** — Boundary protection | Routes scoped per `dealer_id` resolved from middleware headers, not client-supplied. The dashboard frontend cannot escape its dealer scope even if it forges `x-pitlane-role`, because the middleware overrides any client header with the session-derived value before the route handler reads it. |
| **CC7.2** — Monitoring / audit | Every write logged twice (trigger + `recordAudit()`); `audit_log` is service-role-only-readable so the audit surface is tamper-evident. `audit_log` IP addresses are /24- or /48-anonymised (PIPEDA data minimization, see migration 0011). |
| **CC8.1** — Change management | Each schema change ships as a numbered SQL migration with a header comment documenting compliance rationale. Migrations are idempotent (`IF NOT EXISTS` / `IF EXISTS`). |
| **PI1.1** — Data residency | All tables live in Supabase project `tskczoemkegqbghjedpu`, region `ca-central-1` (Montréal). No cross-border replication. Voice service (Railway) is in the same region. |
| **PI1.2** — Encryption at rest | Supabase enforces AES-256 at rest for every Postgres volume + storage bucket. `license_plate` is stored as plain text inside the encrypted volume; column-level encryption is not enabled because the operational access pattern (filter + sort on plate) doesn't tolerate it. |
| **PI1.3** — Encryption in transit | Every dashboard ↔ Supabase, voice ↔ Supabase, browser ↔ dashboard hop is TLS 1.2+. No plaintext fallbacks. |
| **A1.1** — Availability | Schedule reads + writes degrade gracefully: when Supabase is unreachable the dashboard surfaces a mock schedule, and `book_appointment` falls through to the legacy open-booking flow rather than 500-ing. |

## 5. PIPEDA / Quebec Law 25 notes

- **No customer PII** is stored in `service_schedule` or
  `schedule_overrides` — they are purely operational. Migration 0013's
  header comment calls this out: "No PII stored in schedule tables.
  PIPEDA s.4.4 data minimization compliant."
- **`license_plate` quasi-PII** is documented in migration 0014's
  header. The plate is treated as personal information under PIPEDA
  s.2(1) (definition of "personal information"): "information about an
  identifiable individual". Although the plate identifies the vehicle,
  combination with `loaner_requests.customer_id` makes the individual
  identifiable, which triggers the personal-information regime.
- **Cross-dealer isolation**: RLS denies SELECT/INSERT/UPDATE/DELETE on
  rows whose `dealer_id` differs from the caller's `staff.dealer_id`
  (group_manager has read-only cross-dealer SELECT).

## 6. Operator checklist for a new dealer

1. Insert the dealer row.
2. Seed `service_schedule` with 7 rows (one per day of week).
3. Seed `loaner_vehicles` with the dealership's loaner inventory.
4. Confirm `/manager/calendar` renders for a `service_manager` account
   in that dealer's scope.
5. Confirm `/tools/available-slots?dealer_id=<uuid>&days=7` returns ≥1
   slot for the next open day.
6. Confirm `audit_log` contains rows for the seeding writes.

## 7. Related documents

- `docs/COMPLIANCE_ANALYSIS.md` — overall PIPEDA + Quebec Law 25 posture.
- `docs/SECURITY_BRIEF.md` — encryption + key management.
- `supabase/migrations/0011_audit_log.sql` — audit table schema +
  retention rationale.
- `supabase/migrations/0012_customers_pipeda_minimization.sql` — the
  data-minimization precedent that drove the "no PII in schedule
  tables" stance.
