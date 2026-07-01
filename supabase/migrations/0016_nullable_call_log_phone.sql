-- ─── PitLane post-call webhook phone attribution fix ───────────────────────
--
-- ElevenLabs post-call payloads can omit caller ANI in some call paths. The
-- application now persists those rows with caller_phone = NULL instead of the
-- old "unknown" sentinel, so the column must be nullable for existing projects.

alter table public.call_logs
  alter column caller_phone drop not null;
