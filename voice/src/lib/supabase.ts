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
  caller_phone: string
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
  status?: 'confirmed' | 'scheduled' | 'cancelled' | 'completed'
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
  entity_type: 'appointment' | 'upsell' | 'loaner_request' | 'note' | 'vehicle_update'
  entity_id: string
  dealer_id?: string | null
  payload: Record<string, unknown>
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
