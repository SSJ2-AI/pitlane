-- ─── PitLane Phase 15b: call_logs.caller_phone nullable ────────────────────
--
-- Context: the ElevenLabs post-call webhook was writing the string literal
-- 'unknown' into call_logs.caller_phone (and customers.phone) whenever the
-- payload didn't surface a caller-id. That silently broke:
--
--   • customer auto-creation — every unknown-caller call collapsed onto
--     the single (dealer_id, 'unknown') row via the customers unique key,
--   • call history attribution — analytics grouped every unknown caller
--     together as a single "person" instead of unrelated calls,
--   • CDK sync — the queue drained rows with 'unknown' as the phone,
--     which the Fortellis Customer API rejects.
--
-- The application code (voice/src/routes/webhook.ts + postCallProcessor.ts)
-- has been updated to walk every ElevenLabs caller-id location, normalise
-- to E.164, and pass through NULL when nothing was found — never the
-- string 'unknown'. This migration makes the DB column nullable so those
-- writes land, and back-fills the legacy 'unknown' rows to NULL so
-- reports stop counting them as a real number.

-- 1. Drop the NOT NULL constraint. Existing rows are unaffected.
alter table public.call_logs
  alter column caller_phone drop not null;

-- 2. Back-fill legacy 'unknown' sentinel rows so downstream queries can
--    trust a NULL check. Safe: this only touches rows whose caller_phone
--    is the literal string 'unknown' (case-insensitive to catch any
--    inadvertent casing from older code paths).
update public.call_logs
set caller_phone = null
where caller_phone is not null
  and lower(caller_phone) = 'unknown';

-- 3. Also scrub the customers.phone sentinel row(s). The (dealer_id, phone)
--    unique index means at most one row per dealer will match; deleting it
--    is safe because call_logs.customer_id is text (CDK id) rather than a
--    hard FK into public.customers.id, so historical call rows are
--    unaffected.
delete from public.customers
where lower(phone) = 'unknown';
