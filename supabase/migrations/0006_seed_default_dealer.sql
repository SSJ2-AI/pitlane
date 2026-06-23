-- ─── PitLane default-dealer seed (idempotent) ──────────────────────────────
--
-- Bug: Railway log shows
--   'Key (dealer_id)=(aaaaaaaa-0000-0000-0000-000000000001) is not present
--    in table dealers.'
-- which means every voice-service insert keyed to DEFAULT_DEALER_ID fails
-- the call_logs_dealer_id_fkey constraint. The seed in 0003_multi_tenancy
-- used INSERT … ON CONFLICT (id) DO NOTHING, so on Supabase projects where
-- 0003 wasn't applied (or where the row was deleted) the FK target is
-- missing and every Aria write 23503s.
--
-- This migration is the single-purpose idempotent seed for the canonical
-- Porsche Toronto dealer. It can be applied even on a project that ALREADY
-- has the row — the ON CONFLICT DO UPDATE refreshes the name + phone_number
-- without disturbing anything else.
--
-- NOTE: Run this in the Supabase SQL editor after applying — the foreign
-- key on call_logs.dealer_id requires this row to exist.

-- The dashboard onboarding portal (Phase 10 fix 3) wants to know whether
-- a dealer is operating against live CDK or demo data. We add the column
-- here (default false) so the seed can mark Porsche Toronto as the demo
-- rooftop. Safe to re-apply — the IF NOT EXISTS guards the second run.
alter table public.dealers
  add column if not exists use_mock_data boolean not null default false;

insert into public.dealers (
  id,
  name,
  brand,
  location,
  phone_number,
  elevenlabs_agent_id,
  subdomain,
  timezone,
  active,
  use_mock_data
) values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Porsche Toronto',
  'porsche',
  'Don Mills Road',
  '+19063760066',
  'agent_2701ktpgkyr7f37vq8dmgxjw4bkt',
  'porsche-toronto',
  'America/Toronto',
  true,
  true
)
on conflict (id) do update set
  name          = excluded.name,
  phone_number  = excluded.phone_number,
  use_mock_data = excluded.use_mock_data;
