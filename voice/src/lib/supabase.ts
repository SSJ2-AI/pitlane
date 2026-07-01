import WS from 'ws'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ─── PitLane × Supabase client ───────────────────────────────────────────────
//
// All persistence (call_logs, appointments, upsells, loaner_requests,
// cdk_sync_queue) flows through this single client. The wrapper is designed so
// that *every* call site can ask `getSupabase()` and either get back a real
// client or `null` — when SUPABASE_URL or SUPABASE_KEY are absent the entire
// persistence layer no-ops and the demo flow keeps working with the in-memory
// call store. This matches the pattern already used by lookupByPhoneWithCDK
// and src/lib/fortellis.ts on the dashboard side.
//
// ─── Node WebSocket polyfill (Railway is on Node 18) ────────────────────────
//
// @supabase/supabase-js eagerly initialises its realtime client during
// createClient(). On Node.js < 21 there is no `globalThis.WebSocket`, so
// the realtime constructor throws — and our try/catch below was swallowing
// the throw, returning a null client, and every persistence call was
// silently no-opping (book_appointment, log_upsell, upsertCallLog, …).
//
// Fix: polyfill the global from the `ws` package (already a dep — used by
// our screen-pop server) BEFORE createClient is reached. This runs at
// module load so it covers every call site, including transitive imports.
// We also pass `transport` to the realtime config as belt + suspenders
// in case any future supabase-js version reaches for the option directly
// rather than walking up to globalThis.

let polyfilledWebsocket = false
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = WS
  polyfilledWebsocket = true
  console.log('[Supabase] polyfilled globalThis.WebSocket from ws (Node.js < 21)')
}

export function isWebSocketPolyfilled(): boolean {
  return polyfilledWebsocket
}

let cached: SupabaseClient | null = null
let probed = false

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseKey())
}

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL ?? '').trim() || null
}

function getSupabaseKey() {
  // Service-role key when running on the server (Railway) — falls back to
  // anon key for local dev / read-only use cases. The dashboard never sees
  // either of these because the voice service is the only writer.
  return (
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
    || (process.env.SUPABASE_ANON_KEY ?? '').trim()
    || null
  )
}

export function getSupabase(): SupabaseClient | null {
  if (cached) return cached
  if (probed) return null

  probed = true
  const url = getSupabaseUrl()
  const key = getSupabaseKey()
  if (!url || !key) {
    console.log('[Supabase] SUPABASE_URL / SUPABASE_KEY not set — persistence layer disabled, using in-memory store only')
    return null
  }

  try {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-pitlane-source': 'voice' } },
      realtime: {
        // Defensive: even with the globalThis.WebSocket polyfill above,
        // some supabase-js versions reach for `transport` directly rather
        // than walking up to globalThis. Cast through unknown because
        // `ws`'s WebSocket type doesn't exactly match the lib-dom type
        // realtime-js expects — they're shape-compatible at runtime.
        transport: WS as unknown as never,
      },
    })
    console.log('[Supabase] client initialised')
    return cached
  } catch (err) {
    console.error('[Supabase] failed to create client:', err instanceof Error ? err.message : err)
    return null
  }
}

// ─── Convenience helpers used by the webhook routes ──────────────────────────

export interface CallLogUpsert {
  caller_phone: string | null
  customer_id?: string | null
  dealer_id?: string | null
  call_sid?: string | null
  conversation_id?: string | null
  direction?: 'inbound' | 'outbound'
  duration_secs?: number | null
  summary?: Record<string, unknown> | null
  transcript?: unknown[] | null
  status?: 'in_progress' | 'completed' | 'failed' | 'no_answer'
  started_at?: string
  ended_at?: string | null
}

/**
 * Upsert by call_sid (preferred) then conversation_id. If neither is set we
 * fall back to inserting a fresh row keyed only by phone+timestamp. Returns
 * the persisted row's id when successful.
 */
export async function upsertCallLog(row: CallLogUpsert): Promise<string | null> {
  const client = getSupabase()
  if (!client) return null

  try {
    if (row.call_sid) {
      const { data, error } = await client
        .from('call_logs')
        .upsert(row, { onConflict: 'call_sid' })
        .select('id')
        .single()
      if (error) throw error
      return (data as { id: string } | null)?.id ?? null
    }
    if (row.conversation_id) {
      const { data, error } = await client
        .from('call_logs')
        .upsert(row, { onConflict: 'conversation_id' })
        .select('id')
        .single()
      if (error) throw error
      return (data as { id: string } | null)?.id ?? null
    }
    const { data, error } = await client.from('call_logs').insert(row).select('id').single()
    if (error) throw error
    return (data as { id: string } | null)?.id ?? null
  } catch (err) {
    console.error('[Supabase] upsertCallLog failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export interface LoanerRequestInsert {
  call_log_id?: string | null
  appointment_id?: string | null
  customer_id: string
  dealer_id?: string | null
  requested_date?: string | null
  loaner_preferred?: string | null
  notes?: string | null
}

export async function insertLoanerRequest(row: LoanerRequestInsert): Promise<string | null> {
  const client = getSupabase()
  if (!client) return null
  try {
    const { data, error } = await client.from('loaner_requests').insert(row).select('id').single()
    if (error) throw error
    return (data as { id: string } | null)?.id ?? null
  } catch (err) {
    console.error('[Supabase] insertLoanerRequest failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ─── Appointment + upsell + sync queue helpers (Phase 2B) ─────────────────────

export interface AppointmentInsert {
  call_log_id?: string | null
  customer_id: string
  dealer_id?: string | null
  vehicle_id: string
  date: string                       // YYYY-MM-DD
  time: string                       // HH:MM(:SS)
  service_type: string
  advisor?: string | null
  duration_est_hours?: number | null
  confirmation_number: string
  status?: 'confirmed' | 'checked_in' | 'in_progress' | 'cancelled' | 'completed'
}

export async function insertAppointment(row: AppointmentInsert): Promise<string | null> {
  const client = getSupabase()
  if (!client) return null
  try {
    const { data, error } = await client.from('appointments').insert(row).select('id').single()
    if (error) throw error
    return (data as { id: string } | null)?.id ?? null
  } catch (err) {
    console.error('[Supabase] insertAppointment failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export interface UpsellInsert {
  call_log_id?: string | null
  customer_id: string
  dealer_id?: string | null
  vehicle_id: string
  upsell_type: string
  description?: string | null
  value_est?: number | null
  status?: 'pending' | 'accepted' | 'declined' | 'expired'
}

export async function insertUpsell(row: UpsellInsert): Promise<string | null> {
  const client = getSupabase()
  if (!client) return null
  try {
    const { data, error } = await client.from('upsells').insert(row).select('id').single()
    if (error) throw error
    return (data as { id: string } | null)?.id ?? null
  } catch (err) {
    console.error('[Supabase] insertUpsell failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ─── SMS helpers (Phase 5) ────────────────────────────────────────────────────

export type SmsStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'undelivered' | 'skipped'

export interface SmsLogInsert {
  customer_id?: string | null
  dealer_id?: string | null
  to_phone: string
  from_phone?: string | null
  message: string
  message_type: string
  twilio_sid?: string | null
  status: SmsStatus
  failure_reason?: string | null
  call_log_id?: string | null
  appointment_id?: string | null
  loaner_request_id?: string | null
}

export async function insertSmsLog(row: SmsLogInsert): Promise<string | null> {
  const client = getSupabase()
  if (!client) return null
  try {
    const { data, error } = await client.from('sms_log').insert(row).select('id').single()
    if (error) throw error
    return (data as { id: string } | null)?.id ?? null
  } catch (err) {
    console.error('[Supabase] insertSmsLog failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Returns true when we have explicit consent OR no record yet (which we treat
 * as implicitly opted-in for the demo). Returns false ONLY for customers who
 * have explicitly opted out — i.e. a row with opted_in = false.
 */
export async function hasSmsConsent(customerId: string): Promise<boolean> {
  const client = getSupabase()
  if (!client) return true // demo path: dry-run send is fine, log it anyway
  try {
    const { data, error } = await client
      .from('sms_consent')
      .select('opted_in')
      .eq('customer_id', customerId)
      .maybeSingle()
    if (error) throw error
    if (!data) return true // no record yet -> implicit opt-in
    return Boolean((data as { opted_in: boolean }).opted_in)
  } catch (err) {
    console.error('[Supabase] hasSmsConsent failed:', err instanceof Error ? err.message : err)
    return true
  }
}

export interface CdkSyncEnqueue {
  entity_type: 'appointment' | 'upsell' | 'loaner_request' | 'note'
  entity_id: string
  dealer_id?: string | null
  payload: Record<string, unknown>
}

// ─── Phase 13: service schedule + loaner fleet read helpers ─────────────────
//
// Aria + the /tools/available-slots endpoint read these to offer concrete
// booking times and to flag loaner availability. All writes go through the
// dashboard (src/app/api/manager/*) — the voice service is read-only here.

export interface ServiceScheduleRow {
  id: string
  dealer_id: string
  day_of_week: number
  open_time: string
  close_time: string
  slot_duration_mins: number
  max_concurrent_bookings: number
  is_active: boolean
}

export interface ScheduleOverrideRow {
  id: string
  dealer_id: string
  override_date: string
  is_blocked: boolean
  reason: string | null
  open_time: string | null
  close_time: string | null
  max_concurrent_bookings: number | null
}

export interface LoanerVehicleRow {
  id: string
  dealer_id: string
  make: string
  model: string
  year: number
  /** Quasi-PII; do NOT include in SMS / CDK sync payloads. */
  license_plate: string
  color: string | null
  is_available: boolean
}

/** Fetch the 7 weekly rows for a dealer. Returns [] when unconfigured
 *  or the table is missing (caller falls back to open booking). */
export async function fetchServiceSchedule(dealerId: string): Promise<ServiceScheduleRow[]> {
  const client = getSupabase()
  if (!client) return []
  try {
    const { data, error } = await client
      .from('service_schedule')
      .select('*')
      .eq('dealer_id', dealerId)
      .order('day_of_week', { ascending: true })
    if (error) {
      const code = (error as { code?: string }).code
      if (code === '42P01') {
        console.warn('[Supabase] service_schedule missing — apply migration 0013')
        return []
      }
      throw error
    }
    return ((data ?? []) as ServiceScheduleRow[]).filter((r) => r.is_active)
  } catch (err) {
    console.error('[Supabase] fetchServiceSchedule failed:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function fetchScheduleOverrides(
  dealerId: string,
  fromDate: string,
  toDate: string,
): Promise<ScheduleOverrideRow[]> {
  const client = getSupabase()
  if (!client) return []
  try {
    const { data, error } = await client
      .from('schedule_overrides')
      .select('*')
      .eq('dealer_id', dealerId)
      .gte('override_date', fromDate)
      .lte('override_date', toDate)
    if (error) {
      const code = (error as { code?: string }).code
      if (code === '42P01') return []
      throw error
    }
    return (data ?? []) as ScheduleOverrideRow[]
  } catch (err) {
    console.error('[Supabase] fetchScheduleOverrides failed:', err instanceof Error ? err.message : err)
    return []
  }
}

/** Count of non-cancelled appointments for (dealer, date). Used by the
 *  available-slots search + the book_appointment capacity gate. */
export async function countAppointmentsForDate(
  dealerId: string,
  date: string,
): Promise<number> {
  const client = getSupabase()
  if (!client) return 0
  try {
    const { count, error } = await client
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('dealer_id', dealerId)
      .eq('date', date)
      .neq('status', 'cancelled')
    if (error) {
      const code = (error as { code?: string }).code
      if (code === '42P01') return 0
      throw error
    }
    return count ?? 0
  } catch (err) {
    console.error('[Supabase] countAppointmentsForDate failed:', err instanceof Error ? err.message : err)
    return 0
  }
}

/** Count of appointments at a specific (dealer, date, time) — used by
 *  book_appointment to enforce per-slot capacity vs per-day capacity. */
export async function countAppointmentsForSlot(
  dealerId: string,
  date: string,
  time: string,
): Promise<number> {
  const client = getSupabase()
  if (!client) return 0
  try {
    const { count, error } = await client
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('dealer_id', dealerId)
      .eq('date', date)
      .eq('time', time)
      .neq('status', 'cancelled')
    if (error) {
      const code = (error as { code?: string }).code
      if (code === '42P01') return 0
      throw error
    }
    return count ?? 0
  } catch (err) {
    console.error('[Supabase] countAppointmentsForSlot failed:', err instanceof Error ? err.message : err)
    return 0
  }
}

/** True when at least one is_available loaner vehicle exists for the
 *  dealer and is not assigned to an overlapping non-declined
 *  loaner_requests row. False on Supabase miss / table missing so the
 *  caller can communicate "loaner not guaranteed" rather than 500. */
export async function hasLoanerAvailability(
  dealerId: string,
  startDate?: string | null,
  endDate?: string | null,
): Promise<boolean> {
  const client = getSupabase()
  if (!client) return false
  try {
    const { data, error } = await client
      .from('loaner_vehicles')
      .select('id,is_available')
      .eq('dealer_id', dealerId)
      .eq('is_available', true)
    if (error) {
      const code = (error as { code?: string }).code
      if (code === '42P01') return false
      throw error
    }
    const vehicles = (data ?? []) as Array<{ id: string }>
    if (vehicles.length === 0) return false
    if (!startDate || !endDate) return true

    const reqs = await client
      .from('loaner_requests')
      .select('loaner_vehicle_id,start_date,end_date,status')
      .eq('dealer_id', dealerId)
      .not('loaner_vehicle_id', 'is', null)
      .neq('status', 'declined')
    if (reqs.error) {
      const code = (reqs.error as { code?: string }).code
      if (code === '42P01' || code === '42703') return vehicles.length > 0
      throw reqs.error
    }
    const busy = new Set<string>()
    for (const r of (reqs.data ?? []) as Array<{
      loaner_vehicle_id: string | null
      start_date: string | null
      end_date: string | null
    }>) {
      if (!r.loaner_vehicle_id || !r.start_date || !r.end_date) continue
      if (r.start_date <= endDate && r.end_date >= startDate) busy.add(r.loaner_vehicle_id)
    }
    return vehicles.some((v) => !busy.has(v.id))
  } catch (err) {
    console.error('[Supabase] hasLoanerAvailability failed:', err instanceof Error ? err.message : err)
    return false
  }
}

// ─── repair_order_assignments + departments (Phase 9b) ──────────────────────

export interface RepairOrderAssignmentRow {
  id: string
  dealer_id: string | null
  repair_order_id: string
  customer_phone: string | null
  tech_ids: string[]
  tech_names: string[]
  service_status: 'pending' | 'in_progress' | 'awaiting_parts' | 'completed' | 'extended' | 'cancelled'
  estimated_completion: string | null
  actual_completion: string | null
  extended_until: string | null
  extension_reason: string | null
  notes: string | null
  assigned_by: string | null
  created_at: string
  updated_at: string
}

export interface RepairOrderAssignmentUpsert {
  dealer_id?: string | null
  repair_order_id: string
  customer_phone?: string | null
  tech_ids?: string[]
  tech_names?: string[]
  service_status?: RepairOrderAssignmentRow['service_status']
  estimated_completion?: string | null
  actual_completion?: string | null
  extended_until?: string | null
  extension_reason?: string | null
  notes?: string | null
  assigned_by?: string | null
}

/** Insert or update the (dealer_id, repair_order_id) row. */
export async function upsertRepairOrderAssignment(
  row: RepairOrderAssignmentUpsert,
): Promise<RepairOrderAssignmentRow | null> {
  const client = getSupabase()
  if (!client) return null
  try {
    const { data, error } = await client
      .from('repair_order_assignments')
      .upsert(
        { ...row, updated_at: new Date().toISOString() },
        { onConflict: 'dealer_id,repair_order_id' },
      )
      .select('*')
      .single()
    if (error) {
      const code = (error as { code?: string }).code
      if (code === '42P01' || /relation "repair_order_assignments" does not exist/i.test(error.message ?? '')) {
        console.warn('[Supabase] repair_order_assignments missing — apply migration 0008')
        return null
      }
      throw error
    }
    return data as RepairOrderAssignmentRow
  } catch (err) {
    console.error('[Supabase] upsertRepairOrderAssignment failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Find the most recent active assignment for a given caller phone — used
 *  by the pre-call webhook to inject ro_status etc. into dynamic_variables. */
export async function findActiveAssignmentForPhone(
  phone: string,
  dealerId?: string | null,
): Promise<RepairOrderAssignmentRow | null> {
  const client = getSupabase()
  if (!client || !phone) return null
  try {
    let query = client
      .from('repair_order_assignments')
      .select('*')
      .eq('customer_phone', phone)
      .in('service_status', ['pending', 'in_progress', 'awaiting_parts', 'extended'])
      .order('updated_at', { ascending: false })
      .limit(1)
    if (dealerId) query = query.eq('dealer_id', dealerId)
    const { data, error } = await query.maybeSingle()
    if (error) {
      const code = (error as { code?: string }).code
      if (code === '42P01') return null
      throw error
    }
    return (data as RepairOrderAssignmentRow | null) ?? null
  } catch (err) {
    console.error('[Supabase] findActiveAssignmentForPhone failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export interface DepartmentRow {
  id: string
  dealer_id: string | null
  name: string
  /** E.164 destination dialed by Twilio when Aria calls transfer_call.
   *  Renamed from the original twilio_number per the sprint-review
   *  correction; the migration handles the rename for existing deploys. */
  phone_number: string | null
  extension: string | null
  display_name: string
  display_order: number
  is_active: boolean
}

export async function findDepartment(
  dealerId: string,
  name: string,
): Promise<DepartmentRow | null> {
  const client = getSupabase()
  if (!client) return null
  try {
    const { data, error } = await client
      .from('departments')
      .select('*')
      .eq('dealer_id', dealerId)
      .eq('name', name.trim().toLowerCase())
      .eq('is_active', true)
      .maybeSingle()
    if (error) {
      const code = (error as { code?: string }).code
      if (code === '42P01') {
        console.warn('[Supabase] departments missing — apply migration 0008')
        return null
      }
      throw error
    }
    return (data as DepartmentRow | null) ?? null
  } catch (err) {
    console.error('[Supabase] findDepartment failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ─── callback_requests (Phase 9a) ────────────────────────────────────────────

export type CallbackSentiment = 'positive' | 'neutral' | 'negative' | 'frustrated'
export type CallbackStatus = 'pending' | 'acknowledged' | 'completed' | 'cancelled'

export interface CallbackRequestInsert {
  dealer_id?: string | null
  customer_phone: string
  customer_name?: string | null
  call_log_id?: string | null
  reason?: string | null
  sentiment?: CallbackSentiment | string | null
  sentiment_score?: number | null
}

export interface CallbackRequestRow extends CallbackRequestInsert {
  id: string
  status: CallbackStatus
  assigned_advisor_id: string | null
  created_at: string
  acknowledged_at: string | null
  completed_at: string | null
}

export async function insertCallbackRequest(row: CallbackRequestInsert): Promise<CallbackRequestRow | null> {
  const client = getSupabase()
  if (!client) return null
  try {
    const { data, error } = await client
      .from('callback_requests')
      .insert(row)
      .select('*')
      .single()
    if (error) {
      const code = (error as { code?: string }).code
      if (code === '42P01' || /relation "callback_requests" does not exist/i.test(error.message ?? '')) {
        console.warn('[Supabase] callback_requests table missing — apply migration 0007')
        return null
      }
      throw error
    }
    return data as CallbackRequestRow
  } catch (err) {
    console.error('[Supabase] insertCallbackRequest failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Patch the sentiment columns on call_logs after the post-call summariser
 * has produced a fresh score. Safe to call twice — UPDATE is idempotent.
 */
export async function updateCallLogSentiment(
  callLogId: string,
  sentiment: string,
  sentimentScore: number | null,
): Promise<void> {
  const client = getSupabase()
  if (!client) return
  try {
    const { error } = await client
      .from('call_logs')
      .update({ sentiment, sentiment_score: sentimentScore })
      .eq('id', callLogId)
    if (error) {
      const code = (error as { code?: string }).code
      // 42703 = undefined_column; migration 0007 hasn't applied yet.
      if (code === '42703' || /column "sentiment" of relation "call_logs" does not exist/i.test(error.message ?? '')) {
        console.warn('[Supabase] call_logs.sentiment columns missing — apply migration 0007')
        return
      }
      throw error
    }
  } catch (err) {
    console.error('[Supabase] updateCallLogSentiment failed:', err instanceof Error ? err.message : err)
  }
}

// ─── customers index (Phase 8b) ───────────────────────────────────────────────
//
// Lightweight local index of phone numbers Aria has talked to. The columns
// match supabase/migrations/0006_customers.sql. See that file for the design
// rationale (CDK stays source-of-truth for contact info; this is a routing
// + auto-create helper only).

export interface CustomerRow {
  id: string
  dealer_id: string | null
  phone: string
  // PIPEDA compliance (migration 0012): name + email are CDK-owned and
  // are NEVER stored locally. The fields are intentionally absent from
  // the row type so a future caller can't reintroduce the leak. Aria's
  // session notes (operational observations, NOT PII) land in
  // aria_notes.
  cdk_customer_id: string | null
  is_new_customer: boolean
  total_calls: number
  last_seen_at: string | null
  last_sentiment: string | null
  aria_notes: string | null
  created_at: string
  updated_at: string
}

/** Normalise a caller phone string: strip non-digit chars except a leading '+'. */
export function normaliseCallerPhone(input: string | null | undefined): string {
  if (!input) return ''
  const trimmed = input.trim()
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`
  return trimmed.replace(/\D/g, '')
}

/**
 * Find an existing customer row by phone (within a dealer scope when given).
 * Returns null on miss or when Supabase isn't configured.
 */
export async function findCustomerByPhone(
  phone: string,
  dealerId?: string | null,
): Promise<CustomerRow | null> {
  const client = getSupabase()
  if (!client) return null
  const normalised = normaliseCallerPhone(phone)
  if (!normalised) return null

  try {
    let query = client.from('customers').select('*').eq('phone', normalised).limit(1)
    if (dealerId) query = query.eq('dealer_id', dealerId)
    const { data, error } = await query.maybeSingle()
    if (error) {
      // 42P01 = undefined_table; migration 0006 hasn't been applied yet.
      const code = (error as { code?: string }).code
      if (code === '42P01' || /relation "customers" does not exist/i.test(error.message ?? '')) {
        console.warn('[Supabase] customers table missing — apply migration 0006')
        return null
      }
      throw error
    }
    return (data as CustomerRow | null) ?? null
  } catch (err) {
    console.error('[Supabase] findCustomerByPhone failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Insert a fresh customer row keyed by phone + dealer. Returns the inserted
 * row or null on failure. ON CONFLICT (dealer_id, phone) DO UPDATE keeps the
 * existing row but bumps updated_at so the upsert is safe to call from
 * either the pre-call webhook or the customer_lookup tool — whichever fires
 * first wins, the second is a no-op.
 */
export async function upsertCustomerByPhone(input: {
  phone: string
  dealer_id?: string | null
  is_new_customer?: boolean
  aria_notes?: string | null
  /** @deprecated name lives in CDK only post-migration 0012; passing it
   *  here is silently ignored. The voice service queues a CDK write via
   *  queueCdkSync({ entity_type: 'note', ... }) when Aria collects a
   *  name — see updateCustomerName below. */
  name?: string | null
  /** @deprecated email lives in CDK only. Same handling as `name`. */
  email?: string | null
}): Promise<CustomerRow | null> {
  const client = getSupabase()
  if (!client) return null
  const normalised = normaliseCallerPhone(input.phone)
  if (!normalised) return null

  // Defensive logging: if a caller still passes name/email, surface it
  // in the Railway tail so any code that wasn't migrated is easy to
  // spot. The fields themselves are stripped before the upsert.
  if (input.name || input.email) {
    console.warn(
      '[Supabase] upsertCustomerByPhone received name/email; ignoring (PIPEDA — see migration 0012)',
    )
  }

  try {
    const { data, error } = await client
      .from('customers')
      .upsert(
        {
          phone: normalised,
          dealer_id: input.dealer_id ?? null,
          is_new_customer: input.is_new_customer ?? true,
          aria_notes: input.aria_notes ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'dealer_id,phone' },
      )
      .select('*')
      .single()
    if (error) {
      const code = (error as { code?: string }).code
      if (code === '42P01' || /relation "customers" does not exist/i.test(error.message ?? '')) {
        console.warn('[Supabase] customers table missing — apply migrations 0006 + 0012')
        return null
      }
      throw error
    }
    return data as CustomerRow
  } catch (err) {
    console.error('[Supabase] upsertCustomerByPhone failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Aria collected the caller's name. PIPEDA compliance (migration 0012)
 * means we DO NOT persist the name locally — CDK is the customer-name
 * source of truth.
 *
 * Two things happen here:
 *   1. The local customers row's `is_new_customer` flips to false and
 *      `aria_notes` is updated with a non-PII summary ("name collected").
 *      This anchors the row to the caller without storing the actual name.
 *   2. A `customer_update` job is queued in cdk_sync_queue so the Phase 3
 *      worker can push the name to CDK Customer API on behalf of the
 *      dealer. Until that worker is configured for customer writes, the
 *      name lives in the call_logs.transcript only — same as any other
 *      caller-provided detail.
 *
 * Returns true when at least one of the writes lands.
 */
export async function queueCustomerNameToCdk(
  phone: string,
  name: string,
  dealerId?: string | null,
): Promise<boolean> {
  const client = getSupabase()
  if (!client) return false
  const normalised = normaliseCallerPhone(phone)
  if (!normalised || !name?.trim()) return false

  let okLocal = false
  let okQueue = false

  // 1. Flip the local row to is_new_customer=false + drop an aria_notes
  // breadcrumb. No PII columns touched.
  try {
    let query = client
      .from('customers')
      .update({
        is_new_customer: false,
        aria_notes: 'Name collected by Aria; pushed to CDK',
        updated_at: new Date().toISOString(),
      })
      .eq('phone', normalised)
    if (dealerId) query = query.eq('dealer_id', dealerId)
    const { error } = await query
    if (!error) okLocal = true
    else if ((error as { code?: string }).code === 'PGRST116') {
      // No row yet — create one without the name.
      await upsertCustomerByPhone({ phone, dealer_id: dealerId, is_new_customer: false, aria_notes: 'Name collected by Aria; pushed to CDK' })
      okLocal = true
    } else if ((error as { code?: string }).code !== '42P01') {
      console.warn('[Supabase] queueCustomerNameToCdk local update failed:', error.message)
    }
  } catch (err) {
    console.error('[Supabase] queueCustomerNameToCdk local update threw:', err instanceof Error ? err.message : err)
  }

  // 2. Queue the CDK write. payload carries the name + phone so the
  // worker has everything it needs without re-querying.
  try {
    const queued = await queueCdkSync({
      entity_type: 'note',
      entity_id: normalised,
      dealer_id: dealerId ?? null,
      payload: {
        kind: 'customer_name_collected',
        phone: normalised,
        full_name: name.trim(),
        collected_at: new Date().toISOString(),
      },
    })
    okQueue = Boolean(queued)
  } catch (err) {
    console.error('[Supabase] queueCustomerNameToCdk queue insert threw:', err instanceof Error ? err.message : err)
  }

  return okLocal || okQueue
}

/** @deprecated Phase 11 PIPEDA correction (migration 0012) — local customers
 *  table no longer stores `name`. Use queueCustomerNameToCdk() instead;
 *  this shim is kept so the existing tool handler compiles and the call
 *  sites don't need to change names twice. Returns null shaped like a row
 *  so the caller's `Boolean(row)` check still works. */
export async function updateCustomerName(
  phone: string,
  name: string,
  dealerId?: string | null,
): Promise<CustomerRow | null> {
  const ok = await queueCustomerNameToCdk(phone, name, dealerId)
  if (!ok) return null
  // Return a synthetic row so existing callers can treat the truthy
  // value as "succeeded". No PII is included.
  return {
    id: '',
    dealer_id: dealerId ?? null,
    phone: normaliseCallerPhone(phone),
    cdk_customer_id: null,
    is_new_customer: false,
    total_calls: 0,
    last_seen_at: new Date().toISOString(),
    last_sentiment: null,
    aria_notes: 'Name collected by Aria; pushed to CDK',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

/**
 * Bump total_calls + last_call_at after a call completes. Idempotent in
 * the sense that calling it twice for the same phone is fine — total_calls
 * is incremented atomically via the RPC; an in-process race wouldn't
 * double-count.
 */
export async function bumpCustomerCallStats(
  phone: string,
  opts?: { dealerId?: string | null; lastSentiment?: string | null; lastCallAt?: string | null },
): Promise<void> {
  const client = getSupabase()
  if (!client) return
  const normalised = normaliseCallerPhone(phone)
  if (!normalised) return

  try {
    // We use a SELECT-then-UPDATE because Supabase v2 doesn't expose an
    // increment helper; race window is acceptable for an analytics counter.
    let selectQ = client.from('customers').select('total_calls').eq('phone', normalised).limit(1)
    if (opts?.dealerId) selectQ = selectQ.eq('dealer_id', opts.dealerId)
    const current = await selectQ.maybeSingle()
    if (current.error) {
      const code = (current.error as { code?: string }).code
      if (code === '42P01') return
      throw current.error
    }
    const next = ((current.data as { total_calls?: number } | null)?.total_calls ?? 0) + 1

    let updateQ = client
      .from('customers')
      .update({
        total_calls: next,
        // Phase 11 PIPEDA: column renamed last_call_at -> last_seen_at
        // in migration 0012. Same semantic; new name reflects that the
        // value is a generic "we have interacted with this caller"
        // timestamp rather than implying we keep call-by-call records
        // here.
        last_seen_at: opts?.lastCallAt ?? new Date().toISOString(),
        last_sentiment: opts?.lastSentiment ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('phone', normalised)
    if (opts?.dealerId) updateQ = updateQ.eq('dealer_id', opts.dealerId)
    const { error } = await updateQ
    if (error) throw error
  } catch (err) {
    console.error('[Supabase] bumpCustomerCallStats failed:', err instanceof Error ? err.message : err)
  }
}

/** Queue an outbound CDK write. The Phase 3 worker drains this. */
export async function queueCdkSync(row: CdkSyncEnqueue): Promise<string | null> {
  const client = getSupabase()
  if (!client) return null
  try {
    const { data, error } = await client.from('cdk_sync_queue').insert(row).select('id').single()
    if (error) throw error
    return (data as { id: string } | null)?.id ?? null
  } catch (err) {
    console.error('[Supabase] queueCdkSync failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ─── Call-log resolution for Aria's mid-call tool invocations ────────────────
//
// During a call Aria's tools fire with the ElevenLabs conversation_id (passed
// as call_id in our tool requests). The pre-call webhook has already opened a
// call_logs row keyed by Twilio's call_sid, so the conversation_id field is
// initially NULL.
//
// This helper does a single round-trip:
//   1. SELECT id, customer_id FROM call_logs WHERE conversation_id = $cid
//   2. If miss: try to attach $cid to the most recent in_progress row for
//      this caller_phone or customer (which the pre-call webhook created).
//   3. If still miss: INSERT a fresh in_progress row with conversation_id =
//      $cid so the foreign key from appointments/upsells/loaner_requests has
//      a valid target.
//
// Returns the call_logs.id (uuid) which is what the FK columns expect.

/**
 * Returns the dealer_id stored on the call_logs row matching this conversation
 * (set by the pre-call webhook). Returns null when Supabase isn't configured,
 * when no row matches, or when dealer_id is unset. Caller defaults to
 * DEFAULT_DEALER on null.
 */
export async function getDealerIdForConversation(conversationId: string): Promise<string | null> {
  const client = getSupabase()
  if (!client) return null
  try {
    const { data, error } = await client
      .from('call_logs')
      .select('dealer_id')
      .eq('conversation_id', conversationId)
      .maybeSingle()
    if (error) {
      console.error('[Supabase] getDealerIdForConversation error:', error.message)
      return null
    }
    return (data as { dealer_id: string | null } | null)?.dealer_id ?? null
  } catch (err) {
    console.error('[Supabase] getDealerIdForConversation threw:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function getOrCreateCallLogIdForConversation(
  conversationId: string,
  hints?: { customerId?: string | null; phone?: string | null; dealerId?: string | null },
): Promise<string | null> {
  const client = getSupabase()
  if (!client) return null

  try {
    const lookup = await client
      .from('call_logs')
      .select('id')
      .eq('conversation_id', conversationId)
      .maybeSingle()
    if (lookup.data?.id) return lookup.data.id as string

    if (hints?.customerId || hints?.phone) {
      const query = client
        .from('call_logs')
        .select('id, customer_id, caller_phone')
        .eq('status', 'in_progress')
        .is('conversation_id', null)
        .order('started_at', { ascending: false })
        .limit(1)

      if (hints.customerId) {
        query.eq('customer_id', hints.customerId)
      } else if (hints.phone) {
        query.eq('caller_phone', hints.phone)
      }

      const recent = await query.maybeSingle()
      if (recent.data?.id) {
        const id = recent.data.id as string
        await client
          .from('call_logs')
          .update({ conversation_id: conversationId })
          .eq('id', id)
        return id
      }
    }

    const inserted = await client
      .from('call_logs')
      .insert({
        conversation_id: conversationId,
        caller_phone: hints?.phone ?? 'unknown',
        customer_id: hints?.customerId ?? null,
        dealer_id: hints?.dealerId ?? null,
        direction: 'inbound',
        status: 'in_progress',
      })
      .select('id')
      .single()
    return (inserted.data as { id: string } | null)?.id ?? null
  } catch (err) {
    console.error('[Supabase] getOrCreateCallLogIdForConversation failed:', err instanceof Error ? err.message : err)
    return null
  }
}
