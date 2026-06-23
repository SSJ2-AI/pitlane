-- ─── PitLane Phase 10 task 2: loaner approval workflow ─────────────────────
--
-- Adds the columns the /service-desk loaner-approval UI needs to commit a
-- pickup date and an assigned loaner vehicle on top of the existing
-- pending → approved transition.
--
-- pickup_date is the date the customer comes in to pick up the loaner —
-- distinct from requested_date (which is when they need it to be available
-- by, usually tied to the appointment).
--
-- loaner_vehicle is a free-text placeholder until Phase 11's loaner fleet
-- inventory table lands; today the service desk types in a model number
-- or VIN by hand, e.g. 'Cayenne — VIN 4321'. NULL means 'Standard loaner
-- — to be assigned'.
--
-- Idempotent: both columns guarded by IF NOT EXISTS.

alter table public.loaner_requests
  add column if not exists pickup_date    date,
  add column if not exists loaner_vehicle text;

create index if not exists loaner_requests_pickup_date_idx
  on public.loaner_requests (pickup_date)
  where pickup_date is not null;
