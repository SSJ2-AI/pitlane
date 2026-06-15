-- ─── Phase 3: CDK sync worker — dead-letter state ───────────────────────────
--
-- The sync worker (voice/src/cdk/sync-worker.ts) retries each job up to 3
-- times. After the third failure the row moves to `dead_letter` so:
--   - Operators can query "real failures" cleanly:
--       SELECT * FROM cdk_sync_queue WHERE status = 'dead_letter';
--   - Transient failures (`status = 'pending' AND attempts < 3`) remain
--     visible as work-in-progress instead of being conflated with terminal
--     errors.
--
-- 0001 originally constrained status to ('pending', 'in_progress', 'synced',
-- 'failed'). We add 'dead_letter' as an additional terminal state. 'failed'
-- stays in the enum for backward compatibility but is no longer written by
-- the worker — anything in 'failed' from the pre-Phase-3 era was treated as
-- a one-shot terminal failure and can be re-enqueued by moving its row back
-- to 'pending' manually.

alter table public.cdk_sync_queue
  drop constraint if exists cdk_sync_queue_status_check;

alter table public.cdk_sync_queue
  add constraint cdk_sync_queue_status_check
  check (status in ('pending', 'in_progress', 'synced', 'failed', 'dead_letter'));

create index if not exists cdk_sync_queue_dead_letter_idx
  on public.cdk_sync_queue (status)
  where status = 'dead_letter';
