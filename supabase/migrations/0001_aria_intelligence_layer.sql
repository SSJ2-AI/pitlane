-- ─── PitLane × Aria service-intelligence schema ─────────────────────────────
--
-- Applies the tables that back the post-call summary pipeline, the new Aria
-- tools (book-appointment, log-upsell, request-loaner), and the eventual CDK
-- write-back worker. Run with `supabase db push` (Supabase CLI) or paste into
-- the SQL editor in the Supabase dashboard.
--
-- All tables use uuid primary keys and timestamptz audit columns. Cross-table
-- foreign keys use ON DELETE SET NULL so deleting a call_log doesn't cascade
-- and wipe out historical appointments / upsells / loaner requests.
--
-- ─── Extensions ──────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ─── call_logs ────────────────────────────────────────────────────────────────
-- One row per Aria phone call. Created in 'in_progress' status by the
-- pre-call webhook, finalized by the post-call webhook with the GPT-4o-mini
-- summary and full transcript.

create table if not exists public.call_logs (
  id              uuid        primary key default gen_random_uuid(),
  caller_phone    text        not null,
  customer_id     text,
  call_sid        text        unique,
  conversation_id text        unique,
  direction       text        not null default 'inbound'
                                check (direction in ('inbound', 'outbound')),
  duration_secs   integer,
  summary         jsonb,
  transcript      jsonb,
  status          text        not null default 'in_progress'
                                check (status in ('in_progress', 'completed', 'failed', 'no_answer')),
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists call_logs_caller_phone_idx on public.call_logs (caller_phone);
create index if not exists call_logs_customer_id_idx   on public.call_logs (customer_id);
create index if not exists call_logs_started_at_idx    on public.call_logs (started_at desc);
create index if not exists call_logs_status_idx        on public.call_logs (status);

-- ─── appointments ────────────────────────────────────────────────────────────
-- Created when Aria's book-appointment tool fires. cdk_id is populated once
-- the async CDK sync worker reconciles with Fortellis.

create table if not exists public.appointments (
  id            uuid        primary key default gen_random_uuid(),
  customer_id   text        not null,
  vehicle_id    text        not null,
  date          date        not null,
  time          time        not null,
  service_type  text        not null,
  advisor       text,
  duration_est_hours numeric(5,2),
  status        text        not null default 'confirmed'
                              check (status in ('confirmed', 'scheduled', 'cancelled', 'completed')),
  confirmation_number text  unique,
  cdk_id        text,
  call_log_id   uuid        references public.call_logs (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists appointments_customer_id_idx on public.appointments (customer_id);
create index if not exists appointments_date_idx        on public.appointments (date);
create index if not exists appointments_status_idx      on public.appointments (status);

-- ─── upsells ─────────────────────────────────────────────────────────────────
-- Tracks every service upsell Aria flags during a call (or that the advisor
-- logs manually). status flows pending -> accepted | declined.

create table if not exists public.upsells (
  id           uuid           primary key default gen_random_uuid(),
  call_log_id  uuid           references public.call_logs (id) on delete set null,
  customer_id  text           not null,
  vehicle_id   text           not null,
  upsell_type  text           not null,
  description  text,
  value_est    numeric(10,2),
  status       text           not null default 'pending'
                                check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at   timestamptz    not null default now()
);

create index if not exists upsells_customer_id_idx on public.upsells (customer_id);
create index if not exists upsells_status_idx      on public.upsells (status);

-- ─── loaner_requests ─────────────────────────────────────────────────────────
-- Service desk approves these; once approved the worker finalises the
-- linked appointment and triggers the email + ICS calendar invite.

create table if not exists public.loaner_requests (
  id                uuid        primary key default gen_random_uuid(),
  call_log_id       uuid        references public.call_logs (id) on delete set null,
  appointment_id    uuid        references public.appointments (id) on delete set null,
  customer_id       text        not null,
  requested_date    date,
  loaner_preferred  text,
  status            text        not null default 'pending'
                                  check (status in ('pending', 'approved', 'declined', 'fulfilled')),
  notes             text,
  resolved_by       text,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists loaner_requests_customer_id_idx on public.loaner_requests (customer_id);
create index if not exists loaner_requests_status_idx      on public.loaner_requests (status);

-- ─── cdk_sync_queue ──────────────────────────────────────────────────────────
-- Outbound CDK write queue. The Phase 3 background worker drains this every
-- 30s, hits Fortellis, and on success: status='synced', updates cdk_id on
-- the parent row (appointment / upsell / etc.).

create table if not exists public.cdk_sync_queue (
  id            uuid        primary key default gen_random_uuid(),
  entity_type   text        not null
                              check (entity_type in ('appointment', 'upsell', 'loaner_request', 'note')),
  entity_id     uuid        not null,
  payload       jsonb       not null,
  status        text        not null default 'pending'
                              check (status in ('pending', 'in_progress', 'synced', 'failed')),
  attempts      integer     not null default 0,
  last_error    text,
  last_attempt  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists cdk_sync_queue_status_idx on public.cdk_sync_queue (status);
create index if not exists cdk_sync_queue_entity_idx on public.cdk_sync_queue (entity_type, entity_id);
