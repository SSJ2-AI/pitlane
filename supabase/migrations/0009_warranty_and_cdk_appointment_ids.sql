-- ─── PitLane Phase 10: warranty + CDK appointment ids ──────────────────────
--
-- Two minor additions in support of the Phase 10 calendar + warranty surfaces.
-- Both honour the CDK-first principle: store ONLY the data CDK doesn't own
-- and reach back to CDK for the source-of-truth read.
--
-- 1. appointments.cdk_appointment_id (text). When book_appointment posts a
--    real slot to CDK Scheduling we cache the returned appointmentId here
--    so the dashboard can deep-link into the CDK record without a second
--    round-trip. Distinct from the existing 'cdk_id' column — that one was
--    used by the early cdk_sync_queue worker; this one is the canonical
--    CDK appointment foreign key.
--
-- 2. appointments.is_aria_booked (boolean default false). Drives the
--    Aria-teal / advisor-gray colouring on the /schedule calendar view.
--    Phase 10 task 3 calls it out explicitly; rather than infer it from
--    call_log_id NOT NULL we store the flag directly because some Aria
--    bookings won't have a call_log row (intake-only flows).
--
-- Both columns are nullable + IF NOT EXISTS so the migration is safe to
-- apply on top of any existing appointments table.

alter table public.appointments
  add column if not exists cdk_appointment_id text,
  add column if not exists is_aria_booked     boolean not null default false;

create index if not exists appointments_cdk_appointment_id_idx
  on public.appointments (cdk_appointment_id)
  where cdk_appointment_id is not null;
