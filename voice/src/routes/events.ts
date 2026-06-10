import { Router, Request, Response } from 'express'
import { broadcastScreenPop } from '../ws/screenPop'
import { callLog } from './calls'
import { ElevenLabsCallEvent } from '../types'
import { endCall, startInboundCall, getCall, recordEvent } from '../store/callStore'
import { lookupByPhone } from '../mock/customers'

const router = Router()

/**
 * POST /events/call-completed
 * ElevenLabs sends this after every call ends.
 * Contains transcript, summary, duration, and outcome.
 */
router.post('/call-completed', (req: Request, res: Response) => {
  const event = req.body as ElevenLabsCallEvent

  console.log(`[Events] Call completed: call_id=${event.call_id} duration=${event.duration_seconds}s status=${event.status}`)

  const normalizedStatus =
    event.status === 'completed' ? 'completed' : event.status === 'no_answer' ? 'no_answer' : 'failed'

  const logEntry = callLog.find(c => c.id === event.call_id)
  if (logEntry) {
    logEntry.status = normalizedStatus
    logEntry.duration = event.duration_seconds
    logEntry.summary = event.summary
  } else {
    callLog.unshift({
      id: event.call_id,
      direction: 'inbound',
      phone: event.caller_phone ?? 'unknown',
      status: normalizedStatus === 'no_answer' ? 'no_answer' : normalizedStatus === 'completed' ? 'completed' : 'failed',
      duration: event.duration_seconds,
      summary: event.summary,
      timestamp: new Date(event.start_time_unix * 1000).toISOString(),
    })
  }

  // Make sure the call exists in the persistent store before ending it.
  // This handles inbound calls where Aria never invoked customer-lookup
  // (so startInboundCall was never called during the call).
  if (!getCall(event.call_id)) {
    const phone = event.caller_phone ?? 'unknown'
    startInboundCall({
      callId: event.call_id,
      phone,
      customer: phone !== 'unknown' ? lookupByPhone(phone) : null,
    })
  }
  endCall({
    callId: event.call_id,
    status: normalizedStatus,
    durationSeconds: event.duration_seconds,
    summary: event.summary,
    transcript: event.transcript ? event.transcript.map(t => `[${t.role}] ${t.message}`).join('\n') : undefined,
  })

  // Broadcast call ended event to PitLane dashboard
  broadcastScreenPop({
    type: 'CALL_ENDED',
    callId: event.call_id,
    duration: event.duration_seconds,
    summary: event.summary ?? 'Call completed.',
    transcript: event.transcript
      ? event.transcript.map(t => `[${t.role}] ${t.message}`).join('\n')
      : undefined,
    timestamp: new Date().toISOString(),
  })

  // Always return 200 so ElevenLabs doesn't retry
  return res.sendStatus(200)
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
