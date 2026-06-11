import OpenAI from 'openai'

// ─── PitLane × OpenAI transcript summarizer ──────────────────────────────────
//
// Given a transcript of an Aria call, this returns structured JSON the rest
// of the system can act on: appointment_booked / inquiry / upsell_flagged /
// issue_reported / other, plus topics, action items, sentiment, and the
// crucial loaner_needed flag that drives the service-desk loaner queue.
//
// Falls back to a deterministic heuristic summary when OPENAI_API_KEY is
// absent so the demo flow keeps producing usable summaries without paid API
// access.

export type CallOutcome =
  | 'appointment_booked'
  | 'inquiry'
  | 'upsell_flagged'
  | 'issue_reported'
  | 'other'

export type CallSentiment = 'positive' | 'neutral' | 'negative'

export interface UpsellFlag {
  type: string
  description?: string
  value_est?: number
}

export interface CallSummary {
  outcome: CallOutcome
  topics: string[]
  upsells_flagged: UpsellFlag[]
  action_items: string[]
  sentiment: CallSentiment
  loaner_needed: boolean
  summary_text: string
  generated_by: 'openai' | 'heuristic'
}

export interface TranscriptTurn {
  role: 'agent' | 'user' | string
  message: string
}

const OUTCOME_VALUES: CallOutcome[] = [
  'appointment_booked',
  'inquiry',
  'upsell_flagged',
  'issue_reported',
  'other',
]
const SENTIMENT_VALUES: CallSentiment[] = ['positive', 'neutral', 'negative']

const SYSTEM_PROMPT = `You are an analyst writing structured call notes for a Porsche dealership service desk. You will receive a transcript between Aria (an AI service advisor) and a customer. Return a single JSON object — no prose, no markdown — matching this exact shape:

{
  "outcome": "appointment_booked" | "inquiry" | "upsell_flagged" | "issue_reported" | "other",
  "topics": string[],
  "upsells_flagged": [{"type": string, "description": string, "value_est": number}],
  "action_items": string[],
  "sentiment": "positive" | "neutral" | "negative",
  "loaner_needed": boolean,
  "summary_text": string
}

Rules:
- outcome: pick the single most representative outcome.
- topics: 1-5 short noun phrases (e.g. "brake inspection", "tire rotation").
- upsells_flagged: services Aria offered or surfaced beyond the customer's initial request; value_est is your best dollar estimate (omit field if unsure).
- action_items: imperative phrases describing what the human advisor still has to do after the call.
- sentiment: customer's overall tone.
- loaner_needed: true only if the customer asked for a loaner OR Aria offered one and they did not decline.
- summary_text: 1-3 sentence narrative for the advisor.
`

function getClient(): OpenAI | null {
  const apiKey = (process.env.OPENAI_API_KEY ?? '').trim()
  if (!apiKey) return null
  try {
    return new OpenAI({ apiKey })
  } catch (err) {
    console.error('[Summarizer] failed to construct OpenAI client:', err instanceof Error ? err.message : err)
    return null
  }
}

function transcriptToText(transcript: TranscriptTurn[]): string {
  return transcript
    .map((t) => `${(t.role ?? 'unknown').toUpperCase()}: ${t.message ?? ''}`)
    .join('\n')
    .slice(0, 12000) // hard cap to keep token cost predictable
}

function normaliseOutcome(value: unknown): CallOutcome {
  return typeof value === 'string' && (OUTCOME_VALUES as string[]).includes(value)
    ? (value as CallOutcome)
    : 'other'
}

function normaliseSentiment(value: unknown): CallSentiment {
  return typeof value === 'string' && (SENTIMENT_VALUES as string[]).includes(value)
    ? (value as CallSentiment)
    : 'neutral'
}

function normaliseUpsells(value: unknown): UpsellFlag[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): UpsellFlag | null => {
      if (!item || typeof item !== 'object') return null
      const entry = item as Record<string, unknown>
      if (typeof entry.type !== 'string' || entry.type.trim().length === 0) return null
      const valueEst = typeof entry.value_est === 'number' ? entry.value_est : undefined
      return {
        type: entry.type.trim(),
        description: typeof entry.description === 'string' ? entry.description : undefined,
        value_est: valueEst,
      }
    })
    .filter((item): item is UpsellFlag => Boolean(item))
}

function normaliseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(0, 8)
}

function normaliseSummary(payload: Record<string, unknown>, generatedBy: CallSummary['generated_by']): CallSummary {
  return {
    outcome: normaliseOutcome(payload.outcome),
    topics: normaliseStringArray(payload.topics),
    upsells_flagged: normaliseUpsells(payload.upsells_flagged),
    action_items: normaliseStringArray(payload.action_items),
    sentiment: normaliseSentiment(payload.sentiment),
    loaner_needed: payload.loaner_needed === true,
    summary_text: typeof payload.summary_text === 'string' ? payload.summary_text : '',
    generated_by: generatedBy,
  }
}

// ─── Heuristic fallback ──────────────────────────────────────────────────────
// Used when OPENAI_API_KEY is unset or the model call fails. Pattern-match on
// transcript content for the dashboard demo flow.
function heuristicSummary(transcript: TranscriptTurn[]): CallSummary {
  const text = transcript.map((t) => t.message).join(' ').toLowerCase()
  const topics: string[] = []
  const actionItems: string[] = []
  let outcome: CallOutcome = 'inquiry'
  let loanerNeeded = false
  let sentiment: CallSentiment = 'neutral'

  if (/\b(book(ed)?|schedul(e|ed)|appointment|reserved)\b/.test(text)) {
    outcome = 'appointment_booked'
    actionItems.push('Confirm appointment details with customer')
  }
  if (/\bloaner\b/.test(text)) {
    loanerNeeded = true
    actionItems.push('Reserve loaner vehicle')
  }
  if (/\b(recall|safety notice)\b/.test(text)) topics.push('recall')
  if (/\b(brake|brakes|pad|rotor)\b/.test(text)) topics.push('brakes')
  if (/\b(tire|tires|rotation|alignment)\b/.test(text)) topics.push('tires')
  if (/\b(oil|service [ab]|annual service)\b/.test(text)) topics.push('routine service')
  if (/\bpccb\b/.test(text)) topics.push('PCCB inspection')
  if (/\b(thank|appreciate|great|wonderful)\b/.test(text)) sentiment = 'positive'
  if (/\b(angry|upset|frustrat|disappoint|terrible|awful)\b/.test(text)) sentiment = 'negative'
  if (/\b(quote|estimate|how much|cost)\b/.test(text) && outcome === 'inquiry') {
    outcome = 'upsell_flagged'
  }

  return {
    outcome,
    topics: topics.slice(0, 5),
    upsells_flagged: [],
    action_items: actionItems,
    sentiment,
    loaner_needed: loanerNeeded,
    summary_text: transcript[0]?.message
      ? `Heuristic summary: ${transcript[0].message.slice(0, 140)}`
      : 'Heuristic summary unavailable (empty transcript).',
    generated_by: 'heuristic',
  }
}

export async function summariseTranscript(transcript: TranscriptTurn[]): Promise<CallSummary> {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return heuristicSummary([])
  }

  const client = getClient()
  if (!client) {
    return heuristicSummary(transcript)
  }

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcriptToText(transcript) },
      ],
    })
    const content = response.choices[0]?.message?.content
    if (!content) {
      console.warn('[Summarizer] OpenAI returned no content; falling back to heuristic')
      return heuristicSummary(transcript)
    }
    const parsed = JSON.parse(content) as Record<string, unknown>
    return normaliseSummary(parsed, 'openai')
  } catch (err) {
    console.error('[Summarizer] OpenAI call failed:', err instanceof Error ? err.message : err)
    return heuristicSummary(transcript)
  }
}
