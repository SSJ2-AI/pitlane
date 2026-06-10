import { Router, Request, Response } from 'express'
import { lookupById, MOCK_CUSTOMERS } from '../mock/customers'
import { broadcastScreenPop } from '../ws/screenPop'
import { config } from '../config'
import { OutboundCallType } from '../types'

const router = Router()

// In-memory call log for the POC (replace with DB in production)
interface CallLogEntry {
  id: string
  direction: 'inbound' | 'outbound'
  callType?: OutboundCallType
  customerId?: string
  customerName?: string
  phone: string
  status: 'initiated' | 'completed' | 'failed' | 'no_answer'
  duration?: number
  summary?: string
  timestamp: string
}
const callLog: CallLogEntry[] = []

/**
 * POST /calls/outbound
 * Trigger a single outbound AI call to a customer via ElevenLabs Batch Calls API.
 *
 * Body: {
 *   customer_id: string,
 *   call_type: OutboundCallType,
 *   override_first_message?: string
 * }
 */
router.post('/outbound', async (req: Request, res: Response) => {
  const { customer_id, call_type, override_first_message } = req.body as {
    customer_id: string
    call_type: OutboundCallType
    override_first_message?: string
  }

  const customer = lookupById(customer_id)
  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' })
  }

  const vehicle = customer.vehicles[0]
  const nextAppt = customer.upcomingAppointments[0]

  // Build the first message based on call type
  const firstMessages: Record<OutboundCallType, string> = {
    appointment_reminder: nextAppt
      ? `Hello, may I speak with ${customer.firstName}? This is Aria from Porsche Toronto calling with a friendly reminder about your ${nextAppt.serviceType} appointment scheduled for ${nextAppt.date} at ${nextAppt.time}. Is there anything you need to know before your visit?`
      : `Hello, may I speak with ${customer.firstName}? This is Aria from Porsche Toronto. I'm reaching out to schedule your next service appointment for your ${vehicle ? `${vehicle.year} Porsche ${vehicle.model}` : 'vehicle'}. Is this a good time?`,
    recall_notification: `Hello, may I speak with ${customer.firstName}? This is Aria from Porsche Toronto calling regarding an important safety recall notice for your ${vehicle ? `${vehicle.year} Porsche ${vehicle.model}` : 'Porsche'}. This is a free software update that takes about 45 minutes — I'd love to help you schedule it at your convenience.`,
    service_follow_up: `Hello, may I speak with ${customer.firstName}? This is Aria from Porsche Toronto following up on your recent service visit. We want to make sure everything with your ${vehicle ? `${vehicle.year} Porsche ${vehicle.model}` : 'vehicle'} is running perfectly. Do you have a moment?`,
    parts_ready: `Hello, may I speak with ${customer.firstName}? Great news — this is Aria from Porsche Toronto, and I'm calling to let you know the part for your vehicle has arrived. We're ready to complete your service. Would you like to schedule a time to bring it in?`,
  }

  const firstMessage = override_first_message ?? firstMessages[call_type]

  console.log(`[Calls] Initiating outbound ${call_type} to ${customer.firstName} ${customer.lastName} at ${customer.phone}`)

  try {
    // Call ElevenLabs Batch Calls API
    const response = await fetch(`${config.elevenlabs.baseUrl}/convai/batch-calling/create`, {
      method: 'POST',
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone_number_id: config.elevenlabs.phoneNumberId,
        agent_id: config.elevenlabs.agentId,
        recipients: [
          {
            phone_number: customer.phone,
            user_name: customer.firstName,
            customer_name: `${customer.firstName} ${customer.lastName}`,
            vehicle: vehicle ? `${vehicle.year} Porsche ${vehicle.model}` : '',
            appointment_date: nextAppt?.date ?? '',
            appointment_time: nextAppt?.time ?? '',
          },
        ],
        // Override first message so the agent opens with the right context
        overrides: {
          first_message: firstMessage,
        },
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error(`[Calls] ElevenLabs API error: ${response.status} ${err}`)

      // In mock mode, simulate success even if ElevenLabs isn't configured yet
      if (config.useMockData || !config.elevenlabs.agentId) {
        return handleMockOutbound(customer, call_type, res)
      }

      return res.status(502).json({ error: 'Failed to initiate call', details: err })
    }

    const data = await response.json() as { batch_id?: string; status?: string }

    const logEntry: CallLogEntry = {
      id: data.batch_id ?? `mock-${Date.now()}`,
      direction: 'outbound',
      callType: call_type,
      customerId: customer.id,
      customerName: `${customer.firstName} ${customer.lastName}`,
      phone: customer.phone,
      status: 'initiated',
      timestamp: new Date().toISOString(),
    }
    callLog.unshift(logEntry)

    broadcastScreenPop({
      type: 'OUTBOUND_INITIATED',
      callId: logEntry.id,
      customer,
      callType: call_type,
      timestamp: logEntry.timestamp,
    })

    return res.json({ success: true, batchId: data.batch_id, status: 'initiated' })
  } catch (err) {
    console.error('[Calls] Network error:', err)

    if (config.useMockData || !config.elevenlabs.agentId) {
      return handleMockOutbound(customer, call_type, res)
    }

    return res.status(500).json({ error: 'Internal error' })
  }
})

/**
 * POST /calls/batch
 * Trigger bulk outbound calls — e.g. all customers with upcoming appointments tomorrow.
 *
 * Body: { call_type: OutboundCallType, customer_ids?: string[] }
 * If customer_ids is omitted, auto-selects based on call_type.
 */
router.post('/batch', async (req: Request, res: Response) => {
  const { call_type, customer_ids } = req.body as {
    call_type: OutboundCallType
    customer_ids?: string[]
  }

  let targets = customer_ids
    ? customer_ids.map(id => lookupById(id)).filter(Boolean)
    : getAutoTargets(call_type)

  if (targets.length === 0) {
    return res.json({ success: true, count: 0, message: 'No customers match this call type' })
  }

  console.log(`[Calls] Batch outbound ${call_type} to ${targets.length} customers`)

  // For the POC in mock mode, just simulate all succeeded
  const results = targets.map(c => ({
    customerId: c!.id,
    customerName: `${c!.firstName} ${c!.lastName}`,
    phone: c!.phone,
    status: 'initiated',
  }))

  results.forEach(r => {
    callLog.unshift({
      id: `batch-${Date.now()}-${r.customerId}`,
      direction: 'outbound',
      callType: call_type,
      customerId: r.customerId,
      customerName: r.customerName,
      phone: r.phone,
      status: 'initiated',
      timestamp: new Date().toISOString(),
    })
  })

  return res.json({
    success: true,
    count: results.length,
    results,
    message: `${results.length} outbound calls initiated`,
  })
})

/**
 * GET /calls/history
 * Returns recent call log for the PitLane dashboard.
 */
router.get('/history', (_req: Request, res: Response) => {
  res.json({
    calls: callLog.slice(0, 50),
    total: callLog.length,
  })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function handleMockOutbound(customer: NonNullable<ReturnType<typeof lookupById>>, callType: OutboundCallType, res: Response) {
  const mockId = `mock-${Date.now()}`
  callLog.unshift({
    id: mockId,
    direction: 'outbound',
    callType,
    customerId: customer.id,
    customerName: `${customer.firstName} ${customer.lastName}`,
    phone: customer.phone,
    status: 'initiated',
    timestamp: new Date().toISOString(),
  })

  broadcastScreenPop({
    type: 'OUTBOUND_INITIATED',
    callId: mockId,
    customer,
    callType,
    timestamp: new Date().toISOString(),
  })

  console.log(`[Calls] Mock outbound initiated for ${customer.firstName} ${customer.lastName}`)
  return res.json({ success: true, batchId: mockId, status: 'initiated', mock: true })
}

function getAutoTargets(callType: OutboundCallType) {
  switch (callType) {
    case 'appointment_reminder':
      return MOCK_CUSTOMERS.filter(c => c.upcomingAppointments.length > 0)
    case 'recall_notification':
      return MOCK_CUSTOMERS.filter(c => c.openRecalls.some(r => r.status === 'open'))
    case 'service_follow_up':
      return MOCK_CUSTOMERS.filter(c => c.lastVisit != null)
    case 'parts_ready':
      return MOCK_CUSTOMERS.filter(c =>
        c.openRepairOrders.some(r => r.status === 'awaiting_parts')
      )
    default:
      return []
  }
}

export { callLog }
export default router
