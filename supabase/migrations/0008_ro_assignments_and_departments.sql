-- ─── PitLane Phase 9b: technician assignments + transfer departments ──────
--
-- Two new tables:
--
--   1. repair_order_assignments: tracks which technicians are working on
--      a given repair order, the service status (in_progress / completed /
--      extended), the original ETA, the actual completion time, and the
--      extended-until timestamp + reason when an advisor pushes the ETA.
--      Aria reads from this on pre-call to inject ro_status / ro_techs /
--      ro_eta / ro_extension_reason into dynamic_variables so she can
--      proactively tell the caller where their car is.
--
--   2. departments: lookup table for the transfer_call tool. Maps a
--      dealer + department name ('service', 'parts', 'sales', etc.) to a
--      Twilio phone number + a display name. Seeded with the canonical
--      five departments for the demo dealer.

create table if not exists public.repair_order_assignments (
  id                    uuid         primary key default gen_random_uuid(),
  dealer_id             uuid         references public.dealers(id) on delete set null,
  repair_order_id       text         not null,
  customer_phone        text,
  /** Parallel arrays — tech_ids[i] corresponds to tech_names[i]. Stored as
   *  text[] (not a join table) because Aria only reads them; relational
   *  cleanliness isn't worth the round-trip cost on pre-call. */
  tech_ids              text[]       not null default '{}',
  tech_names            text[]       not null default '{}',
  service_status        text         not null default 'in_progress'
                          check (service_status in ('pending', 'in_progress', 'awaiting_parts', 'completed', 'extended', 'cancelled')),
  estimated_completion  timestamptz,
  actual_completion     timestamptz,
  extended_until        timestamptz,
  extension_reason      text,
  notes                 text,
  assigned_by           text,
  created_at            timestamptz  not null default now(),
  updated_at            timestamptz  not null default now()
);

create unique index if not exists ro_assignments_dealer_ro_idx
  on public.repair_order_assignments (dealer_id, repair_order_id);

create index if not exists ro_assignments_phone_idx
  on public.repair_order_assignments (customer_phone)
  where customer_phone is not null;

create index if not exists ro_assignments_status_idx
  on public.repair_order_assignments (service_status)
  where service_status in ('in_progress', 'awaiting_parts', 'extended');

-- ─── departments ────────────────────────────────────────────────────────────

create table if not exists public.departments (
  id              uuid         primary key default gen_random_uuid(),
  dealer_id       uuid         references public.dealers(id) on delete cascade,
  name            text         not null,
  twilio_number   text,
  display_name    text         not null,
  is_active       boolean      not null default true,
  created_at      timestamptz  not null default now()
);

create unique index if not exists departments_dealer_name_idx
  on public.departments (dealer_id, name);

-- Seed the canonical five departments for the default Porsche Toronto
-- demo dealer. ON CONFLICT DO NOTHING so re-application is safe.
insert into public.departments (dealer_id, name, twilio_number, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'service',    '+16475550101', 'Service Advisor'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'parts',      '+16475550102', 'Parts Department'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'sales',      '+16475550103', 'Sales Team'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'manager',    '+16475550104', 'Service Manager'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'reception',  '+19063760066', 'Reception')
on conflict (dealer_id, name) do nothing;
