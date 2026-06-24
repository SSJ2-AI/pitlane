-- ─── PitLane Phase 8b: customers index ─────────────────────────────────────
--
-- A LIGHTWEIGHT local index of callers we've talked to. The intent is NOT to
-- duplicate CDK's customer-of-record data — Phase 10's CDK-first strategy
-- treats CDK as the source of truth for contact info, vehicles, RO history.
--
-- This table exists so:
--   1. Aria can auto-create a row when a brand-new phone number calls in,
--      stamp is_new_customer=true on the conversation, and ask for the
--      caller's name without losing the phone number when the call drops.
--   2. The dashboard /customers page can show every caller PitLane has ever
--      interacted with, including ones who never made it into CDK.
--   3. When CDK lookup later finds the same phone, we link cdk_customer_id
--      onto this row instead of duplicating the customer record.
--
-- The columns kept here are deliberately minimal: phone, optional name,
-- timestamps, dealer linkage. Vehicle / RO / appointment data continue to
-- live in CDK (or the existing call_logs / appointments tables for
-- Aria-generated rows).

create table if not exists public.customers (
  id                uuid         primary key default gen_random_uuid(),
  dealer_id         uuid         references public.dealers(id) on delete set null,
  phone             text         not null,
  name              text,
  email             text,
  /** Foreign key into CDK once we've matched this row to a CDK customer
   *  record. NULL until matched. */
  cdk_customer_id   text,
  /** Phase 8b — true until the first time we collect their name. */
  is_new_customer   boolean      not null default true,
  total_calls       int          not null default 0,
  last_call_at      timestamptz,
  last_sentiment    text,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

-- Phone is unique per dealer (one rooftop owns the row). A leading "+" is
-- normalized client-side so the unique constraint catches duplicates.
create unique index if not exists customers_dealer_phone_idx
  on public.customers (dealer_id, phone);

create index if not exists customers_phone_idx        on public.customers (phone);
create index if not exists customers_last_call_at_idx on public.customers (last_call_at desc nulls last);
create index if not exists customers_cdk_id_idx       on public.customers (cdk_customer_id) where cdk_customer_id is not null;
