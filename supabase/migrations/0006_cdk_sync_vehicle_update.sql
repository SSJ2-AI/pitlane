-- ─── PitLane Phase 10 feature 1: cdk_sync_queue 'vehicle_update' ───────────
--
-- Aria's book_appointment tool now accepts a current_mileage parameter and
-- queues a vehicle_update row so the Phase 3 CDK sync worker can push the
-- new mileage to CDK Drive Vehicles independently of the appointment row.
--
-- 0001 created the entity_type CHECK with four values. 0004 widened the
-- *status* CHECK the same way. Here we widen entity_type to include
-- 'vehicle_update'.
--
-- Safe to re-apply: drop the named constraint if present, then recreate.

alter table public.cdk_sync_queue
  drop constraint if exists cdk_sync_queue_entity_type_check;

alter table public.cdk_sync_queue
  add constraint cdk_sync_queue_entity_type_check
  check (entity_type in ('appointment', 'upsell', 'loaner_request', 'note', 'vehicle_update'));
