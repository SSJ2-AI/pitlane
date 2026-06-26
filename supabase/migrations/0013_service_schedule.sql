-- ─── PitLane Phase 13: internal service schedule (calendar) ────────────────
--
-- The service manager defines per-dealer "open hours" and per-day capacity
-- caps so Aria can stop offering open-ended booking ("what time works for
-- you?") and instead present specific available slots backed by actual
-- weekday hours + existing appointment density. Two tables:
--
--   public.service_schedule    — recurring weekly template (one row per
--                                day_of_week per dealer).
--   public.schedule_overrides  — one-off exceptions (holidays, training
--                                days, custom hours for a specific date).
--
-- The /tools/available-slots Railway endpoint (Phase 13) reads both
-- tables to compute the next N bookable slots; the dashboard
-- /manager/calendar surface writes them.
--
-- ─── PIPEDA / Quebec Law 25 compliance note ────────────────────────────────
-- No PII stored in schedule tables. PIPEDA s.4.4 data minimization
-- compliant. The tables hold:
--   - dealer_id (routing key, no PII)
--   - day_of_week / dates / times (operational metadata, no PII)
--   - capacity caps (operational metadata, no PII)
--   - created_by FK -> staff (staff_id is a back-office identifier, not
--     customer PII; tracked so the audit trail can attribute a schedule
--     change to a service manager).
--
-- Customer PII (name, phone, email, vehicle plate) lives in CDK / the
-- existing PIPEDA-minimized tables and NEVER mixes with schedule data.
--
-- Idempotent (IF NOT EXISTS guards). Safe to re-apply.

-- ─── service_schedule (weekly template) ────────────────────────────────────

create table if not exists public.service_schedule (
  id                       uuid         primary key default gen_random_uuid(),
  dealer_id                uuid         not null references public.dealers(id) on delete cascade,
  day_of_week              smallint     not null check (day_of_week between 0 and 6),
  open_time                time         not null default '08:00',
  close_time               time         not null default '18:00',
  slot_duration_mins       smallint     not null default 60,
  max_concurrent_bookings  smallint     not null default 3,
  is_active                boolean      not null default true,
  created_by               uuid         references public.staff(id) on delete set null,
  created_at               timestamptz  not null default now(),
  updated_at               timestamptz  not null default now(),
  unique (dealer_id, day_of_week)
);

create index if not exists service_schedule_dealer_idx
  on public.service_schedule (dealer_id);
create index if not exists service_schedule_active_idx
  on public.service_schedule (dealer_id, is_active);

-- ─── schedule_overrides (per-date exceptions) ──────────────────────────────

create table if not exists public.schedule_overrides (
  id                       uuid         primary key default gen_random_uuid(),
  dealer_id                uuid         not null references public.dealers(id) on delete cascade,
  override_date            date         not null,
  is_blocked               boolean      not null default false,
  reason                   text,
  open_time                time,
  close_time               time,
  max_concurrent_bookings  smallint,
  created_by               uuid         references public.staff(id) on delete set null,
  created_at               timestamptz  not null default now(),
  unique (dealer_id, override_date)
);

create index if not exists schedule_overrides_dealer_idx
  on public.schedule_overrides (dealer_id);
create index if not exists schedule_overrides_date_idx
  on public.schedule_overrides (dealer_id, override_date);

-- ─── Row-Level Security ────────────────────────────────────────────────────
--
-- SELECT — any active staff of the same dealer, plus group_manager (who
-- sees every rooftop). The middleware-set headers don't reach Postgres,
-- so policies key off auth.uid() resolved to a staff row.
--
-- WRITE — only service_manager of the same dealer. group_manager is
-- read-only per the Phase 11 role hierarchy.
--
-- The dashboard API routes use the service-role key (RLS bypass) AND
-- enforce the same gate server-side via readSessionFromRequest; the
-- policies below are belt-and-suspenders for any future caller that
-- uses an anon / per-user JWT.

alter table public.service_schedule  enable row level security;
alter table public.schedule_overrides enable row level security;

drop policy if exists service_schedule_select on public.service_schedule;
create policy service_schedule_select on public.service_schedule
  for select
  using (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and (staff.dealer_id = service_schedule.dealer_id
             or staff.role = 'group_manager')
    )
  );

drop policy if exists service_schedule_insert on public.service_schedule;
create policy service_schedule_insert on public.service_schedule
  for insert
  with check (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.dealer_id = service_schedule.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop policy if exists service_schedule_update on public.service_schedule;
create policy service_schedule_update on public.service_schedule
  for update
  using (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.dealer_id = service_schedule.dealer_id
        and staff.role = 'service_manager'
    )
  )
  with check (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.dealer_id = service_schedule.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop policy if exists service_schedule_delete on public.service_schedule;
create policy service_schedule_delete on public.service_schedule
  for delete
  using (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.dealer_id = service_schedule.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop policy if exists schedule_overrides_select on public.schedule_overrides;
create policy schedule_overrides_select on public.schedule_overrides
  for select
  using (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and (staff.dealer_id = schedule_overrides.dealer_id
             or staff.role = 'group_manager')
    )
  );

drop policy if exists schedule_overrides_insert on public.schedule_overrides;
create policy schedule_overrides_insert on public.schedule_overrides
  for insert
  with check (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.dealer_id = schedule_overrides.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop policy if exists schedule_overrides_update on public.schedule_overrides;
create policy schedule_overrides_update on public.schedule_overrides
  for update
  using (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.dealer_id = schedule_overrides.dealer_id
        and staff.role = 'service_manager'
    )
  )
  with check (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.dealer_id = schedule_overrides.dealer_id
        and staff.role = 'service_manager'
    )
  );

drop policy if exists schedule_overrides_delete on public.schedule_overrides;
create policy schedule_overrides_delete on public.schedule_overrides
  for delete
  using (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.dealer_id = schedule_overrides.dealer_id
        and staff.role = 'service_manager'
    )
  );

-- ─── Audit triggers ────────────────────────────────────────────────────────
--
-- Mirrors the existing pattern from 0011_audit_log.sql — every write
-- (INSERT / UPDATE / DELETE) by an authenticated session lands a row in
-- public.audit_log. Service-role writes (the dashboard API path) also
-- fire the trigger; auth.uid() is null in that case so staff_id ends up
-- null. The application layer also calls recordAudit() with the
-- session.userId so we keep dual coverage.

create or replace function public.audit_schedule_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dealer_id  uuid;
  v_resource   text;
  v_resource_id text;
  v_action     text;
begin
  if (tg_op = 'DELETE') then
    v_dealer_id   := old.dealer_id;
    v_resource_id := old.id::text;
  else
    v_dealer_id   := new.dealer_id;
    v_resource_id := new.id::text;
  end if;

  v_resource := tg_table_name;
  v_action   := lower(tg_op) || '_' || tg_table_name;

  insert into public.audit_log (
    staff_id, dealer_id, action, resource_type, resource_id, ip_address
  ) values (
    auth.uid(), v_dealer_id, v_action, v_resource, v_resource_id, null
  );

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists service_schedule_audit on public.service_schedule;
create trigger service_schedule_audit
  after insert or update or delete on public.service_schedule
  for each row execute function public.audit_schedule_change();

drop trigger if exists schedule_overrides_audit on public.schedule_overrides;
create trigger schedule_overrides_audit
  after insert or update or delete on public.schedule_overrides
  for each row execute function public.audit_schedule_change();
