-- ─── PitLane Phase 10 feature 2: customer_intakes ──────────────────────────
--
-- Aria's `intake_new_customer` tool calls this when customer_lookup misses.
-- The service desk picks the row up via the dashboard, verifies the
-- caller's details, and converts the intake into a real CDK / dashboard
-- customer record. status defaults to 'pending' and transitions to
-- 'converted' or 'dismissed' from the dashboard.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).

create table if not exists public.customer_intakes (
  id                    uuid         primary key default gen_random_uuid(),
  call_log_id           uuid         references public.call_logs(id) on delete set null,
  dealer_id             uuid         references public.dealers(id)   on delete set null,
  phone                 text         not null,
  full_name             text         not null,
  vehicle_year          int,
  vehicle_make          text,
  vehicle_model         text,
  vehicle_vin           text,
  mileage_approx        int,
  reason_for_calling    text,
  status                text         not null default 'pending'
                          check (status in ('pending', 'converted', 'dismissed')),
  resolved_by           text,
  resolved_at           timestamptz,
  created_at            timestamptz  not null default now()
);

create index if not exists customer_intakes_status_idx     on public.customer_intakes (status);
create index if not exists customer_intakes_dealer_id_idx  on public.customer_intakes (dealer_id);
create index if not exists customer_intakes_phone_idx      on public.customer_intakes (phone);
create index if not exists customer_intakes_created_at_idx on public.customer_intakes (created_at desc);
