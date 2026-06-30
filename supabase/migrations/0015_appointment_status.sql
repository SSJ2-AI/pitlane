-- ─── PitLane Phase 15: appointment status management ───────────────────────
--
-- Service advisors can now action appointments directly from /service-desk:
-- checked-in, in-progress, completed, cancelled, and same-day reschedule.
--
-- This migration:
--   1) extends public.appointments with status lifecycle metadata
--   2) tightens the status CHECK constraint
--   3) enables RLS + adds advisor/manager update policy (same dealer)
--   4) adds an audit trigger for status transitions

-- ─── appointments columns ───────────────────────────────────────────────────

-- Existing datasets may still carry "scheduled". Normalize before tightening
-- the CHECK constraint so the migration is re-runnable and non-breaking.
update public.appointments
set status = 'confirmed'
where status = 'scheduled';

alter table public.appointments
  add column if not exists checked_in_at timestamptz;

alter table public.appointments
  add column if not exists completed_at timestamptz;

alter table public.appointments
  add column if not exists rescheduled_from uuid references public.appointments(id) on delete set null;

-- Replace the legacy status constraint from 0001.
alter table public.appointments
  drop constraint if exists appointments_status_check;

alter table public.appointments
  add constraint appointments_status_check
  check (status in ('confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled'));

alter table public.appointments
  alter column status set default 'confirmed';

alter table public.appointments
  alter column status set not null;

create index if not exists appointments_rescheduled_from_idx
  on public.appointments (rescheduled_from);

-- ─── Row-Level Security ─────────────────────────────────────────────────────

alter table public.appointments enable row level security;

drop policy if exists appointment_status_update on public.appointments;
create policy appointment_status_update on public.appointments
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

-- ─── Audit trigger: appointment status transitions ─────────────────────────

create or replace function public.audit_appointment_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.audit_log (
      staff_id, dealer_id, action, resource_type, resource_id, ip_address
    ) values (
      auth.uid(),
      new.dealer_id,
      'update_appointment_status',
      'appointment_status_transition',
      new.id::text || ':' || old.status || '->' || new.status,
      null
    );
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_status_audit on public.appointments;
create trigger appointments_status_audit
  after update of status on public.appointments
  for each row execute function public.audit_appointment_status_change();
