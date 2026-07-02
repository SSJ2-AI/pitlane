import { Router, Request, Response } from 'express'
import { callLog } from './calls'
import { ElevenLabsCallEvent } from '../types'
import { startInboundCall, getCall, recordEvent } from '../store/callStore'
import { lookupByPhone } from '../mock/customers'
import { processPostCall, normaliseStatus } from '../lib/postCallProcessor'
import type { TranscriptTurn } from '../lib/summarizer'

const router = Router()

/**
 * POST /events/call-completed
 *
 * Legacy ElevenLabs post-call endpoint. Kept for back-compat with agents that
 * still point at the old URL. Delegates to the shared post-call pipeline so
 * the resulting record gets the GPT-4o-mini summary + Supabase persistence
 * just like POST /webhook/post-call (the canonical endpoint).
 */
router.post('/call-completed', (req: Request, res: Response): void => {
  (async () => {
    const event = req.body as ElevenLabsCallEvent
    console.log(`[Events] (legacy) call-completed call_id=${event.call_id} dur=${event.duration_seconds}s status=${event.status}`)

    const status = normaliseStatus(event.status)
    const phone = event.caller_phone ?? 'unknown'

    // Keep the in-memory callLog list (used by GET /calls/history fallback)
    // up to date — the new pipeline only manages the callStore + Supabase.
    const logEntry = callLog.find(c => c.id === event.call_id)
    if (logEntry) {
      logEntry.status = status
      logEntry.duration = event.duration_seconds
      logEntry.summary = event.summary
    } else {
      callLog.unshift({
        id: event.call_id,
        direction: 'inbound',
        phone,
        status,
        duration: event.duration_seconds,
        summary: event.summary,
        timestamp: new Date(event.start_time_unix * 1000).toISOString(),
      })
    }

    // Make sure the call exists in the in-memory store so processPostCall's
    // CALL_ENDED broadcast finds something to close.
    if (!getCall(event.call_id)) {
      startInboundCall({
        callId: event.call_id,
        phone,
        customer: phone !== 'unknown' ? lookupByPhone(phone) : null,
      })
    }

    const transcript: TranscriptTurn[] = event.transcript
      ? event.transcript.map((t) => ({ role: t.role, message: t.message }))
      : []

    try {
      await processPostCall({
        conversationId: event.call_id,
        // Phase 15b: pass a real null when the legacy event carried no
        // caller-id so processPostCall can write NULL to call_logs
        // instead of the string 'unknown'.
        callerPhone: phone === 'unknown' ? null : phone,
        durationSeconds: event.duration_seconds,
        transcript,
        status,
      })
    } catch (err) {
      console.error('[Events] (legacy) processPostCall failed:', err instanceof Error ? err.message : err)
    }

    res.sendStatus(200)
  })().catch((err: Error) => {
    console.error('[Events] (legacy) unhandled error:', err.message)
    res.sendStatus(200) // still 200 so ElevenLabs doesn't retry
  })
})

/**
 * POST /events/notes
 * Used by the advisor dashboard (Phase 2) to attach a free-form note to a call
 * — either as a "directive to Aria" mid-call, or as a post-call advisor note.
 * Body: { call_id: string, note: string, author?: string }
 */
router.post('/notes', (req: Request, res: Response) => {
  const { call_id, note, author } = req.body as { call_id?: string; note?: string; author?: string }
  if (!call_id || !note) {
    return res.status(400).json({ error: 'call_id and note are required' })
  }
  const event = recordEvent(call_id, 'NOTE_ADDED', { source: author ?? 'advisor', note })
  if (!event) return res.status(404).json({ error: 'Call not found' })
  return res.json({ success: true, event })
})

export default router
