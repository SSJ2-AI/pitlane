-- ─── PitLane Phase 15: appointment status management ───────────────────────
--
-- Service advisors can now action appointments from the service desk. This
-- migration tightens the appointment lifecycle, adds operational timestamps,
-- records reschedule lineage, and logs status transitions to audit_log.
--
-- Existing early demo rows used status='scheduled'. Phase 15 replaces that
-- with the explicit 'confirmed' starting state before installing the new
-- CHECK constraint.

alter table public.appointments
  add column if not exists checked_in_at     timestamptz,
  add column if not exists completed_at      timestamptz,
  add column if not exists rescheduled_from  uuid references public.appointments(id) on delete set null;

update public.appointments
set status = 'confirmed'
where status = 'scheduled';

update public.appointments
set status = 'confirmed'
where status not in ('confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled');

alter table public.appointments
  alter column status set default 'confirmed',
  alter column status set not null;

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.appointments drop constraint if exists %I', c.conname);
  end loop;
end;
$$;

alter table public.appointments
  add constraint appointments_status_check
  check (status in ('confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled'));

create index if not exists appointments_rescheduled_from_idx
  on public.appointments (rescheduled_from)
  where rescheduled_from is not null;

create index if not exists appointments_dealer_date_status_idx
  on public.appointments (dealer_id, date, status);

-- ─── Row-Level Security ────────────────────────────────────────────────────
--
-- Dashboard API routes use the service-role key and enforce this same gate in
-- TypeScript. This RLS policy is defense-in-depth for future per-user callers.

alter table public.appointments enable row level security;

drop policy if exists appointments_service_desk_update on public.appointments;
create policy appointments_service_desk_update on public.appointments
  for update
  using (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.dealer_id = appointments.dealer_id
        and staff.role in ('service_advisor', 'service_manager')
    )
  )
  with check (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.dealer_id = appointments.dealer_id
        and staff.role in ('service_advisor', 'service_manager')
    )
  );

-- ─── Audit trigger ─────────────────────────────────────────────────────────
--
-- Application routes also call recordAudit() with the staff session so
-- service-role writes carry attribution. This trigger captures database-level
-- status transitions even when auth.uid() is unavailable.

create or replace function public.audit_appointment_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (
    staff_id, dealer_id, action, resource_type, resource_id, ip_address
  ) values (
    auth.uid(),
    new.dealer_id,
    'appointment_status_' || old.status || '_to_' || new.status,
    'appointment',
    new.id::text,
    null
  );

  return new;
end;
$$;

drop trigger if exists appointments_status_audit on public.appointments;
create trigger appointments_status_audit
  after update of status on public.appointments
  for each row
  when (old.status is distinct from new.status)
  execute function public.audit_appointment_status_transition();
