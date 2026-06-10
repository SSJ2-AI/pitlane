import { Router, Request, Response } from 'express'
import { lookupByPhone, lookupById, lookupByPhoneWithCDK, MOCK_CUSTOMERS } from '../mock/customers'
import { checkOverride } from '../mock/sessionOverrides'
import { broadcastScreenPop } from '../ws/screenPop'
import { CustomerLookupRequest, BookAppointmentRequest, CheckROStatusRequest, Appointment } from '../types'
import { config } from '../config'
import { randomUUID } from 'crypto'

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
  const customer = overrideId ? lookupById(overrideId) : await lookupByPhoneWithCDK(phone)

  if (!customer) {
    // Unknown caller — still broadcast so advisor sees "Unknown caller" pop
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

  // Fire screen pop to all connected PitLane dashboard clients
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
  return handleBookAppointment(
    req.query.customer_id as string,
    req.query.vehicle_id as string,
    req.query.service_type as string,
    req.query.preferred_date as string,
    req.query.preferred_time as string | undefined,
    res
  )
})

// GET /tools/check-ro-status/:customer_id — path param version for ElevenLabs
router.get('/check-ro-status/:customer_id', (req: Request, res: Response) => {
  return handleCheckROStatus(req.params.customer_id, req.query.ro_number as string | undefined, res)
})

/**
 * POST /tools/book-appointment
 */
router.post('/book-appointment', (req: Request, res: Response) => {
  const body = req.body as BookAppointmentRequest
  return handleBookAppointment(
    body.customer_id as string,
    body.vehicle_id as string,
    body.service_type as string,
    body.preferred_date as string,
    body.preferred_time as string | undefined,
    res
  )
})

/**
 * POST /tools/check-ro-status
 * Agent calls this to give customer a status update on their repair order.
 */
router.post('/check-ro-status', (req: Request, res: Response) => {
  const body = req.body as CheckROStatusRequest
  return handleCheckROStatus(body.customer_id as string | undefined, body.ro_number as string | undefined, res)
})

// ─── Shared appointment booking handler ───────────────────────────────────────

function handleBookAppointment(
  customerId: string,
  vehicleId: string,
  serviceType: string,
  preferredDate: string,
  preferredTime: string | undefined,
  res: Response
): Response {
  console.log(`[Tool] book-appointment: customer=${customerId} service=${serviceType} date=${preferredDate}`)
  const customer = lookupById(customerId)
  if (!customer) {
    return res.status(404).json({ success: false, error: 'Customer not found' })
  }
  const confirmationNumber = `APT-${Date.now().toString(36).toUpperCase()}`
  const vehicle = customer.vehicles.find((v: { id: string }) => v.id === vehicleId) ?? customer.vehicles[0]
  const time = preferredTime ?? '09:00'
  const newAppt: Appointment = {
    id: randomUUID(),
    customerId: customer.id,
    vehicleId: vehicle?.id ?? '',
    date: preferredDate,
    time,
    serviceType,
    advisorName: 'Available Advisor',
    status: 'scheduled',
  }
  customer.upcomingAppointments.push(newAppt)
  return res.json({
    success: true,
    confirmationNumber,
    appointment: {
      date: preferredDate,
      time,
      serviceType,
      vehicle: vehicle ? `${(vehicle as { year: number; model: string }).year} Porsche ${(vehicle as { year: number; model: string }).model}` : 'Your vehicle',
      message: `Your appointment has been confirmed for ${preferredDate} at ${time}. Confirmation: ${confirmationNumber}.`,
    },
  })
}

// ─── Shared RO status handler ─────────────────────────────────────��────────────

function handleCheckROStatus(
  customerId: string | undefined,
  roNumber: string | undefined,
  res: Response
): Response {
  console.log(`[Tool] check-ro-status: ro=${roNumber} customer=${customerId}`)
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
  const customer = overrideId ? lookupById(overrideId) : lookupByPhone(phone)

  if (!customer) {
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
