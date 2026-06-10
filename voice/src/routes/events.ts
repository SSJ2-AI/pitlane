import { Router, Request, Response } from 'express'
import { broadcastScreenPop } from '../ws/screenPop'
import { callLog } from './calls'
import { ElevenLabsCallEvent } from '../types'

const router = Router()

/**
 * POST /events/call-completed
 * ElevenLabs sends this after every call ends.
 * Contains transcript, summary, duration, and outcome.
 */
router.post('/call-completed', (req: Request, res: Response) => {
  const event = req.body as ElevenLabsCallEvent

  console.log(`[Events] Call completed: call_id=${event.call_id} duration=${event.duration_seconds}s status=${event.status}`)

  // Update the call log entry if it exists
  const logEntry = callLog.find(c => c.id === event.call_id)
  if (logEntry) {
    logEntry.status = event.status === 'completed' ? 'completed' : event.status === 'no_answer' ? 'no_answer' : 'failed'
    logEntry.duration = event.duration_seconds
    logEntry.summary = event.summary
  } else {
    // Inbound call — add to log
    callLog.unshift({
      id: event.call_id,
      direction: 'inbound',
      phone: event.caller_phone ?? 'unknown',
      status: event.status === 'completed' ? 'completed' : 'failed',
      duration: event.duration_seconds,
      summary: event.summary,
      timestamp: new Date(event.start_time_unix * 1000).toISOString(),
    })
  }

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

export default router
