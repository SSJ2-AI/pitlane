-- ─── PitLane Phase 13: Internal calendar — loaner fleet ────────────────────
--
-- Compliance note:
--   license_plate is quasi-PII and is retained strictly for operational
--   fleet dispatch / return reconciliation.

create extension if not exists "pgcrypto";

create table if not exists public.loaner_vehicles (
  id            uuid         primary key default gen_random_uuid(),
  dealer_id     uuid         not null references public.dealers(id) on delete cascade,
  make          text         not null,
  model         text         not null,
  year          smallint     not null,
  license_plate text         not null,
  color         text,
  is_available  boolean      not null default true,
  notes         text,
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now()
);

comment on column public.loaner_vehicles.license_plate is
  'Quasi-PII: operationally required for fleet assignment and return reconciliation.';

create index if not exists loaner_vehicles_dealer_idx
  on public.loaner_vehicles (dealer_id, is_available);

alter table public.loaner_requests
  add column if not exists loaner_vehicle_id uuid references public.loaner_vehicles(id),
  add column if not exists start_date date,
  add column if not exists end_date date;

alter table public.loaner_vehicles enable row level security;

drop policy if exists "loaner_vehicles_select" on public.loaner_vehicles;
drop policy if exists "loaner_vehicles_write" on public.loaner_vehicles;

create policy "loaner_vehicles_select"
  on public.loaner_vehicles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and (
          staff.dealer_id = loaner_vehicles.dealer_id
          or staff.role = 'group_manager'
        )
    )
  );

create policy "loaner_vehicles_write"
  on public.loaner_vehicles
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.dealer_id = loaner_vehicles.dealer_id
        and staff.role = 'service_manager'
    )
  )
  with check (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.dealer_id = loaner_vehicles.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop trigger if exists loaner_vehicles_touch_updated_at on public.loaner_vehicles;
create trigger loaner_vehicles_touch_updated_at
  before update on public.loaner_vehicles
  for each row
  execute function public.pitlane_touch_updated_at();

drop trigger if exists loaner_vehicles_audit_row_change on public.loaner_vehicles;
create trigger loaner_vehicles_audit_row_change
  after insert or update or delete on public.loaner_vehicles
  for each row
  execute function public.pitlane_audit_row_change();
