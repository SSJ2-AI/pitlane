import { Router, Request, Response } from 'express'
import { lookupByPhone, lookupById, lookupByPhoneWithCDK, MOCK_CUSTOMERS } from '../mock/customers'
import { checkOverride } from '../mock/sessionOverrides'
import { broadcastScreenPop } from '../ws/screenPop'
import { CustomerLookupRequest, BookAppointmentRequest, CheckROStatusRequest, Appointment, Vehicle, Customer } from '../types'
import { config } from '../config'
import { randomUUID } from 'crypto'
import { recordEvent, startInboundCall } from '../store/callStore'
import {
  getOrCreateCallLogIdForConversation,
  insertAppointment,
  insertCustomerIntake,
  insertLoanerRequest,
  insertUpsell,
  isSupabaseConfigured,
  queueCdkSync,
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
//
// Full URL:
//   GET /tools/book-appointment
//     ?customer_id=cust_001
//     &vehicle_id=veh_001a
//     &service_type=Annual%20Service%20B
//     &date=2026-07-12
//     &time=09:30
//     &call_id=<elevenlabs_conversation_id>
//     &current_mileage=43000           (Phase 10 feature 1 — optional km)
router.get('/book-appointment', (req: Request, res: Response) => {
  const rawMileage = req.query.current_mileage
  const parsedMileage = typeof rawMileage === 'string' ? Number(rawMileage) : Number.NaN
  void handleBookAppointment(
    {
      customerId: req.query.customer_id as string,
      vehicleId: req.query.vehicle_id as string,
      serviceType: req.query.service_type as string,
      date: (req.query.date as string) ?? (req.query.preferred_date as string),
      time: (req.query.time as string) ?? (req.query.preferred_time as string | undefined),
      callId: req.query.call_id as string | undefined,
      currentMileage: Number.isFinite(parsedMileage) ? parsedMileage : null,
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
      currentMileage:
        typeof body.current_mileage === 'number' && Number.isFinite(body.current_mileage)
          ? body.current_mileage
          : null,
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

// ─── Phase 10 feature 2: intake_new_customer ─────────────────────────────────
//
// ElevenLabs tool registration (paste in agent → Tools → Webhook tool):
//   URL:    https://pitlane-voice-production.up.railway.app/tools/intake-new-customer
//   Method: GET (or POST with JSON body)
//   Query params / body fields:
//     full_name           string  required
//     phone               string  required
//     vehicle_year        number  optional
//     vehicle_make        string  optional
//     vehicle_model       string  optional
//     vehicle_vin         string  optional
//     mileage_approx      number  optional
//     reason_for_calling  string  optional
//     call_id             string  optional (ElevenLabs conversation_id)
//
// Aria should call this when customer_lookup returns { found: false } — i.e.
// the caller isn't in the dealer's CDK or PitLane's Supabase. Side effects:
//   1. Console log for audit trail.
//   2. INSERT into customer_intakes (Supabase, if configured + migration 0007
//      applied — graceful no-op otherwise).
//   3. Broadcast a NEW_CUSTOMER_INTAKE screen pop to /ws so the service
//      desk sees a toast immediately.
//   4. Return a confirmation message Aria reads back to the caller.

interface IntakeNewCustomerInput {
  full_name: string
  phone: string
  vehicle_year?: number | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  vehicle_vin?: string | null
  mileage_approx?: number | null
  reason_for_calling?: string | null
  call_id?: string | null
}

const INTAKE_CONFIRMATION =
  "Thanks — I've noted your details. Our service team will reach out to confirm your profile. How can I help you today?"

router.post('/intake-new-customer', (req: Request, res: Response): void => {
  void handleIntakeNewCustomer(req.body as IntakeNewCustomerInput, res)
})

router.get('/intake-new-customer', (req: Request, res: Response): void => {
  const parseNum = (raw: unknown): number | null => {
    if (typeof raw !== 'string' || raw.trim() === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  void handleIntakeNewCustomer(
    {
      full_name: req.query.full_name as string,
      phone: req.query.phone as string,
      vehicle_year: parseNum(req.query.vehicle_year),
      vehicle_make: (req.query.vehicle_make as string | undefined) ?? null,
      vehicle_model: (req.query.vehicle_model as string | undefined) ?? null,
      vehicle_vin: (req.query.vehicle_vin as string | undefined) ?? null,
      mileage_approx: parseNum(req.query.mileage_approx),
      reason_for_calling: (req.query.reason_for_calling as string | undefined) ?? null,
      call_id: (req.query.call_id as string | undefined) ?? null,
    },
    res,
  )
})

async function handleIntakeNewCustomer(
  input: IntakeNewCustomerInput,
  res: Response,
): Promise<Response> {
  const fullName = (input.full_name ?? '').trim()
  const phone = (input.phone ?? '').trim()

  const vehicleSummary = [input.vehicle_year, input.vehicle_make, input.vehicle_model]
    .filter((p) => p !== undefined && p !== null && p !== '')
    .join(' ')
    .trim()

  console.log(
    `[Tool] intake_new_customer name=${fullName || 'n/a'} ` +
    `phone=${phone || 'n/a'} ` +
    `vehicle=${vehicleSummary || 'n/a'} ` +
    `mileage=${input.mileage_approx ?? 'n/a'} ` +
    `call=${input.call_id ?? 'n/a'}`,
  )

  if (!fullName || !phone) {
    return res.status(400).json({
      received: false,
      error: 'full_name and phone are required',
    })
  }

  // Resolve dealer from the in-progress call_logs row when we have a call_id.
  const dealer = await resolveDealerForCall(input.call_id ?? undefined)

  // Record an event on the in-memory call store too, so the call timeline
  // shows the intake even before the Supabase row lands.
  if (input.call_id) {
    recordEvent(input.call_id, 'NOTE_ADDED', {
      source: 'aria',
      action: 'intake_new_customer',
      full_name: fullName,
      phone,
      vehicle: vehicleSummary || null,
    })
  }

  let intakeId: string | null = null
  let callLogId: string | null = null
  if (isSupabaseConfigured()) {
    callLogId = input.call_id
      ? await getOrCreateCallLogIdForConversation(input.call_id, {
          customerId: null,
          phone,
          dealerId: dealer.id,
        })
      : null

    intakeId = await insertCustomerIntake({
      call_log_id: callLogId,
      dealer_id: dealer.id,
      phone,
      full_name: fullName,
      vehicle_year: input.vehicle_year ?? null,
      vehicle_make: input.vehicle_make ?? null,
      vehicle_model: input.vehicle_model ?? null,
      vehicle_vin: input.vehicle_vin ?? null,
      mileage_approx: input.mileage_approx ?? null,
      reason_for_calling: input.reason_for_calling ?? null,
    })
  }

  // Broadcast a screen-pop so the service desk sees the intake immediately.
  // Done regardless of Supabase status so the demo flow still surfaces in
  // the dashboard even without persistence.
  broadcastScreenPop({
    type: 'NEW_CUSTOMER_INTAKE',
    callId: input.call_id ?? null,
    intake: {
      intakeId,
      phone,
      fullName,
      vehicleYear: input.vehicle_year ?? null,
      vehicleMake: input.vehicle_make ?? null,
      vehicleModel: input.vehicle_model ?? null,
      vehicleVin: input.vehicle_vin ?? null,
      mileageApprox: input.mileage_approx ?? null,
      reasonForCalling: input.reason_for_calling ?? null,
    },
    timestamp: new Date().toISOString(),
  })

  return res.json({
    received: true,
    intake_id: intakeId,
    confirmation: INTAKE_CONFIRMATION,
    persistence: intakeId ? 'supabase' : isSupabaseConfigured() ? 'supabase_pending_migration' : 'in-memory',
  })
}

// ─── Shared appointment booking handler ───────────────────────────────────────

interface BookAppointmentInput {
  customerId: string
  vehicleId: string
  serviceType: string
  date: string
  time?: string
  callId?: string
  /**
   * Phase 10 feature 1. Caller-reported current mileage (km). When set we
   *   (a) log it,
   *   (b) update the in-memory vehicle.mileage so subsequent
   *       customer-lookup calls in this session see the fresh number,
   *   (c) queue a 'vehicle_update' cdk_sync_queue row so the Phase 3
   *       worker can write it back to CDK.
   */
  currentMileage?: number | null
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
  const currentMileage =
    typeof input.currentMileage === 'number' && Number.isFinite(input.currentMileage) && input.currentMileage > 0
      ? Math.floor(input.currentMileage)
      : null

  console.log(
    `[Tool] book-appointment customer=${customerId} vehicle=${vehicleId} ` +
    `service=${serviceType} date=${date} time=${time} ` +
    `mileage=${currentMileage !== null ? `${currentMileage} km` : 'n/a'} ` +
    `call=${callId ?? 'n/a'}`,
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

  // 1b. Phase 10 feature 1: update the in-memory vehicle.mileage with the
  //     caller-reported number. We only mutate when the new reading is at
  //     least as high as the stored one — drivers misremember and rolling
  //     back the odometer would corrupt the next-service prediction.
  let mileageUpdated = false
  if (currentMileage !== null && vehicle && currentMileage >= vehicle.mileage) {
    vehicle.mileage = currentMileage
    mileageUpdated = true
  }

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
      current_mileage: currentMileage,
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
          current_mileage: currentMileage,
        },
      })
    }

    // Phase 10 feature 1: separate vehicle_update queue entry so the
    // Phase 3 CDK sync worker can push the mileage to Fortellis Vehicles
    // independently of the appointment. Wrapped in a try/catch because the
    // 'vehicle_update' enum value comes from migration 0006 — if the
    // dealer's Supabase hasn't been migrated yet the insert will trip the
    // entity_type CHECK constraint, and we want to keep the booking call
    // succeeding anyway. The in-memory mileage update + the appointment
    // payload still carry the value so nothing is lost.
    if (mileageUpdated && vehicle && currentMileage !== null) {
      try {
        await queueCdkSync({
          entity_type: 'vehicle_update',
          entity_id: vehicle.id,
          dealer_id: dealer.id,
          payload: {
            customer_id: customer.id,
            vehicle_id: vehicle.id,
            vin: vehicle.vin,
            field: 'mileage',
            new_value: currentMileage,
            reported_at: new Date().toISOString(),
            source: 'aria_book_appointment',
            call_log_id: callLogId,
          },
        })
      } catch (err) {
        console.warn(
          '[Tool] book-appointment: vehicle_update queue insert failed (likely missing migration 0006):',
          err instanceof Error ? err.message : err,
        )
      }
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
    current_mileage: currentMileage,
    mileage_updated: mileageUpdated,
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
