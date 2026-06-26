-- ─── PitLane Phase 13: internal service schedule ────────────────────────────
--
-- No PII stored in schedule tables. PIPEDA s.4.4 data minimization compliant.
-- These tables contain dealer operating hours, booking capacity, and closure
-- metadata only.

create table if not exists public.service_schedule (
  id                      uuid         primary key default gen_random_uuid(),
  dealer_id               uuid         not null references public.dealers(id) on delete cascade,
  day_of_week             smallint     not null check (day_of_week between 0 and 6),
  open_time               time         not null default '08:00',
  close_time              time         not null default '18:00',
  slot_duration_mins      smallint     not null default 60,
  max_concurrent_bookings smallint     not null default 3,
  is_active               boolean      not null default true,
  created_by              uuid         references public.staff(id),
  created_at              timestamptz  not null default now(),
  updated_at              timestamptz  not null default now(),
  unique (dealer_id, day_of_week)
);

create table if not exists public.schedule_overrides (
  id                      uuid         primary key default gen_random_uuid(),
  dealer_id               uuid         not null references public.dealers(id) on delete cascade,
  override_date           date         not null,
  is_blocked              boolean      not null default false,
  reason                  text,
  open_time               time,
  close_time              time,
  max_concurrent_bookings smallint,
  created_by              uuid         references public.staff(id),
  created_at              timestamptz  not null default now(),
  unique (dealer_id, override_date)
);

create index if not exists service_schedule_dealer_idx
  on public.service_schedule (dealer_id, day_of_week);
create index if not exists schedule_overrides_dealer_date_idx
  on public.schedule_overrides (dealer_id, override_date);

create or replace function public.touch_service_schedule_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_service_schedule_updated_at on public.service_schedule;
create trigger touch_service_schedule_updated_at
  before update on public.service_schedule
  for each row execute function public.touch_service_schedule_updated_at();

-- ─── Row-level security ─────────────────────────────────────────────────────

alter table public.service_schedule enable row level security;
alter table public.schedule_overrides enable row level security;

drop policy if exists service_schedule_staff_select on public.service_schedule;
create policy service_schedule_staff_select on public.service_schedule
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and (staff.dealer_id = service_schedule.dealer_id or staff.role = 'group_manager')
    )
  );

drop policy if exists service_schedule_manager_insert on public.service_schedule;
create policy service_schedule_manager_insert on public.service_schedule
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and staff.dealer_id = service_schedule.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop policy if exists service_schedule_manager_update on public.service_schedule;
create policy service_schedule_manager_update on public.service_schedule
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and staff.dealer_id = service_schedule.dealer_id
        and staff.role = 'service_manager'
    )
  )
  with check (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and staff.dealer_id = service_schedule.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop policy if exists service_schedule_manager_delete on public.service_schedule;
create policy service_schedule_manager_delete on public.service_schedule
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and staff.dealer_id = service_schedule.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop policy if exists schedule_overrides_staff_select on public.schedule_overrides;
create policy schedule_overrides_staff_select on public.schedule_overrides
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and (staff.dealer_id = schedule_overrides.dealer_id or staff.role = 'group_manager')
    )
  );

drop policy if exists schedule_overrides_manager_insert on public.schedule_overrides;
create policy schedule_overrides_manager_insert on public.schedule_overrides
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and staff.dealer_id = schedule_overrides.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop policy if exists schedule_overrides_manager_update on public.schedule_overrides;
create policy schedule_overrides_manager_update on public.schedule_overrides
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and staff.dealer_id = schedule_overrides.dealer_id
        and staff.role = 'service_manager'
    )
  )
  with check (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and staff.dealer_id = schedule_overrides.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop policy if exists schedule_overrides_manager_delete on public.schedule_overrides;
create policy schedule_overrides_manager_delete on public.schedule_overrides
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.is_active = true
        and staff.dealer_id = schedule_overrides.dealer_id
        and staff.role = 'service_manager'
    )
  );

-- ─── Audit triggers ─────────────────────────────────────────────────────────

create or replace function public.audit_schedule_table_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id text;
  target_dealer uuid;
  target_staff uuid;
begin
  target_id := coalesce(new.id::text, old.id::text);
  target_dealer := coalesce(new.dealer_id, old.dealer_id);
  target_staff := coalesce(new.created_by, old.created_by);

  insert into public.audit_log (staff_id, dealer_id, action, resource_type, resource_id)
  values (
    target_staff,
    target_dealer,
    lower(tg_op) || '_' || tg_table_name,
    tg_table_name,
    target_id
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_service_schedule_changes on public.service_schedule;
create trigger audit_service_schedule_changes
  after insert or update or delete on public.service_schedule
  for each row execute function public.audit_schedule_table_change();

drop trigger if exists audit_schedule_overrides_changes on public.schedule_overrides;
create trigger audit_schedule_overrides_changes
  after insert or update or delete on public.schedule_overrides
  for each row execute function public.audit_schedule_table_change();
