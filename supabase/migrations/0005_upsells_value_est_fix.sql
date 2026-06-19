-- ─── Fix: production Supabase missing upsells.value_est column ──────────────
--
-- Production logs reported:
--   [/api/service-desk/summary] upsells: column upsells.value_est does not exist
--
-- The column IS defined in 0001_aria_intelligence_layer.sql as
-- `value_est numeric(10,2)` — but the column is missing from the
-- production Supabase project. This happens when 0001 was applied from
-- an older version of the file (before value_est was added) or when the
-- column was manually dropped at some point.
--
-- The dashboard /service-desk page's upsell pipeline math depends on
-- this column, so we restore it idempotently rather than removing the
-- query (which would break Phase 4B's "pipeline potential value" stat).
--
-- ADD COLUMN IF NOT EXISTS makes this safe to apply against any
-- production state:
--   - Column already exists → no-op
--   - Column missing → adds it back as nullable numeric(10,2)
--
-- Apply with `supabase db push` or paste into the Supabase SQL editor.

alter table public.upsells
  add column if not exists value_est numeric(10,2);

-- Indexed for the /service-desk pipeline sort (ORDER BY value_est DESC).
create index if not exists upsells_value_est_idx
  on public.upsells (value_est desc nulls last);
