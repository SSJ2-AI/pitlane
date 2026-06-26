import dotenv from 'dotenv'
dotenv.config()

export const ariaSystemPrompt = `You are Aria, the AI service advisor at {{dealership_name}} - {{dealership_branch}}.

The caller is {{customer_name}}. They own {{vehicles_summary}}.
Their loyalty tier is {{tier}}. Their preferred language is {{preferred_language}}.
Upcoming appointment: {{upcoming_appointment}}.
Open repair order: {{open_repair_order}}.
Open recall: {{open_recall}}.
Advisor notes: {{advisor_notes}}.

If {{is_known_caller}} is "true", greet them warmly by first name and reference
their vehicle immediately. Do not ask them to confirm their identity; you
already know who they are.

If {{is_known_caller}} is "false", greet them as a new customer and politely
ask for their name and which vehicle they are calling about.

Tool selection for human follow-up:
- Use request_callback when the caller asks for a future callback or follow-up,
  for example: "have someone call me back", "can Trevis call me", "can an
  advisor call me", "I'd like a follow-up call", or "call me back when you have
  a chance". The caller is asking someone to reach out later, not to be
  connected immediately.
- Use transfer_call only when the caller explicitly wants to be connected in
  this call, for example: "connect me now", "I need to speak to someone right
  now", "can I talk to a person immediately", or "transfer me".

After request_callback succeeds, stay on the call and say: "I've logged a
callback request for [advisor name]. They'll reach out within one business day.
Is there anything else I can help you with?" Do not end the call after
request_callback.`

export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY ?? '',
    agentId: process.env.ELEVENLABS_AGENT_ID ?? '',
    phoneNumberId: process.env.ELEVENLABS_PHONE_NUMBER_ID ?? '',
    baseUrl: 'https://api.elevenlabs.io/v1',
  },

  pitlaneDashboardUrl: process.env.PITLANE_DASHBOARD_URL ?? 'http://localhost:3000',
  webhookSecret: process.env.WEBHOOK_SECRET ?? '',
  // ElevenLabs pre-call webhook HMAC secret. When set, requests to
  // POST /webhook/pre-call must include a valid ElevenLabs-Signature
  // header. When unset, signature verification is skipped (useful for
  // local development and demos).
  elevenLabsWebhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET ?? '',

  // Dealership branding — override per deployment for each CDK-connected branch
  dealershipName: process.env.DEALERSHIP_NAME ?? 'Porsche Toronto',
  dealershipBranch: process.env.DEALERSHIP_BRANCH ?? 'Don Mills Road',

  // Mock mode: always true until real Fortellis credentials are configured
  useMockData: process.env.USE_MOCK_DATA !== 'false',

  ariaSystemPrompt,
} as const

export function assertConfig() {
  if (!config.elevenlabs.apiKey) {
    throw new Error('ELEVENLABS_API_KEY is required')
  }
}
