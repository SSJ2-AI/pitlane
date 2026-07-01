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
  /** Nullable: the post-call webhook may not carry a usable caller-id
   *  (SIP without ANI, blocked/withheld number). We propagate the null
   *  all the way to the DB rather than writing the string 'unknown'. */
  callerPhone: string | null
  durationSeconds: number
  transcript: TranscriptTurn[]
  status: PostCallStatus
  startedAt?: string
  /** Multi-tenancy: dealer that owns this call. Defaults to DEFAULT_DEALER. */
  dealer?: Dealer | null
  /** ElevenLabs' built-in post-call analysis (when configured on the
   *  agent). When provided we use transcript_summary as the summary_text
   *  fallback for the call_logs row — preferring the EL-side summary
   *  over the heuristic one because it's already a paid feature. */
  elevenLabsAnalysis?: {
    transcript_summary?: string
    call_summary_title?: string
    sentiment?: string
  } | null
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
  const [summaryRaw, sentimentScore] = await Promise.all([
    summariseTranscript(input.transcript),
    scoreSentiment(input.transcript),
  ])

  // Prefer ElevenLabs' built-in analysis transcript_summary when our own
  // summariser returned the heuristic fallback (i.e. OPENAI_API_KEY is
  // unset OR the call failed). EL's analysis is already paid for and
  // beats keyword-matching on quality. We only overwrite summary_text;
  // outcome / topics / loaner_needed etc. still come from our pipeline
  // because they drive workflow side-effects the EL summary doesn't
  // know about.
  const elSummary = input.elevenLabsAnalysis?.transcript_summary?.trim()
  const summary =
    elSummary && summaryRaw.generated_by === 'heuristic'
      ? { ...summaryRaw, summary_text: elSummary }
      : summaryRaw

  const callLogId = await upsertCallLog({
    call_sid: input.callSid ?? null,
    // Never persist the literal string 'null' if the ID is missing —
    // pass through a real null. call_logs.conversation_id is nullable.
    conversation_id:
      typeof input.conversationId === 'string' && input.conversationId.trim().length > 0
        ? input.conversationId.trim()
        : null,
    // Phase 15b: never write 'unknown' as caller_phone. When Aria/EL
    // didn't surface a caller-id, leave the column NULL so downstream
    // reporting can distinguish "unknown caller" from a real number.
    caller_phone: phone || null,
    customer_id: customer?.id ?? null,
    dealer_id: dealer.id,
    direction: 'inbound',
    duration_secs: input.durationSeconds,
    transcript: input.transcript as unknown as unknown[],
    summary: summary as unknown as Record<string, unknown>,
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
  if (summary.loaner_needed && customer?.id) {
    loanerRequestId = await insertLoanerRequest({
      call_log_id: callLogId,
      customer_id: customer.id,
      dealer_id: dealer.id,
      requested_date: customer.upcomingAppointments[0]?.date ?? null,
      notes: summary.summary_text || null,
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
      summary: summary.summary_text,
      transcript: transcriptText || undefined,
    })
    broadcastScreenPop({
      type: 'CALL_ENDED',
      callId: inMemoryCallId,
      duration: input.durationSeconds,
      summary: summary.summary_text,
      transcript: transcriptText || undefined,
      timestamp: new Date().toISOString(),
    })
  }

  return {
    customer,
    summary,
    sentiment: sentimentScore,
    callLogId,
    loanerRequestId,
    persistence: isSupabaseConfigured() ? 'supabase' : 'in-memory',
  }
}
