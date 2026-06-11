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
import { insertLoanerRequest, isSupabaseConfigured, upsertCallLog } from './supabase'
import { summariseTranscript, type CallSummary, type TranscriptTurn } from './summarizer'
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
}

export interface ProcessPostCallResult {
  customer: Customer | null
  summary: CallSummary
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

  let customer: Customer | null = null
  if (phone) {
    try {
      const overrideId = checkOverride(phone)
      customer = overrideId ? lookupById(overrideId) : await lookupByPhoneWithCDK(phone)
    } catch (err) {
      console.error('[PostCall] customer lookup failed:', err instanceof Error ? err.message : err)
    }
  }

  const summary = await summariseTranscript(input.transcript)

  const callLogId = await upsertCallLog({
    call_sid: input.callSid ?? null,
    conversation_id: input.conversationId ?? null,
    caller_phone: phone || 'unknown',
    customer_id: customer?.id ?? null,
    direction: 'inbound',
    duration_secs: input.durationSeconds,
    transcript: input.transcript as unknown as unknown[],
    summary: summary as unknown as Record<string, unknown>,
    status: input.status,
    started_at: input.startedAt,
    ended_at: new Date().toISOString(),
  })

  let loanerRequestId: string | null = null
  if (summary.loaner_needed && customer?.id) {
    loanerRequestId = await insertLoanerRequest({
      call_log_id: callLogId,
      customer_id: customer.id,
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
    callLogId,
    loanerRequestId,
    persistence: isSupabaseConfigured() ? 'supabase' : 'in-memory',
  }
}
