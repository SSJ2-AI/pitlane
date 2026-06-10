import dotenv from 'dotenv'
dotenv.config()

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
} as const

export function assertConfig() {
  if (!config.elevenlabs.apiKey) {
    throw new Error('ELEVENLABS_API_KEY is required')
  }
}
