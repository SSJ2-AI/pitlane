-- ─── PitLane Phase 13: loaner fleet inventory ───────────────────────────────
--
-- license_plate is quasi-PII under PIPEDA/Quebec Law 25 because it can be
-- linked to a person through external records. Access is limited by RLS and
-- all writes are audited.

create table if not exists public.loaner_vehicles (
  id              uuid         primary key default gen_random_uuid(),
  dealer_id       uuid         not null references public.dealers(id) on delete cascade,
  make            text         not null,
  model           text         not null,
  year            smallint     not null,
  license_plate   text         not null,
  color           text,
  is_available    boolean      not null default true,
  notes           text,
  created_at      timestamptz  not null default now(),
  updated_at      timestamptz  not null default now()
);

create index if not exists loaner_vehicles_dealer_idx
  on public.loaner_vehicles (dealer_id, is_available, make, model);
create unique index if not exists loaner_vehicles_dealer_plate_idx
  on public.loaner_vehicles (dealer_id, lower(license_plate));

alter table public.loaner_requests
  add column if not exists loaner_vehicle_id uuid references public.loaner_vehicles(id),
  add column if not exists vehicle_id text,
  add column if not exists start_date date,
  add column if not exists end_date date;

create index if not exists loaner_requests_vehicle_dates_idx
  on public.loaner_requests (loaner_vehicle_id, start_date, end_date)
  where loaner_vehicle_id is not null;

create or replace function public.touch_loaner_vehicles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_loaner_vehicles_updated_at on public.loaner_vehicles;
create trigger touch_loaner_vehicles_updated_at
  before update on public.loaner_vehicles
  for each row execute function public.touch_loaner_vehicles_updated_at();

-- ─── Row-level security ─────────────────────────────────────────────────────

alter table public.loaner_vehicles enable row level security;

drop policy if exists loaner_vehicles_staff_select on public.loaner_vehicles;
create policy loaner_vehicles_staff_select on public.loaner_vehicles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and (staff.dealer_id = loaner_vehicles.dealer_id or staff.role = 'group_manager')
    )
  );

drop policy if exists loaner_vehicles_manager_insert on public.loaner_vehicles;
create policy loaner_vehicles_manager_insert on public.loaner_vehicles
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and staff.dealer_id = loaner_vehicles.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop policy if exists loaner_vehicles_manager_update on public.loaner_vehicles;
create policy loaner_vehicles_manager_update on public.loaner_vehicles
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and staff.dealer_id = loaner_vehicles.dealer_id
        and staff.role = 'service_manager'
    )
  )
  with check (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and staff.dealer_id = loaner_vehicles.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop policy if exists loaner_vehicles_manager_delete on public.loaner_vehicles;
create policy loaner_vehicles_manager_delete on public.loaner_vehicles
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and staff.dealer_id = loaner_vehicles.dealer_id
        and staff.role = 'service_manager'
    )
  );

-- ─── Audit trigger ──────────────────────────────────────────────────────────

create or replace function public.audit_loaner_vehicle_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id text;
  target_dealer uuid;
begin
  target_id := coalesce(new.id::text, old.id::text);
  target_dealer := coalesce(new.dealer_id, old.dealer_id);

  insert into public.audit_log (dealer_id, action, resource_type, resource_id)
  values (
    target_dealer,
    lower(tg_op) || '_loaner_vehicle',
    'loaner_vehicle',
    target_id
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_loaner_vehicle_changes on public.loaner_vehicles;
create trigger audit_loaner_vehicle_changes
  after insert or update or delete on public.loaner_vehicles
  for each row execute function public.audit_loaner_vehicle_change();
