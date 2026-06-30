-- ─── PitLane Phase 15: appointment status lifecycle ───────────────────────
--
-- Previously appointments only carried a coarse status of
-- ('confirmed', 'scheduled', 'cancelled', 'completed'). The service desk
-- needs richer lifecycle states so advisors can action arrivals in real
-- time:
--
--   confirmed     — appointment is booked, customer has not arrived
--   checked_in    — advisor has greeted the customer and taken keys
--   in_progress   — tech is actively working the RO
--   completed     — RO closed, customer picked up (terminal)
--   cancelled     — appointment was cancelled by customer or advisor (terminal)
--
-- We also record:
--
--   checked_in_at      — first time the row moved into 'checked_in'
--   completed_at       — first time the row moved into 'completed'
--   rescheduled_from   — when an appointment is moved to a new date/time,
--                        the (in-place) update stamps this column with the
--                        appointment's own id so the audit trail can tell
--                        a fresh booking apart from a reschedule.
--
-- ─── PIPEDA / Quebec Law 25 compliance note ────────────────────────────────
--
-- No new PII columns. The lifecycle timestamps are operational metadata
-- (when did the customer arrive, when did the RO close) and the
-- rescheduled_from column is a self-FK to the same dealer-scoped row.
-- The audit trigger below records who flipped status when, satisfying
-- the "who saw / changed what" requirement of PIPEDA s.4.7.
--
-- Idempotent (IF NOT EXISTS / drop-and-recreate guards). Safe to re-apply.

-- ─── Backfill any legacy 'scheduled' rows to 'confirmed' ───────────────────
--
-- The new CHECK constraint enumerates only the five Phase-15 lifecycle
-- states. Pre-Phase-15 demo rows may carry the legacy 'scheduled' value
-- (it shipped in 0001 but is no longer a valid lifecycle state). Map
-- them to 'confirmed' so the constraint applies cleanly.

update public.appointments
   set status = 'confirmed'
 where status = 'scheduled';

-- ─── Swap the CHECK constraint ─────────────────────────────────────────────

alter table public.appointments
  drop constraint if exists appointments_status_check;

alter table public.appointments
  add constraint appointments_status_check
  check (status in ('confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled'));

alter table public.appointments
  alter column status set default 'confirmed';

-- ─── Lifecycle timestamp columns + reschedule self-FK ─────────────────────

alter table public.appointments
  add column if not exists checked_in_at   timestamptz;
alter table public.appointments
  add column if not exists completed_at    timestamptz;
alter table public.appointments
  add column if not exists rescheduled_from uuid
    references public.appointments(id) on delete set null;

create index if not exists appointments_status_lifecycle_idx
  on public.appointments (dealer_id, status, date);
create index if not exists appointments_rescheduled_from_idx
  on public.appointments (rescheduled_from)
  where rescheduled_from is not null;

-- ─── Row-Level Security ────────────────────────────────────────────────────
--
-- 0003_multi_tenancy.sql already enabled RLS on public.appointments and
-- added the dealer_isolation_appointments USING policy (anon / per-user
-- JWT reads must match the request's dealer). Phase 15 adds an UPDATE
-- policy specifically for the status lifecycle: service_advisor and
-- service_manager of the same dealer may flip status / stamp the
-- lifecycle timestamps / set rescheduled_from. Inserts and deletes
-- remain service-role only (Aria book_appointment continues to run with
-- the service-role key which bypasses RLS).
--
-- The application API routes also enforce role + dealer scope server-side
-- via readSessionFromRequest, so this policy is belt-and-suspenders for
-- any future caller that connects with an anon JWT.

alter table public.appointments enable row level security;

drop policy if exists appointments_status_update on public.appointments;
create policy appointments_status_update on public.appointments
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
-- Mirrors the recordAudit() pattern from 0011_audit_log.sql and the
-- per-table audit triggers from 0013_service_schedule.sql / 0014_loaner_fleet.sql.
-- Every status transition (old.status <> new.status) lands a row in
-- public.audit_log with action='appointment_status_transition' so the
-- compliance investigator can reconstruct who flipped an appointment from
-- confirmed -> checked_in -> ... and when.
--
-- A reschedule (new.rescheduled_from is not null and changed) is logged
-- with action='appointment_rescheduled' so calendar churn is visible in
-- the same trail.
--
-- The application layer ALSO calls recordAudit() with the session's
-- userId from the API route; the trigger here catches direct DB writes
-- and acts as belt-and-suspenders.

create or replace function public.audit_appointment_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  if (tg_op = 'UPDATE') then
    if (new.status is distinct from old.status) then
      v_action := 'appointment_status_transition';
      insert into public.audit_log (
        staff_id, dealer_id, action, resource_type, resource_id, ip_address
      ) values (
        auth.uid(), new.dealer_id, v_action, 'appointment', new.id::text, null
      );
    end if;
    if (new.rescheduled_from is distinct from old.rescheduled_from
        and new.rescheduled_from is not null) then
      v_action := 'appointment_rescheduled';
      insert into public.audit_log (
        staff_id, dealer_id, action, resource_type, resource_id, ip_address
      ) values (
        auth.uid(), new.dealer_id, v_action, 'appointment', new.id::text, null
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_status_audit on public.appointments;
create trigger appointments_status_audit
  after update on public.appointments
  for each row execute function public.audit_appointment_status_change();
