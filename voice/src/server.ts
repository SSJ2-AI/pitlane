import { createServer } from 'http'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { config } from './config'
import { initWebSocketServer } from './ws/screenPop'
import toolsRouter from './routes/tools'
import callsRouter from './routes/calls'
import eventsRouter from './routes/events'
import { setGlobalNextCaller, setPhoneOverride, listOverrides } from './mock/sessionOverrides'
import { MOCK_CUSTOMERS } from './mock/customers'

const app = express()
const httpServer = createServer(app)

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: [config.pitlaneDashboardUrl, 'http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  next()
})

// ─── Routes ───────────────────────────────────────────────────────────────────

// Live advisor dashboard — open this in any browser to see real-time screen pops
app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'src', 'dashboard.html'))
})
app.get('/', (_req, res) => res.redirect('/dashboard'))

// Health check — Railway uses this
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'pitlane-voice',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    mode: config.useMockData ? 'mock' : 'live',
  })
})

// ElevenLabs server tool webhooks — agent calls these mid-call
app.use('/tools', toolsRouter)

// Call management — outbound trigger, batch, history
app.use('/calls', callsRouter)

// ElevenLabs post-call events
app.use('/events', eventsRouter)

// ─── Demo: list all available mock CDK customers ─────────────────────────────
app.get('/demo/customers', (_req, res) => {
  res.json({
    customers: MOCK_CUSTOMERS.map(c => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`,
      phone: c.phone,
      loyaltyTier: c.loyaltyTier,
      vehicles: c.vehicles.map(v => `${v.year} Porsche ${v.model}`),
      scenario: c.openRepairOrders.length > 0
        ? `RO open: ${c.openRepairOrders[0].status}`
        : c.upcomingAppointments.length > 0
        ? `Upcoming: ${c.upcomingAppointments[0].serviceType}`
        : c.openRecalls.length > 0
        ? 'Open recall'
        : 'No active items',
    })),
    howToTest: {
      realCall: 'Call +1 (906) 376-0066 from the phone matching a customer\'s phone field above',
      setOverride: 'POST /demo/set-next-caller { "as_customer_id": "cust_002" } then call — overrides ONE lookup',
      screenPop: 'POST /demo/simulate-inbound { "phone": "+14165550202" } to fire screen pop only',
    },
  })
})

// ─── Demo: impersonate a mock CDK customer for the next inbound call ──────────
// Use this to test different customer scenarios without needing multiple phones
// POST /demo/set-next-caller { "as_customer_id": "cust_002" }
// POST /demo/set-next-caller { "as_customer_id": "cust_002", "for_phone": "+16475457709" }
app.post('/demo/set-next-caller', (req, res) => {
  const { as_customer_id, for_phone } = req.body as { as_customer_id: string; for_phone?: string }
  const customer = MOCK_CUSTOMERS.find(c => c.id === as_customer_id)
  if (!customer) {
    return res.status(404).json({ error: `Customer ${as_customer_id} not found`, available: MOCK_CUSTOMERS.map(c => c.id) })
  }
  if (for_phone) {
    setPhoneOverride(for_phone, as_customer_id)
  } else {
    setGlobalNextCaller(as_customer_id)
  }
  return res.json({
    success: true,
    next_caller: `${customer.firstName} ${customer.lastName}`,
    scenario: customer.openRepairOrders.length > 0 ? `RO: ${customer.openRepairOrders[0].description}` : 'No open ROs',
    expires_in: '5 minutes',
    instruction: for_phone
      ? `Next call FROM ${for_phone} will be identified as ${customer.firstName} ${customer.lastName}`
      : `Next call from ANY number will be identified as ${customer.firstName} ${customer.lastName}. Call +1 (906) 376-0066 now.`,
  })
})

// ─── Demo: active overrides ───────────────────────────────────────────────────
app.get('/demo/overrides', (_req, res) => res.json(listOverrides()))

// ─── POC demo endpoint — makes it easy to test without the full ElevenLabs setup
app.post('/demo/simulate-inbound', (req, res) => {
  const { phone = '+16475550101' } = req.body as { phone?: string }

  const { lookupByPhone } = require('./mock/customers')
  const { broadcastScreenPop } = require('./ws/screenPop')
  const { startInboundCall } = require('./store/callStore')
  const { randomUUID } = require('crypto')

  const customer = lookupByPhone(phone)
  const callId = randomUUID()
  startInboundCall({ callId, phone, customer })

  broadcastScreenPop({
    type: 'INCOMING_CALL',
    callId,
    caller: { phone, customer },
    timestamp: new Date().toISOString(),
  })

  res.json({
    simulated: true,
    callId,
    customer: customer ? `${customer.firstName} ${customer.lastName}` : 'Unknown caller',
    phone,
  })
})

// ─── WebSocket — screen pop to PitLane dashboard ──────────────────────────────
initWebSocketServer(httpServer)

// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(config.port, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║          PitLane Voice — AI Telephony Service         ║
╠══════════════════════════════════════════════════════╣
║  HTTP:      http://localhost:${config.port}                    ║
║  WebSocket: ws://localhost:${config.port}/ws                   ║
║  Mode:      ${config.useMockData ? 'MOCK (no real CDK needed)        ' : 'LIVE                           '}  ║
╠══════════════════════════════════════════════════════╣
║  Routes:                                             ║
║    POST /tools/customer-lookup                       ║
║    POST /tools/book-appointment                      ║
║    POST /tools/check-ro-status                       ║
║    POST /calls/outbound                              ║
║    POST /calls/batch                                 ║
║    GET  /calls/history                               ║
║    POST /events/call-completed                       ║
║    POST /demo/simulate-inbound                       ║
╚══════════════════════════════════════���═══════════════╝
  `)
})

export default app
