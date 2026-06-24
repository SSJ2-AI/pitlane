-- ─── PitLane Phase 9a: sentiment + callback requests ───────────────────────
--
-- Two parallel surfaces:
--
--   1. Sentiment is upgraded from a free-text JSON field inside
--      call_logs.summary to a first-class indexable column at the table
--      root, with an accompanying confidence score. Lets the dashboard
--      filter / sort calls by sentiment directly without parsing JSON.
--
--   2. callback_requests is a new dedicated queue table. Aria writes a row
--      via the request_callback tool when a caller asks for a human; the
--      /service-desk page renders it as a sortable list (frustrated first,
--      then oldest). status transitions: pending -> acknowledged ->
--      completed.
--
-- Both pieces are additive and idempotent.

-- ─── call_logs sentiment columns ────────────────────────────────────────────
alter table public.call_logs
  add column if not exists sentiment        text,
  add column if not exists sentiment_score  numeric(3,2);

create index if not exists call_logs_sentiment_idx
  on public.call_logs (sentiment)
  where sentiment is not null;

-- ─── callback_requests ──────────────────────────────────────────────────────
create table if not exists public.callback_requests (
  id                    uuid         primary key default gen_random_uuid(),
  dealer_id             uuid         references public.dealers(id) on delete set null,
  customer_phone        text         not null,
  customer_name         text,
  call_log_id           uuid         references public.call_logs(id) on delete set null,
  reason                text,
  sentiment             text,
  sentiment_score       numeric(3,2),
  status                text         not null default 'pending'
                          check (status in ('pending', 'acknowledged', 'completed', 'cancelled')),
  assigned_advisor_id   text,
  created_at            timestamptz  not null default now(),
  acknowledged_at       timestamptz,
  completed_at          timestamptz
);

create index if not exists callback_requests_status_idx
  on public.callback_requests (status)
  where status in ('pending', 'acknowledged');

create index if not exists callback_requests_dealer_status_idx
  on public.callback_requests (dealer_id, status);

create index if not exists callback_requests_phone_idx
  on public.callback_requests (customer_phone);

create index if not exists callback_requests_created_at_idx
  on public.callback_requests (created_at desc);
