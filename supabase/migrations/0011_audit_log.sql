-- ─── PitLane Phase 11 compliance follow-up: audit_log ──────────────────────
--
-- PIPEDA (federal) + Quebec Law 25 require that every staff access to a
-- customer record be logged with enough detail to reconstruct who saw
-- what and when. This table is the single source of that record.
--
-- IP anonymization (PIPEDA "data minimization"):
--   The ip_address column stores the request IP with the LAST OCTET ZEROED
--   for IPv4 (e.g. '99.229.91.0' instead of '99.229.91.226'), or the
--   last 80 bits zeroed for IPv6. This preserves enough geographic /
--   ASN signal to investigate suspected misuse without retaining a
--   precise identifier that could be linked back to a household.
--
-- Retention:
--   Operationally these rows should be aged out after 24 months under
--   the data-minimization principle. A scheduled job + a CHECK on
--   created_at would enforce that; spec'd for Phase 12.

create table if not exists public.audit_log (
  id            uuid         primary key default gen_random_uuid(),
  staff_id      uuid         references public.staff(id)   on delete set null,
  dealer_id     uuid         references public.dealers(id) on delete set null,
  action        text         not null,                       -- 'view_customer', 'view_call', 'edit_department', 'invite_staff', 'deactivate_staff', etc.
  resource_type text,                                        -- 'customer', 'call_log', 'department', 'staff', …
  resource_id   text,                                        -- target row id / phone / etc.
  ip_address    text,                                        -- /24 truncated (IPv4) or /48 truncated (IPv6) — never full
  created_at    timestamptz  not null default now()
);

create index if not exists audit_log_staff_idx       on public.audit_log (staff_id);
create index if not exists audit_log_dealer_idx      on public.audit_log (dealer_id);
create index if not exists audit_log_action_idx      on public.audit_log (action);
create index if not exists audit_log_resource_idx    on public.audit_log (resource_type, resource_id);
create index if not exists audit_log_created_at_idx  on public.audit_log (created_at desc);

-- RLS: the table is server-side-only. The dashboard never reads it (a
-- future /admin/audit surface for compliance officers will, but with a
-- separate signed query path). Lock authenticated reads down hard.
alter table public.audit_log enable row level security;

drop policy if exists "audit_log_no_self_read" on public.audit_log;
-- Default-deny policy. Service-role inserts bypass RLS, so audit writes
-- from API routes continue to work; nothing else can SELECT this table.
create policy "audit_log_no_self_read" on public.audit_log for select using (false);
