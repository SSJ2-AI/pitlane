// ─── Shared post-call processing pipeline ────────────────────────────────────
//
// Used by both POST /webhook/post-call (the canonical ElevenLabs post-call
// webhook) and the legacy POST /events/call-completed endpoint. Centralising
// the pipeline means both entry points behave identically:
//
//   1. Look the customer up by caller phone (Fortellis or mock fallback).
//   2. Summarise the transcript with GPT-4o-mini (heuristic fallback when
//      OPENAI_API_KEY is unset).
//   3. Upsert the call_logs row in Supabase (no-op when Supabase is unset).
//   4. Insert a loaner_requests row when summary.loaner_needed is true and
//      we have a customer_id.
//   5. Close the in-memory call store record + broadcast CALL_ENDED so the
//      dashboard's IncomingCallPopup is dismissed and CallHistory refreshes.

import { lookupByPhoneWithCDK, lookupById } from '../mock/customers'
import { checkOverride } from '../mock/sessionOverrides'
import { broadcastScreenPop } from '../ws/screenPop'
import { endCall, getCall } from '../store/callStore'
import { insertLoanerRequest, isSupabaseConfigured, updateCallLogSentiment, upsertCallLog } from './supabase'
import { scoreSentiment, summariseTranscript, type CallSummary, type SentimentScore, type TranscriptTurn } from './summarizer'
import { DEFAULT_DEALER, type Dealer } from './dealer'
import type { Customer } from '../types'

export type PostCallStatus = 'completed' | 'failed' | 'no_answer'

export interface ProcessPostCallInput {
  callSid?: string | null
  conversationId?: string | null
  callerPhone: string
  durationSeconds: number
  transcript: TranscriptTurn[]
  status: PostCallStatus
  startedAt?: string
  /** Raw ElevenLabs analysis payload from the post-call webhook (if present). */
  analysis?: Record<string, unknown> | null
  /** Multi-tenancy: dealer that owns this call. Defaults to DEFAULT_DEALER. */
  dealer?: Dealer | null
}

export interface ProcessPostCallResult {
  customer: Customer | null
  summary: CallSummary
  /** Phase 9a — separate 4-bucket sentiment + 0.0-1.0 confidence score. */
  sentiment: SentimentScore
  callLogId: string | null
  loanerRequestId: string | null
  persistence: 'supabase' | 'in-memory'
}

export function normaliseStatus(input: string | undefined): PostCallStatus {
  if (input === 'no_answer') return 'no_answer'
  if (input === 'failed') return 'failed'
  return 'completed'
}

export function transcriptToText(transcript: TranscriptTurn[]): string {
  return transcript.map((t) => `[${t.role}] ${t.message}`).join('\n')
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normaliseAnalysisSentiment(value: unknown): CallSummary['sentiment'] | null {
  if (typeof value !== 'string') return null
  const s = value.trim().toLowerCase()
  if (s.includes('positive')) return 'positive'
  if (s.includes('negative') || s.includes('frustrated')) return 'negative'
  if (s.includes('neutral')) return 'neutral'
  return null
}

function mergeSummaryWithElevenLabsAnalysis(
  summary: CallSummary,
  transcript: TranscriptTurn[],
  analysis: Record<string, unknown> | null | undefined,
): CallSummary {
  if (!analysis || typeof analysis !== 'object') return summary

  const analysisSummaryText =
    pickString(analysis.summary)
    ?? pickString(analysis.summary_text)
    ?? pickString(analysis.call_summary)
    ?? pickString(analysis.conversation_summary)
  const analysisSentiment = normaliseAnalysisSentiment(analysis.sentiment)
  const analysisTopics = Array.isArray(analysis.topics)
    ? analysis.topics.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 8)
    : []

  return {
    ...summary,
    summary_text:
      (summary.summary_text || '').trim().length > 0
      || (!analysisSummaryText && transcript.length > 0)
        ? summary.summary_text
        : (analysisSummaryText ?? summary.summary_text),
    sentiment: summary.sentiment === 'neutral' && analysisSentiment ? analysisSentiment : summary.sentiment,
    topics: summary.topics.length > 0 ? summary.topics : analysisTopics,
  }
}

export async function processPostCall(input: ProcessPostCallInput): Promise<ProcessPostCallResult> {
  const phone = (input.callerPhone ?? '').trim()
  const dealer = input.dealer ?? DEFAULT_DEALER

  let customer: Customer | null = null
  if (phone) {
    try {
      const overrideId = checkOverride(phone)
      customer = overrideId ? lookupById(overrideId) : await lookupByPhoneWithCDK(phone)
    } catch (err) {
      console.error('[PostCall] customer lookup failed:', err instanceof Error ? err.message : err)
    }
  }

  // Phase 9a: run the summariser + sentiment scorer in parallel. They're
  // independent OpenAI calls; we don't want to serialise the round-trip.
  const [summary, sentimentScore] = await Promise.all([
    summariseTranscript(input.transcript),
    scoreSentiment(input.transcript),
  ])
  const mergedSummary = mergeSummaryWithElevenLabsAnalysis(summary, input.transcript, input.analysis)
  const summaryForStorage: Record<string, unknown> = {
    ...(mergedSummary as unknown as Record<string, unknown>),
  }
  if (input.analysis && typeof input.analysis === 'object') {
    summaryForStorage.elevenlabs_analysis = input.analysis
  }

  const callLogId = await upsertCallLog({
    call_sid: input.callSid ?? null,
    conversation_id: input.conversationId ?? null,
    caller_phone: phone || 'unknown',
    customer_id: customer?.id ?? null,
    dealer_id: dealer.id,
    direction: 'inbound',
    duration_secs: input.durationSeconds,
    transcript: input.transcript as unknown as unknown[],
    summary: summaryForStorage,
    status: input.status,
    started_at: input.startedAt,
    ended_at: new Date().toISOString(),
  })

  // Stamp the dedicated sentiment columns on the call_logs row when the
  // upsert succeeded + Supabase has the columns (migration 0007). Safe
  // no-op otherwise.
  if (callLogId) {
    await updateCallLogSentiment(callLogId, sentimentScore.sentiment, sentimentScore.score)
  }

  let loanerRequestId: string | null = null
  if (mergedSummary.loaner_needed && customer?.id) {
    loanerRequestId = await insertLoanerRequest({
      call_log_id: callLogId,
      customer_id: customer.id,
      dealer_id: dealer.id,
      requested_date: customer.upcomingAppointments[0]?.date ?? null,
      notes: mergedSummary.summary_text || null,
    })
  }

  const inMemoryCallId =
    input.callSid && getCall(input.callSid)
      ? input.callSid
      : input.conversationId && getCall(input.conversationId)
      ? input.conversationId
      : input.callSid ?? input.conversationId ?? null

  const transcriptText = transcriptToText(input.transcript)
  if (inMemoryCallId) {
    endCall({
      callId: inMemoryCallId,
      status: input.status,
      durationSeconds: input.durationSeconds,
      summary: mergedSummary.summary_text,
      transcript: transcriptText || undefined,
    })
    broadcastScreenPop({
      type: 'CALL_ENDED',
      callId: inMemoryCallId,
      duration: input.durationSeconds,
      summary: mergedSummary.summary_text,
      transcript: transcriptText || undefined,
      timestamp: new Date().toISOString(),
    })
  }

  return {
    customer,
    summary: mergedSummary,
    sentiment: sentimentScore,
    callLogId,
    loanerRequestId,
    persistence: isSupabaseConfigured() ? 'supabase' : 'in-memory',
  }
}
