-- ─── PitLane Phase 11 compliance follow-up: customers PII minimization ────
--
-- PIPEDA data-minimization principle + the CDK-first read policy already
-- documented in migration 0006 mean PitLane must NEVER store customer
-- PII locally. CDK is the source of truth for name / email / address /
-- contact preferences. This migration brings the public.customers schema
-- in line with that boundary by dropping the PII columns that were added
-- in 0006 and adding an aria_notes column for AI-generated session notes
-- (which are NOT PII — they're operational observations like
-- "called about brake squeal").
--
-- COMPLIANCE BOUNDARY:
--   The public.customers table is METADATA ONLY. It holds:
--     phone           text — caller phone (technically PII, but required
--                            to anchor call history when CDK doesn't have
--                            the caller yet)
--     dealer_id       uuid — routing key, no PII
--     is_new_customer bool — derived flag, no PII
--     last_seen_at    ts   — derived metric, no PII
--     total_calls     int  — derived metric, no PII
--     last_sentiment  text — Aria-generated bucket, no PII
--     aria_notes      text — Aria-generated free text (must NOT contain
--                            PII; the summariser prompt is responsible
--                            for that constraint)
--     cdk_customer_id text — pointer into CDK once matched
--     created_at / updated_at
--
--   Columns dropped here (name, email) live in CDK only. update_customer_name
--   tool now queues a CDK write-back via cdk_sync_queue rather than
--   persisting locally; see voice/src/routes/tools.ts in this PR.
--
-- Idempotent. Safe to apply on top of any existing 0006 schema.

-- Add the new aria_notes column first so callers can write to it
-- immediately on deploy.
alter table public.customers
  add column if not exists aria_notes   text,
  add column if not exists last_seen_at timestamptz;

-- Backfill last_seen_at from the existing last_call_at column when
-- present, then drop the old column. Wrapped in a DO block so an env
-- where 0006 was never applied (and last_call_at doesn't exist) doesn't
-- trip up.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers' and column_name = 'last_call_at'
  ) then
    execute 'update public.customers set last_seen_at = coalesce(last_seen_at, last_call_at)';
    execute 'alter table public.customers drop column last_call_at';
  end if;
end $$;

-- Drop the PII columns. PostgreSQL's IF EXISTS makes this safe to
-- re-apply on a project where the columns were never added.
alter table public.customers
  drop column if exists name,
  drop column if exists email;

-- The cdk_customer_id index still applies; nothing else to do.
