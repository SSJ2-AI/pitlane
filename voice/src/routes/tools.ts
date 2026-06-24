import { Router, Request, Response } from 'express'
import { lookupByPhone, lookupById, lookupByPhoneWithCDK, MOCK_CUSTOMERS } from '../mock/customers'
import { checkOverride } from '../mock/sessionOverrides'
import { broadcastScreenPop } from '../ws/screenPop'
import { CustomerLookupRequest, BookAppointmentRequest, CheckROStatusRequest, Appointment, Vehicle, Customer } from '../types'
import { config } from '../config'
import { randomUUID } from 'crypto'
import { recordEvent, startInboundCall } from '../store/callStore'
import {
  findCustomerByPhone,
  findDepartment,
  getOrCreateCallLogIdForConversation,
  insertAppointment,
  insertCallbackRequest,
  insertLoanerRequest,
  insertUpsell,
  isSupabaseConfigured,
  queueCdkSync,
  updateCustomerName,
  upsertCustomerByPhone,
} from '../lib/supabase'
import { dispatchSms, type SmsMessageType } from '../lib/sms'
import { resolveDealerForCall } from '../lib/dealer'
import { isFortellisLive, lookupByPhoneViaFortellis } from '../cdk/fortellis'

const router = Router()

/**
 * POST /tools/customer-lookup
 * Called by ElevenLabs agent mid-call to identify the caller.
 * Also fires the screen pop to the PitLane dashboard.
 *
 * ElevenLabs sends: { phone_number: "+16475550101", call_id: "...", ... }
 * We respond with customer context the agent uses in the conversation.
 */
// GET /tools/customer-lookup/:phone — path parameter version (ElevenLabs native path params)
router.get('/customer-lookup/:phone', (req: Request, res: Response) => {
  const phone = decodeURIComponent(req.params.phone)
  const callId = (req.query.call_id as string) ?? randomUUID()
  console.log(`[Tool] customer-lookup (GET): phone=${phone} call_id=${callId}`)
  return handleCustomerLookup(phone, callId, res)
})

router.post('/customer-lookup', (req: Request, res: Response): void => {
  // Wrap in async IIFE so Express 4 handles errors properly
  (async () => {
    const body = req.body as CustomerLookupRequest
    let phone = (body.phone_number as string) || ''
    const callId = (body.call_id as string) ?? randomUUID()

    // ─── AUTO-IDENTIFY CALLER ─────────────────────────────────────────────────
    // {{caller_id}} is never injected by ElevenLabs for inbound calls.
    // Instead: use call_id to fetch the caller's phone from ElevenLabs API.
    if (!phone && callId && !callId.startsWith('test') && !callId.startsWith('mock')) {
      try {
        const elevRes = await fetch(
          `https://api.elevenlabs.io/v1/convai/conversations/${callId}`,
          { headers: { 'xi-api-key': config.elevenlabs.apiKey } }
        )
        if (elevRes.ok) {
          const conv = await elevRes.json() as any
          const externalNumber = conv?.metadata?.phone_call?.external_number
          if (externalNumber) {
            phone = externalNumber
            console.log(`[Tool] Auto-identified caller from ElevenLabs: ${phone}`)
          }
        }
      } catch (err) {
        console.error('[Tool] ElevenLabs caller lookup failed (non-fatal):', err)
      }
    }

    console.log(`[Tool] customer-lookup: phone=${phone} call_id=${callId}`)

  // Check for demo override (for testing with different mock CDK customers)
  const overrideId = checkOverride(phone)
  let customer
  if (overrideId) {
    customer = lookupById(overrideId)
  } else if (isFortellisLive()) {
    // Phase 3: voice-side Fortellis lookup. Resolve dealer from the in-
    // progress call_logs row (set by pre-call) so the OAuth call uses the
    // right dealer's credentials.
    const dealer = await resolveDealerForCall(callId)
    customer = await lookupByPhoneViaFortellis(phone, dealer.id)
  } else {
    customer = await lookupByPhoneWithCDK(phone)
  }

  if (!customer) {
    startInboundCall({ callId, phone, customer: null })
    broadcastScreenPop({
      type: 'INCOMING_CALL',
      callId,
      caller: { phone, customer: null },
      timestamp: new Date().toISOString(),
    })

    // Phase 8b auto-create: stamp the customers index for this phone so
    // they show up on the /customers page even before they're in CDK.
    // Also recover a previously-collected name if this is a returning
    // unknown caller (e.g. they hung up before providing it last time).
    let knownName: string | null = null
    if (phone && isSupabaseConfigured()) {
      try {
        const dealer = await resolveDealerForCall(callId)
        const existing = await findCustomerByPhone(phone, dealer.id)
        knownName = existing?.name ?? null
        if (!existing) {
          await upsertCustomerByPhone({ phone, dealer_id: dealer.id, is_new_customer: true })
        }
      } catch (err) {
        console.error('[Tool] customer_lookup auto-create failed (non-fatal):', err instanceof Error ? err.message : err)
      }
    }

    return res.json({
      found: false,
      is_new_customer: knownName === null,
      customer_name: knownName ?? 'new customer',
      message: knownName
        ? `Returning caller — we know them as ${knownName} but they're not in CDK yet.`
        : 'No customer record found for this phone number.',
      suggestion: knownName
        ? `Greet ${knownName} warmly. Ask how you can help today.`
        : 'Warmly introduce yourself, ask for their name (use update_customer_name to save it), then ask how you can help.',
    })
  }

  startInboundCall({ callId, phone, customer })
  broadcastScreenPop({
    type: 'INCOMING_CALL',
    callId,
    caller: { phone, customer },
    timestamp: new Date().toISOString(),
  })

  // Return structured context for the agent to use in conversation
  const primaryVehicle = customer.vehicles[0]
  const openROs = customer.openRepairOrders
  const nextAppt = customer.upcomingAppointments[0]
  const hasOpenRecalls = customer.openRecalls.some(r => r.status === 'open')

  return res.json({
    found: true,
    dealership: {
      name: config.dealershipName,
      branch: config.dealershipBranch,
    },
    customer: {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      loyaltyTier: customer.loyaltyTier,
      preferredLanguage: customer.preferredLanguage,
      notes: customer.notes,
    },
    vehicles: customer.vehicles.map(v => ({
      id: v.id,
      display: `${v.year} Porsche ${v.model} ${v.trim}`,
      mileage: v.mileage,
      licensePlate: v.licensePlate,
    })),
    openRepairOrders: openROs.map(ro => ({
      roNumber: ro.roNumber,
      vehicleId: ro.vehicleId,
      status: ro.status,
      description: ro.description,
      estimatedCompletion: ro.estimatedCompletion,
      advisorName: ro.advisorName,
      totalEstimate: ro.totalEstimate,
    })),
    nextAppointment: nextAppt
      ? {
          date: nextAppt.date,
          time: nextAppt.time,
          serviceType: nextAppt.serviceType,
          advisorName: nextAppt.advisorName,
          status: nextAppt.status,
        }
      : null,
    openRecalls: hasOpenRecalls,
    lastVisit: customer.lastVisit,
    summary: buildCustomerSummary(customer),
  })
  })().catch((err: Error) => {
    console.error('[Tool] Unhandled error in customer-lookup:', err.message)
    res.status(500).json({ found: false, error: 'Internal server error' })
  })
})

// GET /tools/book-appointment — query param version for ElevenLabs tool path
router.get('/book-appointment', (req: Request, res: Response) => {
  void handleBookAppointment(
    {
      customerId: req.query.customer_id as string,
      vehicleId: req.query.vehicle_id as string,
      serviceType: req.query.service_type as string,
      date: (req.query.date as string) ?? (req.query.preferred_date as string),
      time: (req.query.time as string) ?? (req.query.preferred_time as string | undefined),
      callId: req.query.call_id as string | undefined,
    },
    res,
  )
})

// GET /tools/check-ro-status/:customer_id — path param version for ElevenLabs
router.get('/check-ro-status/:customer_id', (req: Request, res: Response) => {
  return handleCheckROStatus(
    req.params.customer_id,
    req.query.ro_number as string | undefined,
    (req.query.call_id as string | undefined) ?? undefined,
    res,
  )
})

/**
 * POST /tools/book-appointment
 * Body: { customer_id, vehicle_id, service_type, date | preferred_date,
 *         time | preferred_time, call_id? }
 *
 * Returns the Phase 2B response shape:
 *   { confirmed, confirmation_number, advisor, duration_est_hours, message }
 *
 * Side effects: writes to appointments table, queues a cdk_sync_queue row
 * (entity_type='appointment') for the Phase 3 worker, updates the in-memory
 * Customer record and call store.
 */
router.post('/book-appointment', (req: Request, res: Response) => {
  const body = req.body as BookAppointmentRequest & { date?: string; time?: string }
  void handleBookAppointment(
    {
      customerId: body.customer_id,
      vehicleId: body.vehicle_id,
      serviceType: body.service_type,
      date: body.date ?? body.preferred_date,
      time: body.time ?? body.preferred_time,
      callId: body.call_id,
    },
    res,
  )
})

/**
 * POST /tools/check-ro-status
 * Agent calls this to give customer a status update on their repair order.
 */
router.post('/check-ro-status', (req: Request, res: Response) => {
  const body = req.body as CheckROStatusRequest
  return handleCheckROStatus(
    body.customer_id as string | undefined,
    body.ro_number as string | undefined,
    body.call_id as string | undefined,
    res,
  )
})

// ─── Phase 2B: log-upsell ────────────────────────────────────────────────────

interface LogUpsellBody {
  customer_id: string
  vehicle_id: string
  upsell_type: string
  description?: string
  value_est?: number
  call_id?: string
}

router.post('/log-upsell', (req: Request, res: Response): void => {
  void handleLogUpsell(req.body as LogUpsellBody, res)
})

router.get('/log-upsell', (req: Request, res: Response): void => {
  void handleLogUpsell(
    {
      customer_id: req.query.customer_id as string,
      vehicle_id: req.query.vehicle_id as string,
      upsell_type: req.query.upsell_type as string,
      description: req.query.description as string | undefined,
      value_est: req.query.value_est ? Number(req.query.value_est) : undefined,
      call_id: req.query.call_id as string | undefined,
    },
    res,
  )
})

// ─── Phase 2B: request-loaner ────────────────────────────────────────────────

interface RequestLoanerBody {
  customer_id: string
  appointment_date?: string
  loaner_preferred?: string
  call_id?: string
}

router.post('/request-loaner', (req: Request, res: Response): void => {
  void handleRequestLoaner(req.body as RequestLoanerBody, res)
})

router.get('/request-loaner', (req: Request, res: Response): void => {
  void handleRequestLoaner(
    {
      customer_id: req.query.customer_id as string,
      appointment_date: req.query.appointment_date as string | undefined,
      loaner_preferred: req.query.loaner_preferred as string | undefined,
      call_id: req.query.call_id as string | undefined,
    },
    res,
  )
})

// ─── Phase 2B: repair-eta ────────────────────────────────────────────────────
// GET /tools/repair-eta/:ro_id — Aria reads this back to a caller asking
// "is my car ready?". Mock mode walks MOCK_CUSTOMERS for the RO; the real
// CDK path will be added in Phase 3 via Fortellis RO Async API.

router.get('/repair-eta/:ro_id', (req: Request, res: Response) => {
  return handleRepairEta(req.params.ro_id, res)
})

router.post('/repair-eta', (req: Request, res: Response) => {
  const body = req.body as { ro_id?: string }
  if (!body?.ro_id) return res.status(400).json({ error: 'ro_id is required' })
  return handleRepairEta(body.ro_id, res)
})

// ─── Phase 2B: warranty ──────────────────────────────────────────────────────
// GET /tools/warranty/:vehicle_id — Aria uses this when the caller asks
// about warranty coverage, factory expiry, CPO, or open recalls. Mock mode
// derives plausible dates from the vehicle's model year; real CDK will be
// added in Phase 3.

router.get('/warranty/:vehicle_id', (req: Request, res: Response) => {
  return handleWarranty(req.params.vehicle_id, res)
})

router.post('/warranty', (req: Request, res: Response) => {
  const body = req.body as { vehicle_id?: string }
  if (!body?.vehicle_id) return res.status(400).json({ error: 'vehicle_id is required' })
  return handleWarranty(body.vehicle_id, res)
})

// ─── Phase 5: send-sms ───────────────────────────────────────────────────────
// POST /tools/send-sms (also GET for ElevenLabs query-param tool config)
// Aria invokes this mid-call to send confirmations / updates to the caller.
//   { customer_id, message_type, custom_text?, call_id?, context? }
// message_type: appointment_confirmation | loaner_confirmed | car_ready |
//               appointment_reminder | parts_arrived | update | custom

const SMS_TYPES: SmsMessageType[] = [
  'appointment_confirmation',
  'appointment_reminder',
  'loaner_confirmed',
  'car_ready',
  'parts_arrived',
  'update',
  'custom',
]

interface SendSmsToolBody {
  customer_id: string
  message_type?: string
  custom_text?: string
  call_id?: string
  context?: Record<string, string | number | undefined | null>
}

router.post('/send-sms', (req: Request, res: Response): void => {
  void handleSendSms(req.body as SendSmsToolBody, res)
})

router.get('/send-sms', (req: Request, res: Response): void => {
  void handleSendSms(
    {
      customer_id: req.query.customer_id as string,
      message_type: req.query.message_type as string | undefined,
      custom_text: req.query.custom_text as string | undefined,
      call_id: req.query.call_id as string | undefined,
    },
    res,
  )
})

async function handleSendSms(input: SendSmsToolBody, res: Response): Promise<Response> {
  const messageType = (input.message_type ?? 'update') as SmsMessageType
  console.log(
    `[Tool] send-sms customer=${input.customer_id} type=${messageType} call=${input.call_id ?? 'n/a'}`,
  )

  if (!input.customer_id) {
    return res.status(400).json({ sent: false, error: 'customer_id is required' })
  }
  if (!SMS_TYPES.includes(messageType)) {
    return res.status(400).json({ sent: false, error: `message_type must be one of ${SMS_TYPES.join(', ')}` })
  }
  const customer = lookupById(input.customer_id)
  if (!customer) {
    return res.status(404).json({ sent: false, error: 'Customer not found' })
  }

  if (input.call_id) {
    recordEvent(input.call_id, 'NOTE_ADDED', {
      source: 'aria',
      action: 'send_sms',
      message_type: messageType,
    })
  }

  const dealer = await resolveDealerForCall(input.call_id)

  const callLogId = input.call_id && isSupabaseConfigured()
    ? await getOrCreateCallLogIdForConversation(input.call_id, {
        customerId: customer.id,
        phone: customer.phone,
        dealerId: dealer.id,
      })
    : null

  const result = await dispatchSms({
    customer_id: customer.id,
    to_phone: customer.phone,
    message_type: messageType,
    custom_text: input.custom_text ?? null,
    context: input.context ?? {},
    dealer,
    call_log_id: callLogId,
  })

  return res.json({
    sent: result.sent,
    status: result.status,
    message_type: result.message_type,
    sms_log_id: result.sms_log_id,
    dry_run: result.dry_run,
    rendered_message: result.rendered_message,
    failure_reason: result.failure_reason,
  })
}

// ─── Phase 9a: request_callback ──────────────────────────────────────────────
//
// ElevenLabs tool registration:
//   URL:    https://pitlane-voice-production.up.railway.app/tools/request_callback
//   Method: GET (or POST with JSON body)
//   Params: caller_phone (required), customer_name, reason, dealer_id,
//           sentiment (optional), call_id (optional)
//
// Aria calls this whenever the caller asks for a human, their service
// advisor, or otherwise expresses frustration she can't resolve. Side
// effects:
//   1. INSERT into public.callback_requests (Supabase, migration 0007).
//   2. Broadcast CALLBACK_REQUESTED over the WebSocket so the
//      /service-desk Callback Queue panel updates immediately.
//   3. Return to Aria the spec-mandated confirmation message.

interface RequestCallbackInput {
  caller_phone: string
  customer_name?: string | null
  reason?: string | null
  sentiment?: string | null
  dealer_id?: string | null
  call_id?: string | null
}

const REQUEST_CALLBACK_CONFIRMATION =
  "I've let your service advisor know you'd like a call back. They'll reach you shortly."

async function handleRequestCallback(input: RequestCallbackInput, res: Response): Promise<Response> {
  const phone = (input.caller_phone ?? '').trim()
  const name = input.customer_name?.trim() || null
  const reason = input.reason?.trim() || null
  const sentiment = input.sentiment?.trim() || null

  console.log(
    `[Tool] request_callback phone=${phone || 'n/a'} name=${name ?? 'n/a'} ` +
    `reason=${reason ?? 'n/a'} sentiment=${sentiment ?? 'n/a'} call=${input.call_id ?? 'n/a'}`,
  )

  if (!phone) {
    return res.status(400).json({ success: false, error: 'caller_phone is required' })
  }

  const dealer = await resolveDealerForCall(input.call_id ?? undefined)
  const dealerId = input.dealer_id ?? dealer.id

  if (input.call_id) {
    recordEvent(input.call_id, 'NOTE_ADDED', {
      source: 'aria',
      action: 'request_callback',
      reason,
      sentiment,
    })
  }

  let callLogId: string | null = null
  if (input.call_id && isSupabaseConfigured()) {
    callLogId = await getOrCreateCallLogIdForConversation(input.call_id, {
      phone,
      dealerId,
    })
  }

  const row = await insertCallbackRequest({
    dealer_id: dealerId,
    customer_phone: phone,
    customer_name: name,
    call_log_id: callLogId,
    reason,
    sentiment,
  })

  broadcastScreenPop({
    type: 'CALLBACK_REQUESTED',
    callId: input.call_id ?? null,
    callback: {
      id: row?.id ?? null,
      phone,
      name,
      reason,
      sentiment,
    },
    timestamp: new Date().toISOString(),
  })

  return res.json({
    success: true,
    callback_id: row?.id ?? null,
    message: REQUEST_CALLBACK_CONFIRMATION,
    persistence: row ? 'supabase' : isSupabaseConfigured() ? 'supabase_pending_migration' : 'in-memory',
  })
}

router.post('/request_callback', (req: Request, res: Response): void => {
  void handleRequestCallback(req.body as RequestCallbackInput, res)
})

router.get('/request_callback', (req: Request, res: Response): void => {
  void handleRequestCallback(
    {
      caller_phone: req.query.caller_phone as string,
      customer_name: (req.query.customer_name as string | undefined) ?? null,
      reason: (req.query.reason as string | undefined) ?? null,
      sentiment: (req.query.sentiment as string | undefined) ?? null,
      dealer_id: (req.query.dealer_id as string | undefined) ?? null,
      call_id: (req.query.call_id as string | undefined) ?? null,
    },
    res,
  )
})

// ─── Phase 9b: transfer_call ────────────────────────────────────────────────
//
// ElevenLabs tool registration:
//   URL:    https://pitlane-voice-production.up.railway.app/tools/transfer_call
//   Method: GET (or POST with JSON body)
//   Params: caller_phone (required), department (required), reason, dealer_id, call_id
//
// Departments are configured in the public.departments table (seeded by
// migration 0008). For inbound Twilio calls, this tool resolves the
// department's Twilio number and returns TwiML-style instructions that
// the ElevenLabs agent can act on. The actual <Dial> handoff is performed
// by Twilio on the agent's side; we just hand back the target number +
// a display name so Aria can say "Transferring you to Parts Department".

const DEPARTMENT_DISPLAY_FALLBACK: Record<string, string> = {
  service: 'Service Advisor',
  parts: 'Parts Department',
  sales: 'Sales Team',
  manager: 'Service Manager',
  reception: 'Reception',
}

interface TransferCallInput {
  caller_phone: string
  department: string
  reason?: string | null
  dealer_id?: string | null
  call_id?: string | null
}

async function handleTransferCall(input: TransferCallInput, res: Response): Promise<Response> {
  const phone = (input.caller_phone ?? '').trim()
  const department = (input.department ?? '').trim().toLowerCase()
  const reason = input.reason?.trim() || null

  console.log(
    `[Tool] transfer_call phone=${phone || 'n/a'} department=${department || 'n/a'} ` +
    `reason=${reason ?? 'n/a'} call=${input.call_id ?? 'n/a'}`,
  )

  if (!phone || !department) {
    return res.status(400).json({ success: false, error: 'caller_phone and department are required' })
  }

  const dealer = await resolveDealerForCall(input.call_id ?? undefined)
  const dealerId = input.dealer_id ?? dealer.id

  // Lookup via Supabase first; fall back to a static display name when
  // the row isn't there. The fallback is enough for Aria to acknowledge
  // the transfer — but with no Twilio number she has to verbally hand
  // off ('Hold while I get them on the line') rather than dial.
  const row = await findDepartment(dealerId, department)
  const displayName =
    row?.display_name ?? DEPARTMENT_DISPLAY_FALLBACK[department] ?? `${department} desk`
  const transferNumber = row?.twilio_number ?? null

  if (input.call_id) {
    recordEvent(input.call_id, 'NOTE_ADDED', {
      source: 'aria',
      action: 'transfer_call',
      department,
      reason,
      transfer_number: transferNumber,
      display_name: displayName,
    })
  }

  return res.json({
    success: true,
    department,
    display_name: displayName,
    transfer_number: transferNumber,
    message: `Transferring you now to ${displayName}. One moment please.`,
    // TwiML instruction the ElevenLabs agent can play to Twilio. When
    // transfer_number is null Aria should keep the customer on the
    // line + flag the request for a human handoff via the dashboard.
    twiml: transferNumber
      ? `<Response><Say>Transferring you to ${escapeXml(displayName)}.</Say><Dial>${escapeXml(transferNumber)}</Dial></Response>`
      : null,
    persistence: row ? 'supabase' : isSupabaseConfigured() ? 'supabase_pending_migration' : 'in-memory',
  })
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

router.post('/transfer_call', (req: Request, res: Response): void => {
  void handleTransferCall(req.body as TransferCallInput, res)
})

router.get('/transfer_call', (req: Request, res: Response): void => {
  void handleTransferCall(
    {
      caller_phone: req.query.caller_phone as string,
      department: req.query.department as string,
      reason: (req.query.reason as string | undefined) ?? null,
      dealer_id: (req.query.dealer_id as string | undefined) ?? null,
      call_id: (req.query.call_id as string | undefined) ?? null,
    },
    res,
  )
})

// ─── Phase 8b: update_customer_name ──────────────────────────────────────────
//
// ElevenLabs tool registration:
//   URL:    https://pitlane-voice-production.up.railway.app/tools/update-customer-name
//   Method: GET (or POST with JSON body)
//   Params: caller_phone (required), name (required), call_id (optional)
//
// Aria calls this once she's collected the caller's name (typically right
// after a is_new_customer=true conversation start). The name lands in the
// public.customers row keyed by phone — same row the pre-call webhook
// auto-created — so the next time this number calls, the dynamic
// variables come back with their name.

interface UpdateCustomerNameInput {
  caller_phone: string
  name: string
  call_id?: string | null
}

async function handleUpdateCustomerName(
  input: UpdateCustomerNameInput,
  res: Response,
): Promise<Response> {
  const phone = (input.caller_phone ?? '').trim()
  const name = (input.name ?? '').trim()

  console.log(
    `[Tool] update_customer_name phone=${phone || 'n/a'} name=${name || 'n/a'} call=${input.call_id ?? 'n/a'}`,
  )

  if (!phone || !name) {
    return res.status(400).json({ updated: false, error: 'caller_phone and name are required' })
  }

  if (input.call_id) {
    recordEvent(input.call_id, 'NOTE_ADDED', {
      source: 'aria',
      action: 'update_customer_name',
      name,
    })
  }

  const dealer = await resolveDealerForCall(input.call_id ?? undefined)
  const row = await updateCustomerName(phone, name, dealer.id)
  return res.json({
    updated: Boolean(row),
    customer_name: name,
    persistence: row ? 'supabase' : isSupabaseConfigured() ? 'supabase_pending_migration' : 'in-memory',
  })
}

router.post('/update-customer-name', (req: Request, res: Response): void => {
  void handleUpdateCustomerName(req.body as UpdateCustomerNameInput, res)
})

router.get('/update-customer-name', (req: Request, res: Response): void => {
  void handleUpdateCustomerName(
    {
      caller_phone: req.query.caller_phone as string,
      name: req.query.name as string,
      call_id: (req.query.call_id as string | undefined) ?? null,
    },
    res,
  )
})

// ─── Shared appointment booking handler ───────────────────────────────────────

interface BookAppointmentInput {
  customerId: string
  vehicleId: string
  serviceType: string
  date: string
  time?: string
  callId?: string
}

/**
 * Service-type -> ballpark duration in hours. Used both as the
 * duration_est_hours response field and to populate the appointments row.
 * Picked to be reasonable defaults; advisors can override in the dashboard.
 */
function estimateDurationHours(serviceType: string): number {
  const s = serviceType.toLowerCase()
  if (s.includes('track') || s.includes('pccb')) return 4
  if (s.includes('brake')) return 3
  if (s.includes('annual service b') || s.includes('major')) return 3
  if (s.includes('annual service') || s.includes('service a')) return 2
  if (s.includes('inspection') || s.includes('software')) return 1
  if (s.includes('recall')) return 1
  if (s.includes('oil')) return 0.75
  return 1.5
}

const ADVISOR_POOL = ['Michael Chen', 'Sarah Kowalski', 'Tom Reeves', 'Marco Alvarez', 'Nina Patel']
function pickAdvisor(customer: Customer): string {
  // Prefer the customer's most recent advisor if we can read one off an
  // existing RO or appointment — otherwise round-robin from the pool.
  const existing =
    customer.openRepairOrders[0]?.advisorName ??
    customer.upcomingAppointments[0]?.advisorName
  if (existing) return existing
  const idx = (customer.id.charCodeAt(customer.id.length - 1) + Date.now() / 1000) | 0
  return ADVISOR_POOL[idx % ADVISOR_POOL.length]
}

async function handleBookAppointment(input: BookAppointmentInput, res: Response): Promise<Response> {
  const { customerId, vehicleId, serviceType, callId } = input
  const date = input.date
  const time = input.time ?? '09:00'

  console.log(
    `[Tool] book-appointment customer=${customerId} vehicle=${vehicleId} ` +
    `service=${serviceType} date=${date} time=${time} call=${callId ?? 'n/a'}`,
  )

  if (!customerId || !serviceType || !date) {
    return res.status(400).json({
      confirmed: false,
      error: 'customer_id, service_type, and date are required',
    })
  }

  const customer = lookupById(customerId)
  if (!customer) {
    return res.status(404).json({ confirmed: false, error: 'Customer not found' })
  }

  const vehicle =
    customer.vehicles.find((v: { id: string }) => v.id === vehicleId) ?? customer.vehicles[0]

  const confirmationNumber = `APT-${Date.now().toString(36).toUpperCase()}`
  const advisor = pickAdvisor(customer)
  const durationHours = estimateDurationHours(serviceType)

  // 1. In-memory mock customer mutation so subsequent customer-lookup calls
  //    see the new appointment.
  const newAppt: Appointment = {
    id: randomUUID(),
    customerId: customer.id,
    vehicleId: vehicle?.id ?? '',
    date,
    time,
    serviceType,
    advisorName: advisor,
    status: 'scheduled',
  }
  customer.upcomingAppointments.push(newAppt)

  // 2. Call store event so the dashboard's live call timeline shows the
  //    booking the moment Aria proposes it.
  if (callId) {
    recordEvent(callId, 'APPOINTMENT_REQUESTED', {
      customerId: customer.id,
      vehicleId: newAppt.vehicleId,
      serviceType,
      date,
      time,
      confirmationNumber,
      advisor,
      duration_est_hours: durationHours,
    })
  }

  // 3. Resolve which dealer owns this call (set by the pre-call webhook on
  //    the call_logs row). Defaults to DEFAULT_DEALER when Supabase isn't
  //    configured or the call isn't yet in the store.
  const dealer = await resolveDealerForCall(callId)

  // 4. Persist to Supabase + queue CDK sync (no-ops when not configured).
  let supabaseAppointmentId: string | null = null
  if (isSupabaseConfigured()) {
    const callLogId = callId
      ? await getOrCreateCallLogIdForConversation(callId, {
          customerId: customer.id,
          phone: customer.phone,
          dealerId: dealer.id,
        })
      : null

    supabaseAppointmentId = await insertAppointment({
      call_log_id: callLogId,
      customer_id: customer.id,
      dealer_id: dealer.id,
      vehicle_id: vehicle?.id ?? '',
      date,
      time,
      service_type: serviceType,
      advisor,
      duration_est_hours: durationHours,
      confirmation_number: confirmationNumber,
      status: 'confirmed',
    })

    if (supabaseAppointmentId) {
      await queueCdkSync({
        entity_type: 'appointment',
        entity_id: supabaseAppointmentId,
        dealer_id: dealer.id,
        payload: {
          customer_id: customer.id,
          vehicle_id: vehicle?.id ?? '',
          date,
          time,
          service_type: serviceType,
          advisor,
          confirmation_number: confirmationNumber,
        },
      })
    }
  }

  // 5. Auto-fire the appointment_confirmation SMS as soon as the booking
  //    lands. dispatchSms handles consent + Supabase log + Twilio dispatch;
  //    when Twilio creds are unset this is a dry-run that still logs intent.
  //    The dealer determines the SMS sign-off ("— Porsche Toronto (…)") and
  //    the sms_log row's dealer_id.
  let smsResultSummary: { sent: boolean; status: string; dry_run: boolean; sms_log_id?: string | null } | null = null
  try {
    const smsResult = await dispatchSms({
      customer_id: customer.id,
      to_phone: customer.phone,
      message_type: 'appointment_confirmation',
      dealer,
      context: {
        date,
        time,
        service_type: serviceType,
        advisor,
        confirmation_number: confirmationNumber,
      },
      call_log_id: callId && isSupabaseConfigured()
        ? await getOrCreateCallLogIdForConversation(callId, {
            customerId: customer.id,
            phone: customer.phone,
            dealerId: dealer.id,
          })
        : null,
      appointment_id: supabaseAppointmentId,
    })
    smsResultSummary = {
      sent: smsResult.sent,
      status: smsResult.status,
      dry_run: smsResult.dry_run,
      sms_log_id: smsResult.sms_log_id,
    }
  } catch (err) {
    console.error('[Tool] book-appointment: SMS dispatch failed (non-fatal):', err instanceof Error ? err.message : err)
  }

  return res.json({
    confirmed: true,
    confirmation_number: confirmationNumber,
    advisor,
    duration_est_hours: durationHours,
    appointment_id: supabaseAppointmentId,
    vehicle: vehicle ? `${vehicle.year} Porsche ${vehicle.model} ${vehicle.trim ?? ''}`.trim() : 'Your vehicle',
    message:
      `Your ${serviceType} appointment is confirmed for ${date} at ${time} with ${advisor}. ` +
      `Estimated duration: ${durationHours} hours. Confirmation: ${confirmationNumber}.`,
    sms: smsResultSummary,
    persistence: isSupabaseConfigured() ? 'supabase' : 'in-memory',
  })
}

// ─── Phase 2B: log-upsell handler ────────────────────────────────────────────

async function handleLogUpsell(input: LogUpsellBody, res: Response): Promise<Response> {
  console.log(
    `[Tool] log-upsell customer=${input.customer_id} vehicle=${input.vehicle_id} ` +
    `type=${input.upsell_type} value=${input.value_est ?? '?'} call=${input.call_id ?? 'n/a'}`,
  )

  if (!input.customer_id || !input.vehicle_id || !input.upsell_type) {
    return res.status(400).json({
      logged: false,
      error: 'customer_id, vehicle_id, and upsell_type are required',
    })
  }
  const customer = lookupById(input.customer_id)
  if (!customer) return res.status(404).json({ logged: false, error: 'Customer not found' })

  if (input.call_id) {
    recordEvent(input.call_id, 'NOTE_ADDED', {
      source: 'aria',
      action: 'log_upsell',
      upsell_type: input.upsell_type,
      value_est: input.value_est ?? null,
    })
  }

  const dealer = await resolveDealerForCall(input.call_id)

  let upsellId: string | null = null
  if (isSupabaseConfigured()) {
    const callLogId = input.call_id
      ? await getOrCreateCallLogIdForConversation(input.call_id, {
          customerId: customer.id,
          phone: customer.phone,
          dealerId: dealer.id,
        })
      : null

    upsellId = await insertUpsell({
      call_log_id: callLogId,
      customer_id: customer.id,
      dealer_id: dealer.id,
      vehicle_id: input.vehicle_id,
      upsell_type: input.upsell_type,
      description: input.description ?? null,
      value_est: input.value_est ?? null,
      status: 'pending',
    })
  }

  // Stable human-readable id even when Supabase isn't configured, so the
  // ElevenLabs agent can read it back to the customer if it wants to.
  const displayId = upsellId ? `UP-${upsellId.slice(0, 8).toUpperCase()}` : `UP-${Date.now().toString(36).toUpperCase()}`

  return res.json({
    logged: true,
    upsell_id: displayId,
    supabase_id: upsellId,
    persistence: isSupabaseConfigured() ? 'supabase' : 'in-memory',
  })
}

// ─── Phase 2B: request-loaner handler ────────────────────────────────────────

async function handleRequestLoaner(input: RequestLoanerBody, res: Response): Promise<Response> {
  console.log(
    `[Tool] request-loaner customer=${input.customer_id} date=${input.appointment_date ?? '?'} ` +
    `preferred=${input.loaner_preferred ?? '?'} call=${input.call_id ?? 'n/a'}`,
  )

  if (!input.customer_id) {
    return res.status(400).json({ requested: false, error: 'customer_id is required' })
  }
  const customer = lookupById(input.customer_id)
  if (!customer) return res.status(404).json({ requested: false, error: 'Customer not found' })

  if (input.call_id) {
    recordEvent(input.call_id, 'LOANER_REQUESTED', {
      customerId: customer.id,
      appointmentDate: input.appointment_date ?? null,
      preferred: input.loaner_preferred ?? null,
    })
  }

  const dealer = await resolveDealerForCall(input.call_id)

  let loanerId: string | null = null
  if (isSupabaseConfigured()) {
    const callLogId = input.call_id
      ? await getOrCreateCallLogIdForConversation(input.call_id, {
          customerId: customer.id,
          phone: customer.phone,
          dealerId: dealer.id,
        })
      : null

    loanerId = await insertLoanerRequest({
      call_log_id: callLogId,
      customer_id: customer.id,
      dealer_id: dealer.id,
      requested_date:
        input.appointment_date ?? customer.upcomingAppointments[0]?.date ?? null,
      loaner_preferred: input.loaner_preferred ?? null,
    })
  }

  const displayId = loanerId ? `LN-${loanerId.slice(0, 8).toUpperCase()}` : `LN-${Date.now().toString(36).toUpperCase()}`

  return res.json({
    requested: true,
    status: 'pending_confirmation',
    loaner_id: displayId,
    supabase_id: loanerId,
    message:
      `Loaner request logged for ${customer.firstName}. ` +
      `The service desk will confirm availability and follow up.`,
    persistence: isSupabaseConfigured() ? 'supabase' : 'in-memory',
  })
}

// ─── Phase 2B: repair-eta handler ────────────────────────────────────────────

const RO_STATUS_COMPLETION: Record<string, number> = {
  open: 5,
  in_progress: 60,
  awaiting_parts: 70,
  completed: 100,
}

function handleRepairEta(roId: string, res: Response): Response {
  console.log(`[Tool] repair-eta ro=${roId}`)
  if (!roId) return res.status(400).json({ error: 'ro_id is required' })

  for (const c of MOCK_CUSTOMERS) {
    const ro = c.openRepairOrders.find((r) => r.roNumber === roId)
    if (!ro) continue
    return res.json({
      ro_id: ro.roNumber,
      customer_id: c.id,
      vehicle_id: ro.vehicleId,
      status: ro.status,
      eta: ro.estimatedCompletion ?? null,
      technician: ro.advisorName,
      notes: ro.description,
      completion_pct: RO_STATUS_COMPLETION[ro.status] ?? 50,
      total_estimate: ro.totalEstimate,
      source: 'mock',
    })
  }

  return res.status(404).json({ error: `RO ${roId} not found` })
}

// ─── Phase 2B: warranty handler ──────────────────────────────────────────────

function findVehicleAcrossMocks(vehicleId: string): { customer: Customer; vehicle: Vehicle } | null {
  for (const c of MOCK_CUSTOMERS) {
    const v = c.vehicles.find((veh) => veh.id === vehicleId || veh.vin === vehicleId)
    if (v) return { customer: c, vehicle: v }
  }
  return null
}

/**
 * Porsche factory new-car warranty in Canada/US is 4 yrs / 80,000 km. CPO
 * extends by 2 yrs after the factory term. Mock mode derives plausible dates
 * from the vehicle's model year. Phase 3 will replace with Fortellis.
 */
function handleWarranty(vehicleId: string, res: Response): Response {
  console.log(`[Tool] warranty vehicle=${vehicleId}`)
  if (!vehicleId) return res.status(400).json({ error: 'vehicle_id is required' })

  const match = findVehicleAcrossMocks(vehicleId)
  if (!match) return res.status(404).json({ error: `Vehicle ${vehicleId} not found` })

  const { customer, vehicle } = match
  const inServiceYear = vehicle.year
  const factoryExpiry = `${inServiceYear + 4}-12-31`
  const cpoExpiry = `${inServiceYear + 6}-12-31`
  const today = new Date()
  const factoryExpiryDate = new Date(factoryExpiry)
  const cpoExpiryDate = new Date(cpoExpiry)

  let warrantyStatus: 'active' | 'expiring_soon' | 'expired'
  if (factoryExpiryDate > today) {
    const daysLeft = Math.floor((factoryExpiryDate.getTime() - today.getTime()) / 86_400_000)
    warrantyStatus = daysLeft < 180 ? 'expiring_soon' : 'active'
  } else if (cpoExpiryDate > today) {
    warrantyStatus = 'active'
  } else {
    warrantyStatus = 'expired'
  }

  // Recalls live on the customer in mocks (not on the vehicle), so we surface
  // them all. In real CDK they'd be filtered to this VIN.
  const openRecalls = customer.openRecalls.filter((r) => r.status === 'open')

  return res.json({
    vehicle_id: vehicle.id,
    vin: vehicle.vin,
    warranty_status: warrantyStatus,
    factory_expiry: factoryExpiry,
    cpo_expiry: cpoExpiry,
    mileage: vehicle.mileage,
    open_recalls: openRecalls.length,
    recall_descriptions: openRecalls.map((r) => ({
      nhtsa_id: r.nhtsa_id,
      component: r.component,
      description: r.description,
      remedy: r.remedy,
    })),
    source: 'mock',
  })
}

// ─── Shared RO status handler ─────────────────────────────────────��────────────

function handleCheckROStatus(
  customerId: string | undefined,
  roNumber: string | undefined,
  callId: string | undefined,
  res: Response
): Response {
  console.log(`[Tool] check-ro-status: ro=${roNumber} customer=${customerId} call=${callId ?? 'n/a'}`)
  if (callId) {
    recordEvent(callId, 'NOTE_ADDED', {
      source: 'aria',
      action: 'check_ro_status',
      roNumber: roNumber ?? null,
      customerId: customerId ?? null,
    })
  }
  let ro = null
  if (roNumber) {
    for (const c of MOCK_CUSTOMERS) {
      const found = c.openRepairOrders.find((r: { roNumber: string }) => r.roNumber === roNumber)
      if (found) { ro = found; break }
    }
  } else if (customerId) {
    const customer = lookupById(customerId)
    if (customer && customer.openRepairOrders.length > 0) ro = customer.openRepairOrders[0]
  }
  if (!ro) return res.json({ found: false, message: 'No open repair orders found.' })
  const statusMessages: Record<string, string> = {
    open: 'Your vehicle has been checked in and is waiting for a technician.',
    in_progress: 'Your vehicle is currently with a technician and work is underway.',
    awaiting_parts: `We are waiting for a part. Estimated completion: ${(ro as { estimatedCompletion?: string }).estimatedCompletion ?? 'to be confirmed'}.`,
    completed: 'The service is complete and your vehicle is ready for pickup.',
  }
  return res.json({
    found: true,
    roNumber: (ro as { roNumber: string }).roNumber,
    status: (ro as { status: string }).status,
    description: (ro as { description: string }).description,
    advisorName: (ro as { advisorName: string }).advisorName,
    estimatedCompletion: (ro as { estimatedCompletion?: string }).estimatedCompletion,
    totalEstimate: (ro as { totalEstimate?: number }).totalEstimate,
    customerMessage: statusMessages[(ro as { status: string }).status] ?? 'Please hold while I connect you to an advisor.',
  })
}

// ─── Shared lookup handler used by both GET and POST routes ───────────────────

async function handleCustomerLookup(phone: string, callId: string, res: Response): Promise<Response> {
  const overrideId = checkOverride(phone)
  let customer
  if (overrideId) {
    customer = lookupById(overrideId)
  } else if (isFortellisLive()) {
    const dealer = await resolveDealerForCall(callId)
    customer = await lookupByPhoneViaFortellis(phone, dealer.id)
  } else {
    customer = lookupByPhone(phone)
  }

  if (!customer) {
    startInboundCall({ callId, phone, customer: null })
    broadcastScreenPop({
      type: 'INCOMING_CALL',
      callId,
      caller: { phone, customer: null },
      timestamp: new Date().toISOString(),
    })
    return res.json({
      found: false,
      message: 'No customer record found for this phone number.',
      suggestion: 'Ask the caller for their name and which vehicle they are calling about.',
    })
  }

  startInboundCall({ callId, phone, customer })
  broadcastScreenPop({
    type: 'INCOMING_CALL',
    callId,
    caller: { phone, customer },
    timestamp: new Date().toISOString(),
  })

  const openROs = customer.openRepairOrders
  const nextAppt = customer.upcomingAppointments[0]
  const hasOpenRecalls = customer.openRecalls.some((r: { status: string }) => r.status === 'open')

  return res.json({
    found: true,
    dealership: { name: config.dealershipName, branch: config.dealershipBranch },
    customer: {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      loyaltyTier: customer.loyaltyTier,
      preferredLanguage: customer.preferredLanguage,
      notes: customer.notes,
    },
    vehicles: customer.vehicles.map((v: { id: string; year: number; model: string; trim: string; mileage: number; licensePlate: string }) => ({
      id: v.id,
      display: `${v.year} Porsche ${v.model} ${v.trim}`,
      mileage: v.mileage,
      licensePlate: v.licensePlate,
    })),
    openRepairOrders: openROs.map((ro: { roNumber: string; vehicleId: string; status: string; description: string; estimatedCompletion?: string; advisorName: string; totalEstimate?: number }) => ({
      roNumber: ro.roNumber,
      vehicleId: ro.vehicleId,
      status: ro.status,
      description: ro.description,
      estimatedCompletion: ro.estimatedCompletion,
      advisorName: ro.advisorName,
      totalEstimate: ro.totalEstimate,
    })),
    nextAppointment: nextAppt ? {
      date: nextAppt.date,
      time: nextAppt.time,
      serviceType: nextAppt.serviceType,
      advisorName: nextAppt.advisorName,
      status: nextAppt.status,
    } : null,
    openRecalls: hasOpenRecalls,
    lastVisit: customer.lastVisit,
    summary: buildCustomerSummary(customer),
  })
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function buildCustomerSummary(c: typeof MOCK_CUSTOMERS[0]): string {
  const parts: string[] = []
  parts.push(`${c.firstName} ${c.lastName} is a ${c.loyaltyTier ?? 'valued'} customer.`)
  if (c.vehicles.length > 0) {
    const vList = c.vehicles.map(v => `${v.year} ${v.model}`).join(' and ')
    parts.push(`They own a ${vList}.`)
  }
  if (c.openRepairOrders.length > 0) {
    const ro = c.openRepairOrders[0]
    parts.push(`They have an open repair order (${ro.roNumber}) — ${ro.description}. Status: ${ro.status}.`)
  }
  if (c.upcomingAppointments.length > 0) {
    const a = c.upcomingAppointments[0]
    parts.push(`Upcoming appointment: ${a.date} at ${a.time} for ${a.serviceType}.`)
  }
  if (c.openRecalls.length > 0) {
    parts.push(`Note: there is an open recall on their vehicle.`)
  }
  return parts.join(' ')
}

export default router
