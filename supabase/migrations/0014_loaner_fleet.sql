-- ─── PitLane Phase 13: loaner fleet management ────────────────────────────
--
-- Adds a per-dealer loaner-vehicle inventory so the service manager can
-- track which courtesy cars exist, what condition / availability they're
-- in, and which existing loaner_requests they've been assigned to.
--
-- ─── PIPEDA / Quebec Law 25 compliance note ────────────────────────────────
--
-- license_plate is QUASI-PII. Strictly the plate identifies the vehicle,
-- not the driver — but in combination with the dealer's loaner_requests
-- table (which references customer_id) a plate could be linked back to a
-- specific customer trip. Treat it as personal information under PIPEDA:
--
--   - RLS limits read access to staff of the same dealer (or group
--     manager). No cross-dealer leakage.
--   - The dashboard never displays plates outside the manager calendar
--     and the service-desk loaner queue (both staff-only surfaces).
--   - The plate value MUST NOT be sent over outbound SMS, email, or
--     CDK sync payloads. The loaner-request fulfilment notification
--     references only make/model/color.
--   - Retention: loaner_requests resolved >2 years old can be purged
--     along with their loaner_vehicle_id linkage. See
--     docs/compliance-calendar.md for the retention table.
--
-- Other columns (make, model, year, color, notes) are inventory metadata
-- and carry no PII.
--
-- Idempotent (IF NOT EXISTS guards). Safe to re-apply.

create table if not exists public.loaner_vehicles (
  id             uuid         primary key default gen_random_uuid(),
  dealer_id      uuid         not null references public.dealers(id) on delete cascade,
  make           text         not null,
  model          text         not null,
  year           smallint     not null,
  license_plate  text         not null,
  color          text,
  is_available   boolean      not null default true,
  notes          text,
  created_at     timestamptz  not null default now(),
  updated_at     timestamptz  not null default now()
);

create index if not exists loaner_vehicles_dealer_idx
  on public.loaner_vehicles (dealer_id);
create index if not exists loaner_vehicles_available_idx
  on public.loaner_vehicles (dealer_id, is_available);

-- ─── Extend loaner_requests with assignment + date range ──────────────────
--
-- loaner_vehicle_id ties the request to a specific physical vehicle once
-- the service desk assigns one. start_date / end_date are the planned
-- pickup + return dates; previously the request only had a
-- requested_date (when the customer first asked).

alter table public.loaner_requests
  add column if not exists loaner_vehicle_id uuid references public.loaner_vehicles(id) on delete set null;
alter table public.loaner_requests
  add column if not exists start_date date;
alter table public.loaner_requests
  add column if not exists end_date   date;

create index if not exists loaner_requests_vehicle_idx
  on public.loaner_requests (loaner_vehicle_id);
create index if not exists loaner_requests_date_range_idx
  on public.loaner_requests (dealer_id, start_date, end_date);

-- ─── Row-Level Security ────────────────────────────────────────────────────
--
-- SELECT — staff of same dealer OR group_manager.
-- INSERT / UPDATE / DELETE — service_manager of same dealer only.

alter table public.loaner_vehicles enable row level security;

drop policy if exists loaner_vehicles_select on public.loaner_vehicles;
create policy loaner_vehicles_select on public.loaner_vehicles
  for select
  using (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and (staff.dealer_id = loaner_vehicles.dealer_id
             or staff.role = 'group_manager')
    )
  );

drop policy if exists loaner_vehicles_insert on public.loaner_vehicles;
create policy loaner_vehicles_insert on public.loaner_vehicles
  for insert
  with check (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.dealer_id = loaner_vehicles.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop policy if exists loaner_vehicles_update on public.loaner_vehicles;
create policy loaner_vehicles_update on public.loaner_vehicles
  for update
  using (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.dealer_id = loaner_vehicles.dealer_id
        and staff.role = 'service_manager'
    )
  )
  with check (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.dealer_id = loaner_vehicles.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop policy if exists loaner_vehicles_delete on public.loaner_vehicles;
create policy loaner_vehicles_delete on public.loaner_vehicles
  for delete
  using (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.dealer_id = loaner_vehicles.dealer_id
        and staff.role = 'service_manager'
    )
  );

-- ─── Audit triggers ────────────────────────────────────────────────────────

create or replace function public.audit_loaner_vehicle_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dealer_id   uuid;
  v_resource_id text;
  v_action      text;
begin
  if (tg_op = 'DELETE') then
    v_dealer_id   := old.dealer_id;
    v_resource_id := old.id::text;
  else
    v_dealer_id   := new.dealer_id;
    v_resource_id := new.id::text;
  end if;

  v_action := lower(tg_op) || '_loaner_vehicle';

  insert into public.audit_log (
    staff_id, dealer_id, action, resource_type, resource_id, ip_address
  ) values (
    auth.uid(), v_dealer_id, v_action, 'loaner_vehicle', v_resource_id, null
  );

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists loaner_vehicles_audit on public.loaner_vehicles;
create trigger loaner_vehicles_audit
  after insert or update or delete on public.loaner_vehicles
  for each row execute function public.audit_loaner_vehicle_change();
