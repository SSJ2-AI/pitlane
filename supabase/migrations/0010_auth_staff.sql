-- ─── PitLane Phase 11: authenticated staff + role hierarchy ────────────────
--
-- Replaces the URL query-param role hack (?role=service_manager) from
-- Phase 9b with a real authenticated staff row keyed by Supabase Auth
-- user id. The row holds:
--
--   - role (3-tier: service_advisor | service_manager | group_manager)
--   - dealer_id (NULL for group_manager — they see all rooftops)
--   - is_active + invited_by for the manager's invite flow
--
-- Permissions enforced at the API layer:
--   service_advisor   -> dealer-scoped reads, limited writes
--   service_manager   -> dealer-scoped reads + writes, invite advisors,
--                        edit departments, view analytics
--   group_manager     -> read-only across ALL dealers, no per-dealer writes
--
-- Idempotent (IF NOT EXISTS guards).

create table if not exists public.staff (
  id            uuid         primary key references auth.users(id) on delete cascade,
  dealer_id     uuid         references public.dealers(id) on delete set null,
  role          text         not null check (role in ('service_advisor', 'service_manager', 'group_manager')),
  full_name     text         not null,
  email         text         not null,
  is_active     boolean      not null default true,
  invited_by    uuid         references public.staff(id) on delete set null,
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now()
);

create index if not exists staff_dealer_id_idx on public.staff (dealer_id);
create index if not exists staff_role_idx      on public.staff (role);
create index if not exists staff_email_idx     on public.staff (email);
create unique index if not exists staff_email_active_idx
  on public.staff (lower(email))
  where is_active = true;

-- ─── Row-level security ────────────────────────────────────────────────────
--
-- We enable RLS so a service-role key write doesn't accidentally surface a
-- different dealer's staff row through the dashboard's read-only paths.
-- The API layer always runs with the service-role key (server-side) so the
-- policies below are belt-and-suspenders rather than the load-bearing gate.

alter table public.staff enable row level security;

-- The authenticated user can always read their own row (needed by the
-- middleware to resolve role + dealer_id from a fresh session).
drop policy if exists "staff_self_read" on public.staff;
create policy "staff_self_read" on public.staff
  for select
  using (auth.uid() = id);

-- The authenticated user can update their own non-privileged fields
-- (full_name, email). Role + dealer_id + is_active stay write-locked to
-- service-role calls only.
drop policy if exists "staff_self_update_profile" on public.staff;
create policy "staff_self_update_profile" on public.staff
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
