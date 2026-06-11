import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { config } from '../config'
import { lookupByPhoneWithCDK, lookupById } from '../mock/customers'
import { checkOverride } from '../mock/sessionOverrides'
import { broadcastScreenPop } from '../ws/screenPop'
import { startInboundCall } from '../store/callStore'
import { Customer } from '../types'
import { upsertCallLog, isSupabaseConfigured } from '../lib/supabase'
import { processPostCall, normaliseStatus } from '../lib/postCallProcessor'
import type { TranscriptTurn } from '../lib/summarizer'
import { getDealerByPhone, type Dealer } from '../lib/dealer'

const router = Router()

// ─── HMAC signature verification ─────────────────────────────────────────────
//
// ElevenLabs signs webhook requests with an "ElevenLabs-Signature" header in
// Stripe-style format:
//
//   ElevenLabs-Signature: t=<unix_seconds>,v0=<hex_hmac_sha256>
//
// The signature is HMAC-SHA256 over `<timestamp>.<raw_body>` keyed by the
// shared secret. We only enforce this when ELEVENLABS_WEBHOOK_SECRET is set,
// which keeps local dev / demo paths frictionless while still letting prod
// deployments lock it down.

const SIGNATURE_HEADER = 'elevenlabs-signature'
const MAX_AGE_SECONDS = 30 * 60 // reject signatures older than 30 minutes

interface RawBodyRequest extends Request {
  rawBody?: Buffer
}

function constantTimeEquals(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'hex')
    const bufB = Buffer.from(b, 'hex')
    if (bufA.length !== bufB.length) return false
    return crypto.timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

function verifyElevenLabsSignature(req: RawBodyRequest): { ok: true } | { ok: false; reason: string } {
  if (!config.elevenLabsWebhookSecret) return { ok: true }

  const headerValue = req.header(SIGNATURE_HEADER)
  if (!headerValue) return { ok: false, reason: 'missing ElevenLabs-Signature header' }

  const parts = Object.fromEntries(
    headerValue.split(',').map((segment) => {
      const [key, ...rest] = segment.trim().split('=')
      return [key, rest.join('=')]
    }),
  )
  const timestamp = parts.t
  const signature = parts.v0

  if (!timestamp || !signature) return { ok: false, reason: 'malformed signature header' }

  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) return { ok: false, reason: 'invalid timestamp' }
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > MAX_AGE_SECONDS) {
    return { ok: false, reason: 'signature timestamp out of range' }
  }

  const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))
  const payload = `${timestamp}.${rawBody.toString('utf8')}`
  const expected = crypto
    .createHmac('sha256', config.elevenLabsWebhookSecret)
    .update(payload)
    .digest('hex')

  return constantTimeEquals(signature, expected) ? { ok: true } : { ok: false, reason: 'signature mismatch' }
}

// ─── Pre-call webhook handler ────────────────────────────────────────────────
//
// ElevenLabs hits this URL during the Twilio ring/dial phase, BEFORE the audio
// connection is established. We have a few seconds to look the caller up and
// return `conversation_initiation_client_data` so Aria starts the conversation
// with the customer's name and vehicle context already in scope (no
// "may I confirm who I'm speaking with?" awkwardness).
//
// While we're at it we also:
//   1. Broadcast an INCOMING_CALL event over the WebSocket so the PitLane
//      advisor dashboard auto-loads the customer profile during the ring.
//   2. Record the call in the in-memory call store keyed by Twilio's call_sid,
//      so the call shows up in the Aria phone log immediately.

interface PreCallRequestBody {
  caller_id?: string
  agent_id?: string
  called_number?: string
  call_sid?: string
}

interface ConversationInitiationResponse {
  type: 'conversation_initiation_client_data'
  dynamic_variables: Record<string, string>
}

function formatVehicle(customer: Customer): string {
  const primary = customer.vehicles[0]
  if (!primary) return 'your vehicle'
  return [primary.year, 'Porsche', primary.model, primary.trim].filter(Boolean).join(' ').trim()
}

function formatVehiclesSummary(customer: Customer): string {
  if (customer.vehicles.length === 0) return ''
  return customer.vehicles
    .map((v) => [v.year, 'Porsche', v.model, v.trim].filter(Boolean).join(' '))
    .join(' and ')
}

function formatUpcomingAppointment(customer: Customer): string {
  const appt = customer.upcomingAppointments[0]
  if (!appt) return 'None scheduled'
  const pieces = [appt.date, appt.time && `at ${appt.time}`, appt.serviceType && `— ${appt.serviceType}`]
    .filter(Boolean)
    .join(' ')
  return pieces || 'Upcoming appointment on file'
}

function formatOpenRepairOrder(customer: Customer): string {
  const ro = customer.openRepairOrders[0]
  if (!ro) return ''
  const eta = ro.estimatedCompletion ? `, ETA ${ro.estimatedCompletion}` : ''
  return `${ro.description} (status: ${ro.status.replace(/_/g, ' ')}${eta})`
}

function formatOpenRecall(customer: Customer): string {
  const recall = customer.openRecalls.find((r) => r.status === 'open')
  if (!recall) return ''
  return `${recall.component}: ${recall.remedy}`
}

function buildKnownCallerVariables(customer: Customer, dealer: Dealer): Record<string, string> {
  return {
    customer_name: `${customer.firstName} ${customer.lastName}`.trim(),
    first_name: customer.firstName,
    last_name: customer.lastName,
    vehicle: formatVehicle(customer),
    vehicles_summary: formatVehiclesSummary(customer),
    tier: customer.loyaltyTier ?? 'Standard',
    upcoming_appointment: formatUpcomingAppointment(customer),
    open_repair_order: formatOpenRepairOrder(customer),
    open_recall: formatOpenRecall(customer),
    advisor_notes: customer.notes ?? '',
    last_visit: customer.lastVisit ?? '',
    preferred_language: customer.preferredLanguage || 'en',
    dealership_name: dealer.name,
    dealership_branch: dealer.location,
    dealership_brand: dealer.brand,
    is_known_caller: 'true',
  }
}

function buildUnknownCallerVariables(phone: string, dealer: Dealer): Record<string, string> {
  return {
    customer_name: 'valued customer',
    first_name: '',
    last_name: '',
    vehicle: 'your vehicle',
    vehicles_summary: '',
    tier: 'Standard',
    upcoming_appointment: 'None scheduled',
    open_repair_order: '',
    open_recall: '',
    advisor_notes: '',
    last_visit: '',
    preferred_language: 'en',
    dealership_name: dealer.name,
    dealership_branch: dealer.location,
    dealership_brand: dealer.brand,
    is_known_caller: 'false',
    caller_phone: phone,
  }
}

router.post('/pre-call', async (req: RawBodyRequest, res: Response): Promise<Response> => {
  const verification = verifyElevenLabsSignature(req)
  if (!verification.ok) {
    console.warn(`[Webhook] pre-call rejected: ${verification.reason}`)
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const body = (req.body ?? {}) as PreCallRequestBody
  const phone = (body.caller_id ?? '').trim()
  const callSid = body.call_sid ?? `precall_${Date.now()}`
  const calledNumber = body.called_number ?? null

  // Multi-tenancy: resolve which dealer this call belongs to from the Twilio
  // number Aria was dialed on. Falls back to DEFAULT_DEALER (matching the
  // legacy Porsche Toronto deploy) when called_number isn't given or no
  // matching row exists.
  const dealer = await getDealerByPhone(calledNumber)

  console.log(
    `[Webhook] pre-call from=${phone || 'unknown'} called=${calledNumber ?? 'n/a'} ` +
    `dealer=${dealer.name} call_sid=${callSid} agent=${body.agent_id ?? 'n/a'}`,
  )

  // The pre-call webhook spec says we have to respond quickly so ElevenLabs
  // can start the audio session. If anything in the lookup/screenpop chain
  // throws we still return a usable conversation_initiation_client_data so
  // Aria can carry on as a "unknown caller" conversation rather than fail
  // the call entirely.
  let customer: Customer | null = null
  try {
    if (phone) {
      const overrideId = checkOverride(phone)
      customer = overrideId ? lookupById(overrideId) : await lookupByPhoneWithCDK(phone)
    }
  } catch (err) {
    console.error('[Webhook] customer lookup failed:', err instanceof Error ? err.message : err)
  }

  try {
    startInboundCall({ callId: callSid, phone: phone || 'unknown', customer })
    broadcastScreenPop({
      type: 'INCOMING_CALL',
      callId: callSid,
      caller: { phone, customer },
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[Webhook] screen-pop / store failed (non-fatal):', err instanceof Error ? err.message : err)
  }

  // Persist an in_progress call_logs row when Supabase is configured. The
  // post-call webhook will upsert by call_sid to close it out later.
  // We don't block the response on this — Supabase round-trip is fired and
  // forgotten because ElevenLabs wants the conversation_initiation_client_data
  // back as fast as possible.
  if (isSupabaseConfigured()) {
    void upsertCallLog({
      call_sid: callSid,
      caller_phone: phone || 'unknown',
      customer_id: customer?.id ?? null,
      dealer_id: dealer.id,
      direction: 'inbound',
      status: 'in_progress',
      started_at: new Date().toISOString(),
    }).catch(() => undefined)
  }

  const response: ConversationInitiationResponse = {
    type: 'conversation_initiation_client_data',
    dynamic_variables: customer
      ? buildKnownCallerVariables(customer, dealer)
      : buildUnknownCallerVariables(phone, dealer),
  }
  return res.json(response)
})

// ─── Post-call webhook handler ───────────────────────────────────────────────
//
// ElevenLabs hits this URL after the call ends with the full transcript,
// duration, and outcome status. We:
//   1. Re-look the customer up by caller_phone (the in-memory call store may
//      have been wiped by a redeploy between pre-call and post-call).
//   2. Pass the transcript through summariseTranscript() — GPT-4o-mini when
//      OPENAI_API_KEY is set, deterministic heuristic otherwise — to get
//      structured JSON: outcome / topics / upsells_flagged / action_items /
//      sentiment / loaner_needed / summary_text.
//   3. Upsert the call_logs row in Supabase (idempotent by call_sid or
//      conversation_id), filling in transcript + summary + duration + status.
//   4. If summary.loaner_needed is true, insert a loaner_requests row so the
//      service desk's loaner queue picks it up.
//   5. Close the in-memory call store record + broadcast CALL_ENDED so the
//      dashboard's IncomingCallPopup is dismissed and CallHistory refreshes.
//
// Returns the parsed summary + persisted call_log_id so callers can chain
// further actions; ElevenLabs itself ignores the body.

interface PostCallTranscriptTurn {
  role?: string
  message?: string
  text?: string
  timestamp?: number
}

interface PostCallRequestBody {
  conversation_id?: string
  call_id?: string
  call_sid?: string
  caller_phone?: string
  called_number?: string
  duration_secs?: number
  duration_seconds?: number
  transcript?: PostCallTranscriptTurn[]
  status?: string
  summary?: string
}

function normaliseTranscript(input: PostCallTranscriptTurn[] | undefined): TranscriptTurn[] {
  if (!Array.isArray(input)) return []
  return input
    .map((turn) => ({
      role: (turn.role ?? 'user') as TranscriptTurn['role'],
      message: typeof turn.message === 'string'
        ? turn.message
        : typeof turn.text === 'string'
        ? turn.text
        : '',
    }))
    .filter((turn) => turn.message.length > 0)
}

router.post('/post-call', async (req: RawBodyRequest, res: Response): Promise<Response> => {
  const verification = verifyElevenLabsSignature(req)
  if (!verification.ok) {
    console.warn(`[Webhook] post-call rejected: ${verification.reason}`)
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const body = (req.body ?? {}) as PostCallRequestBody
  const conversationId = body.conversation_id ?? body.call_id ?? null
  const callSid = body.call_sid ?? null
  const callerPhone = (body.caller_phone ?? '').trim()
  const duration = body.duration_secs ?? body.duration_seconds ?? 0
  const status = normaliseStatus(body.status)
  const transcript = normaliseTranscript(body.transcript)

  // Resolve the dealer the same way the pre-call webhook did so the post-call
  // upsert into call_logs preserves the correct dealer_id. When ElevenLabs
  // doesn't include called_number on post-call payloads, the pre-call row's
  // dealer_id will already be set; processPostCall passes dealer.id which we
  // resolve via DEFAULT_DEALER fallback.
  const dealer = await getDealerByPhone(body.called_number)

  console.log(
    `[Webhook] post-call conv=${conversationId ?? 'n/a'} sid=${callSid ?? 'n/a'} ` +
    `phone=${callerPhone || 'unknown'} dealer=${dealer.name} dur=${duration}s status=${status} turns=${transcript.length}`,
  )

  const result = await processPostCall({
    callSid,
    conversationId,
    callerPhone,
    durationSeconds: duration,
    transcript,
    status,
    dealer,
  })

  return res.json({
    received: true,
    call_log_id: result.callLogId,
    customer_id: result.customer?.id ?? null,
    loaner_request_id: result.loanerRequestId,
    summary: result.summary,
    persistence: result.persistence,
  })
})

export default router
