import { createServer } from 'http'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { config } from './config'
import { initWebSocketServer } from './ws/screenPop'
import toolsRouter from './routes/tools'
import callsRouter from './routes/calls'
import eventsRouter from './routes/events'
import webhookRouter from './routes/webhook'
import smsRouter from './routes/sms'
import { setGlobalNextCaller, setPhoneOverride, listOverrides } from './mock/sessionOverrides'
import { MOCK_CUSTOMERS } from './mock/customers'
import { DEFAULT_DEALER } from './lib/dealer'

const app = express()
const httpServer = createServer(app)

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: [config.pitlaneDashboardUrl, 'http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
}))
// Capture the raw body so the ElevenLabs pre-call webhook handler can verify
// the HMAC signature. The parsed `req.body` is still available afterwards.
app.use(express.json({
  verify: (req, _res, buf) => {
    if (buf && buf.length) {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf)
    }
  },
}))
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

// Health check — Railway uses this. Includes build_stamp + git_sha so we can
// tell deploys apart by inspection ("is the new code actually live?"). The
// build_stamp is captured at module load so it reflects when this process
// started, which is when Railway last cycled the deploy.
const BUILD_STARTED_AT = new Date().toISOString()
const PKG_VERSION: string = (() => {
  try {
    return (require('../package.json') as { version: string }).version
  } catch {
    return 'unknown'
  }
})()

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'pitlane-voice',
    version: PKG_VERSION,
    build_started_at: BUILD_STARTED_AT,
    git_sha: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null,
    timestamp: new Date().toISOString(),
    mode: config.useMockData ? 'mock' : 'live',
    default_dealer: {
      id: DEFAULT_DEALER.id,
      name: DEFAULT_DEALER.name,
      brand: DEFAULT_DEALER.brand,
      phone_number: DEFAULT_DEALER.phone_number,
    },
    routes: {
      pre_call_webhook: '/webhook/pre-call',
      post_call_webhook: '/webhook/post-call',
      tools: [
        '/tools/customer-lookup',
        '/tools/book-appointment',
        '/tools/log-upsell',
        '/tools/request-loaner',
        '/tools/check-ro-status',
        '/tools/repair-eta/:ro_id',
        '/tools/warranty/:vehicle_id',
        '/tools/send-sms',
      ],
      sms: '/sms/send',
    },
  })
})

// ElevenLabs pre-call webhook — fires during Twilio ring/dial, lets us inject
// dynamic variables (customer name, vehicle, etc.) before the audio session
// starts so Aria opens the conversation with full context.
app.use('/webhook', webhookRouter)

// ElevenLabs server tool webhooks — agent calls these mid-call
app.use('/tools', toolsRouter)

// Call management — outbound trigger, batch, history
app.use('/calls', callsRouter)

// ElevenLabs post-call events
app.use('/events', eventsRouter)

// Phase 5: SMS dispatch (Twilio). Dry-runs gracefully when TWILIO_* env vars
// are unset; consent check + Supabase log run regardless.
app.use('/sms', smsRouter)

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
║    POST /webhook/pre-call    (ElevenLabs init)       ║
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
