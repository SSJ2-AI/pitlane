-- ─── PitLane multi-tenancy foundation ──────────────────────────────────────
--
-- Every operational table that holds dealer-specific data now carries a
-- dealer_id FK so a single Supabase project can host data for many rooftops.
-- We add the column nullable + ON DELETE SET NULL so existing demo rows
-- (created before this migration) don't break — they just have a NULL
-- dealer_id and won't be visible to any tenanted query.
--
-- All voice + dashboard code that runs after this migration writes
-- dealer_id = DEFAULT_DEALER.id (set in src/lib/dealer.ts) until a multi-
-- tenant deploy is provisioned.
--
-- Apply with `supabase db push` or paste into the Supabase SQL editor.

-- ─── dealers ─────────────────────────────────────────────────────────────────

create table if not exists public.dealers (
  id                          uuid         primary key default gen_random_uuid(),
  name                        text         not null,
  brand                       text         not null,                          -- 'porsche' | 'audi' | 'bmw' | …
  location                    text         not null,                          -- 'Don Mills Road'
  phone_number                text         unique,                            -- Twilio number, E.164
  elevenlabs_agent_id         text,                                           -- shared across rooftops per brand
  fortellis_subscription_id   text,
  fortellis_client_id         text,
  fortellis_client_secret     text,                                           -- TODO: encrypt at app layer (AES-256)
  subdomain                   text         unique,                            -- 'porsche-toronto' -> porsche-toronto.pitlane.ai
  timezone                    text         not null default 'America/Toronto',
  active                      boolean      not null default true,
  created_at                  timestamptz  not null default now()
);

create index if not exists dealers_brand_idx        on public.dealers (brand);
create index if not exists dealers_active_idx       on public.dealers (active);
create index if not exists dealers_subdomain_idx    on public.dealers (subdomain);

-- ─── dealer_id columns on every operational table ───────────────────────────

alter table public.call_logs       add column if not exists dealer_id uuid references public.dealers(id) on delete set null;
alter table public.appointments    add column if not exists dealer_id uuid references public.dealers(id) on delete set null;
alter table public.upsells         add column if not exists dealer_id uuid references public.dealers(id) on delete set null;
alter table public.loaner_requests add column if not exists dealer_id uuid references public.dealers(id) on delete set null;
alter table public.cdk_sync_queue  add column if not exists dealer_id uuid references public.dealers(id) on delete set null;
alter table public.sms_log         add column if not exists dealer_id uuid references public.dealers(id) on delete set null;
alter table public.sms_consent     add column if not exists dealer_id uuid references public.dealers(id) on delete set null;

create index if not exists call_logs_dealer_id_idx       on public.call_logs       (dealer_id);
create index if not exists appointments_dealer_id_idx    on public.appointments    (dealer_id);
create index if not exists upsells_dealer_id_idx         on public.upsells         (dealer_id);
create index if not exists loaner_requests_dealer_id_idx on public.loaner_requests (dealer_id);
create index if not exists cdk_sync_queue_dealer_id_idx  on public.cdk_sync_queue  (dealer_id);
create index if not exists sms_log_dealer_id_idx         on public.sms_log         (dealer_id);

-- ─── Seed: Porsche Toronto (matches DEFAULT_DEALER in src/lib/dealer.ts) ────

insert into public.dealers (
  id, name, brand, location, phone_number, elevenlabs_agent_id, subdomain, timezone, active
) values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Porsche Toronto',
  'porsche',
  'Don Mills Road',
  '+19063760066',
  'agent_2701ktpgkyr7f37vq8dmgxjw4bkt',
  'porsche-toronto',
  'America/Toronto',
  true
)
on conflict (id) do nothing;

-- Backfill existing demo rows so they remain visible to the seeded dealer.
update public.call_logs       set dealer_id = 'aaaaaaaa-0000-0000-0000-000000000001' where dealer_id is null;
update public.appointments    set dealer_id = 'aaaaaaaa-0000-0000-0000-000000000001' where dealer_id is null;
update public.upsells         set dealer_id = 'aaaaaaaa-0000-0000-0000-000000000001' where dealer_id is null;
update public.loaner_requests set dealer_id = 'aaaaaaaa-0000-0000-0000-000000000001' where dealer_id is null;
update public.cdk_sync_queue  set dealer_id = 'aaaaaaaa-0000-0000-0000-000000000001' where dealer_id is null;
update public.sms_log         set dealer_id = 'aaaaaaaa-0000-0000-0000-000000000001' where dealer_id is null;
update public.sms_consent     set dealer_id = 'aaaaaaaa-0000-0000-0000-000000000001' where dealer_id is null;

-- ─── Row-level security ────────────────────────────────────────────────────
--
-- Defense-in-depth: when the dashboard or any future caller uses an anon /
-- per-user JWT key (instead of the service role), reads are forced through
-- the dealer_isolation policy. The voice service and dashboard API routes
-- currently use the service-role key which bypasses RLS, so this doesn't
-- affect today's write paths — it just makes the schema safe the moment a
-- non-service-role connection appears.
--
-- The application sets `app.current_dealer_id` via:
--   SELECT set_config('app.current_dealer_id', '<uuid>', true);
-- before any per-request query when running outside service-role.

alter table public.call_logs       enable row level security;
alter table public.appointments    enable row level security;
alter table public.upsells         enable row level security;
alter table public.loaner_requests enable row level security;
alter table public.sms_log         enable row level security;

drop policy if exists dealer_isolation_call_logs       on public.call_logs;
drop policy if exists dealer_isolation_appointments    on public.appointments;
drop policy if exists dealer_isolation_upsells         on public.upsells;
drop policy if exists dealer_isolation_loaner_requests on public.loaner_requests;
drop policy if exists dealer_isolation_sms_log         on public.sms_log;

create policy dealer_isolation_call_logs       on public.call_logs       using (dealer_id = nullif(current_setting('app.current_dealer_id', true), '')::uuid);
create policy dealer_isolation_appointments    on public.appointments    using (dealer_id = nullif(current_setting('app.current_dealer_id', true), '')::uuid);
create policy dealer_isolation_upsells         on public.upsells         using (dealer_id = nullif(current_setting('app.current_dealer_id', true), '')::uuid);
create policy dealer_isolation_loaner_requests on public.loaner_requests using (dealer_id = nullif(current_setting('app.current_dealer_id', true), '')::uuid);
create policy dealer_isolation_sms_log         on public.sms_log         using (dealer_id = nullif(current_setting('app.current_dealer_id', true), '')::uuid);
