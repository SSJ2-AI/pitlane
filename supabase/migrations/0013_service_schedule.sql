-- ─── PitLane Phase 13: Internal calendar — service schedule ────────────────
--
-- PIPEDA note:
--   No PII stored in schedule tables. PIPEDA s.4.4 data minimization compliant.

create extension if not exists "pgcrypto";

create table if not exists public.service_schedule (
  id                        uuid         primary key default gen_random_uuid(),
  dealer_id                 uuid         not null references public.dealers(id) on delete cascade,
  day_of_week               smallint     not null check (day_of_week between 0 and 6),
  open_time                 time         not null default '08:00',
  close_time                time         not null default '18:00',
  slot_duration_mins        smallint     not null default 60,
  max_concurrent_bookings   smallint     not null default 3,
  is_active                 boolean      not null default true,
  created_by                uuid         references public.staff(id),
  created_at                timestamptz  not null default now(),
  updated_at                timestamptz  not null default now(),
  unique (dealer_id, day_of_week)
);

create table if not exists public.schedule_overrides (
  id                        uuid         primary key default gen_random_uuid(),
  dealer_id                 uuid         not null references public.dealers(id) on delete cascade,
  override_date             date         not null,
  is_blocked                boolean      not null default false,
  reason                    text,
  open_time                 time,
  close_time                time,
  max_concurrent_bookings   smallint,
  created_by                uuid         references public.staff(id),
  created_at                timestamptz  not null default now(),
  unique (dealer_id, override_date)
);

create index if not exists service_schedule_dealer_idx
  on public.service_schedule (dealer_id, day_of_week);
create index if not exists schedule_overrides_dealer_idx
  on public.schedule_overrides (dealer_id, override_date);

alter table public.service_schedule enable row level security;
alter table public.schedule_overrides enable row level security;

drop policy if exists "service_schedule_select" on public.service_schedule;
drop policy if exists "service_schedule_write" on public.service_schedule;
drop policy if exists "schedule_overrides_select" on public.schedule_overrides;
drop policy if exists "schedule_overrides_write" on public.schedule_overrides;

create policy "service_schedule_select"
  on public.service_schedule
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and (
          staff.dealer_id = service_schedule.dealer_id
          or staff.role = 'group_manager'
        )
    )
  );

create policy "service_schedule_write"
  on public.service_schedule
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.dealer_id = service_schedule.dealer_id
        and staff.role = 'service_manager'
    )
  )
  with check (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.dealer_id = service_schedule.dealer_id
        and staff.role = 'service_manager'
    )
  );

create policy "schedule_overrides_select"
  on public.schedule_overrides
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and (
          staff.dealer_id = schedule_overrides.dealer_id
          or staff.role = 'group_manager'
        )
    )
  );

create policy "schedule_overrides_write"
  on public.schedule_overrides
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.dealer_id = schedule_overrides.dealer_id
        and staff.role = 'service_manager'
    )
  )
  with check (
    exists (
      select 1
      from public.staff
      where staff.id = auth.uid()
        and staff.dealer_id = schedule_overrides.dealer_id
        and staff.role = 'service_manager'
    )
  );

create or replace function public.pitlane_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists service_schedule_touch_updated_at on public.service_schedule;
create trigger service_schedule_touch_updated_at
  before update on public.service_schedule
  for each row
  execute function public.pitlane_touch_updated_at();

create or replace function public.pitlane_audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  actor_dealer uuid;
  action_name text;
  resource_type text;
  resource_id text;
begin
  actor_id := auth.uid();
  if actor_id is null then
    actor_id := coalesce(new.created_by, old.created_by);
  end if;

  actor_dealer := coalesce(new.dealer_id, old.dealer_id);
  action_name := format('%s_%s', tg_table_name, lower(tg_op));
  resource_type := tg_table_name;
  resource_id := coalesce(new.id::text, old.id::text);

  begin
    insert into public.audit_log (staff_id, dealer_id, action, resource_type, resource_id, ip_address)
    values (actor_id, actor_dealer, action_name, resource_type, resource_id, null);
  exception
    when undefined_table then
      null;
  end;

  return null;
end;
$$;

drop trigger if exists service_schedule_audit_row_change on public.service_schedule;
create trigger service_schedule_audit_row_change
  after insert or update or delete on public.service_schedule
  for each row
  execute function public.pitlane_audit_row_change();

drop trigger if exists schedule_overrides_audit_row_change on public.schedule_overrides;
create trigger schedule_overrides_audit_row_change
  after insert or update or delete on public.schedule_overrides
  for each row
  execute function public.pitlane_audit_row_change();
