-- ─── PitLane × SMS layer ────────────────────────────────────────────────────
--
-- Adds the two tables that back the Phase 5 SMS feature: a write-only log of
-- every Twilio message we send, and a per-customer consent record that all
-- send paths consult before dispatching.
--
-- Apply with `supabase db push` or paste into the Supabase SQL editor.

-- ─── sms_consent ────────────────────────────────────────────────────────────
-- One row per customer. Defaults to opted_in = true so the demo flow works
-- without an explicit consent ceremony. In production the dealership should
-- populate this from CDK's marketing-consent flag and the customer's
-- written agreement, and STOP/HELP replies from Twilio should flip
-- opted_in -> false (and stamp opted_out_at).

create table if not exists public.sms_consent (
  customer_id  text         primary key,
  opted_in     boolean      not null default true,
  opted_in_at  timestamptz  not null default now(),
  opted_out_at timestamptz,
  source       text                                                     -- 'cdk' | 'aria' | 'web' | 'manual'
);

-- ─── sms_log ────────────────────────────────────────────────────────────────
-- Append-only audit log of every send attempt. status flows
-- queued -> sent -> delivered (or failed), driven by the Twilio status
-- callback we'll wire up in a later phase. For now the route writes
-- 'sent' immediately after a successful Twilio API call.

create table if not exists public.sms_log (
  id            uuid         primary key default gen_random_uuid(),
  customer_id   text,
  to_phone      text         not null,
  from_phone    text,
  message       text         not null,
  message_type  text         not null
                              check (message_type in (
                                'appointment_confirmation',
                                'appointment_reminder',
                                'loaner_confirmed',
                                'car_ready',
                                'parts_arrived',
                                'update',
                                'custom'
                              )),
  twilio_sid    text         unique,
  status        text         not null default 'queued'
                              check (status in ('queued', 'sent', 'delivered', 'failed', 'undelivered', 'skipped')),
  failure_reason text,
  call_log_id   uuid         references public.call_logs (id) on delete set null,
  appointment_id uuid        references public.appointments (id) on delete set null,
  loaner_request_id uuid     references public.loaner_requests (id) on delete set null,
  sent_at       timestamptz  not null default now()
);

create index if not exists sms_log_customer_id_idx on public.sms_log (customer_id);
create index if not exists sms_log_sent_at_idx     on public.sms_log (sent_at desc);
create index if not exists sms_log_status_idx      on public.sms_log (status);
create index if not exists sms_log_type_idx        on public.sms_log (message_type);
