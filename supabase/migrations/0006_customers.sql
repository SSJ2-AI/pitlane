-- ─── PitLane Phase 8b: customers index (CDK-first read policy) ────────────
--
-- This is a METADATA-ONLY local index of phone numbers Aria has talked to.
-- CDK is the source of truth for customer contact info (name, email,
-- preferred language, address) AND for vehicles / ROs / appointments /
-- warranty data. This table exists purely so PitLane can:
--
--   1. Auto-create a row when a brand-new phone calls in — stamp
--      is_new_customer=true on the conversation, ask Aria to collect the
--      caller's name, and keep the phone number around even if the call
--      drops before CDK enrolment.
--   2. Show every caller PitLane has interacted with on the /customers
--      page, including ones who haven't made it into CDK yet.
--   3. Anchor Aria-generated artifacts (call_logs, callback_requests,
--      loaner_requests) to a stable customer reference when no
--      cdk_customer_id exists yet.
--
-- READ POLICY (enforced in src/app/api/customers + customers/by-phone):
--   - CDK first via lookupCustomerByPhone. When CDK has the record, the
--     dashboard displays CDK's name / email / preferred language. The
--     local row is NOT surfaced in that case.
--   - Local row only when CDK misses (or Fortellis isn't configured).
--   - Once cdk_customer_id is set on this row, the dashboard never
--     displays the local name/email — those come from CDK exclusively.
--
-- The columns kept here are intentionally narrow — phone, optional name,
-- timestamps, dealer linkage. We do not store address, vehicle data, or
-- contact preferences here; those belong to CDK.

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
