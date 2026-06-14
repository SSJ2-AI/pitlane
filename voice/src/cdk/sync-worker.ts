import { getSupabase, isSupabaseConfigured } from '../lib/supabase'
import { DEFAULT_DEALER_ID } from '../lib/dealer'
import {
    createAppointment,
    createRONote,
    isFortellisLive,
    type AppointmentPayload,
} from './fortellis'

// ─── PitLane × CDK sync worker ──────────────────────────────────────────────
//
// Drains cdk_sync_queue every 30s, runs each pending job up to 3 times, and
// promotes the row to `dead_letter` after the third failure so it stops
// rotting in the work loop.
//
// State machine:
//   pending      → claimed by the worker (UPDATE status='in_progress' + RETURNING)
//   in_progress  → fortellis call
//                   ├── success: status='synced', last_attempt=now,
//                   │             update parent row (appointments.cdk_id, etc.)
//                   ├── transient fail: status='pending', attempts++,
//                   │                    last_error=msg, last_attempt=now
//                   └── 3rd fail:    status='dead_letter', last_error=msg
//   synced       → terminal (worker ignores)
//   dead_letter  → terminal (ops surface, manual re-enqueue by SET status='pending')
//
// Entity-type dispatch:
//   appointment   →  createAppointment + appointments.cdk_id update
//   note          →  createRONote (payload: { ro_id, note })
//   upsell        →  createRONote against the customer's most recent open RO
//                    (read from the linked upsell row's vehicle_id), with the
//                    upsell description as the note text. Skipped if no open RO.
//   loaner_request→  no CDK write; mark synced (loaner is internal-only)
//
// Concurrency: single-process. If we ever run the voice service horizontally
// the worker should move to its own deploy with a row-level lock — but
// today's one-process Railway deploy makes this safe.

const POLL_INTERVAL_MS = 30_000
const BATCH_SIZE = 10
const MAX_ATTEMPTS = 3

let intervalHandle: NodeJS.Timeout | null = null
let runningTickPromise: Promise<void> | null = null
let lastTickAt: string | null = null
let lastTickResult: 'idle' | 'processed' | 'error' = 'idle'

export interface WorkerStatus {
    running: boolean
    last_tick_at: string | null
    last_tick_result: 'idle' | 'processed' | 'error'
    live: boolean
    poll_interval_ms: number
}

export function getCdkSyncWorkerStatus(): WorkerStatus {
    return {
        running: intervalHandle !== null,
        last_tick_at: lastTickAt,
        last_tick_result: lastTickResult,
        live: isFortellisLive(),
        poll_interval_ms: POLL_INTERVAL_MS,
    }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

/**
 * Start the background drain. Idempotent — calling twice is a no-op.
 *
 * The worker is gated by `START_CDK_SYNC_WORKER=true` env var so demos /
 * local dev don't accidentally call live Fortellis from a side-by-side
 * checkout. Supabase must also be configured (otherwise there's no queue
 * to drain).
 */
export function startCdkSyncWorker(): void {
    if (intervalHandle) return
    const enabled = (process.env.START_CDK_SYNC_WORKER ?? '').trim().toLowerCase() === 'true'
    if (!enabled) {
        console.log('[CDK Worker] disabled — set START_CDK_SYNC_WORKER=true to enable')
        return
    }
    if (!isSupabaseConfigured()) {
        console.log('[CDK Worker] disabled — Supabase is not configured')
        return
    }
    console.log(
        `[CDK Worker] starting (poll=${POLL_INTERVAL_MS}ms, batch=${BATCH_SIZE}, max_attempts=${MAX_ATTEMPTS}, ` +
        `live=${isFortellisLive() ? 'true (Fortellis)' : 'false (mock)'})`,
    )
    intervalHandle = setInterval(() => void tick(), POLL_INTERVAL_MS)
    // Fire one immediately so a deploy doesn't sit on a backlog for 30s.
    void tick()
}

export function stopCdkSyncWorker(): void {
    if (!intervalHandle) return
    clearInterval(intervalHandle)
    intervalHandle = null
    console.log('[CDK Worker] stopped')
}

/**
 * Run a single tick to completion. Used by tests and the optional
 * POST /cdk/drain admin endpoint.
 */
export async function runCdkSyncTickOnce(): Promise<{ processed: number; errors: number; skipped: number }> {
    return executeTick()
}

async function tick(): Promise<void> {
    if (runningTickPromise) return // skip if previous tick still in flight
    runningTickPromise = (async () => {
        try {
            const result = await executeTick()
            lastTickAt = new Date().toISOString()
            lastTickResult = result.processed > 0 || result.errors > 0 ? 'processed' : 'idle'
            if (result.processed + result.errors + result.skipped > 0) {
                console.log(
                    `[CDK Worker] tick processed=${result.processed} errors=${result.errors} skipped=${result.skipped}`,
                )
            }
        } catch (err) {
            lastTickAt = new Date().toISOString()
            lastTickResult = 'error'
            console.error('[CDK Worker] tick failed:', err instanceof Error ? err.message : err)
        } finally {
            runningTickPromise = null
        }
    })()
    return runningTickPromise
}

// ─── Tick implementation ────────────────────────────────────────────────────

interface CdkSyncRow {
    id: string
    entity_type: 'appointment' | 'upsell' | 'loaner_request' | 'note'
    entity_id: string
    dealer_id: string | null
    payload: Record<string, unknown>
    status: string
    attempts: number
    last_error: string | null
}

async function executeTick(): Promise<{ processed: number; errors: number; skipped: number }> {
    const supabase = getSupabase()
    if (!supabase) return { processed: 0, errors: 0, skipped: 0 }

    const { data, error } = await supabase
        .from('cdk_sync_queue')
        .select('id, entity_type, entity_id, dealer_id, payload, status, attempts, last_error')
        .eq('status', 'pending')
        .lt('attempts', MAX_ATTEMPTS)
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE)

    if (error) {
        console.error('[CDK Worker] queue select failed:', error.message)
        return { processed: 0, errors: 1, skipped: 0 }
    }

    const jobs = (data ?? []) as CdkSyncRow[]
    let processed = 0
    let errors = 0
    let skipped = 0

    for (const job of jobs) {
        const claim = await claimJob(job.id)
        if (!claim) {
            skipped++
            continue
        }

        try {
            const handled = await dispatch(job)
            if (handled === 'skipped') {
                skipped++
                await markSynced(job.id, { note: 'no actionable target — skipped' })
            } else {
                processed++
                await markSynced(job.id)
            }
        } catch (err) {
            errors++
            await markFailedOrDeadLetter(job, err)
        }
    }

    return { processed, errors, skipped }
}

async function claimJob(jobId: string): Promise<boolean> {
    const supabase = getSupabase()
    if (!supabase) return false
    // Optimistic claim: only flip pending → in_progress if no other process
    // beat us to it. Returns the updated row when it succeeds.
    const { data, error } = await supabase
        .from('cdk_sync_queue')
        .update({ status: 'in_progress', last_attempt: new Date().toISOString() })
        .eq('id', jobId)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle()
    if (error) {
        console.error(`[CDK Worker] claim ${jobId} error:`, error.message)
        return false
    }
    return Boolean(data)
}

// ─── Dispatch per entity_type ───────────────────────────────────────────────

type DispatchOutcome = 'handled' | 'skipped'

async function dispatch(job: CdkSyncRow): Promise<DispatchOutcome> {
    const dealerId = job.dealer_id ?? DEFAULT_DEALER_ID

    switch (job.entity_type) {
        case 'appointment':
            return dispatchAppointment(job, dealerId)
        case 'note':
            return dispatchNote(job, dealerId)
        case 'upsell':
            return dispatchUpsell(job, dealerId)
        case 'loaner_request':
            // Loaner approvals are internal-only; the dashboard's PATCH
            // /api/loaner-requests/:id already handles the state machine.
            // No CDK write needed — just mark synced and move on.
            return 'skipped'
        default:
            console.error(`[CDK Worker] unknown entity_type ${job.entity_type as string} for job ${job.id}`)
            return 'skipped'
    }
}

async function dispatchAppointment(job: CdkSyncRow, dealerId: string): Promise<DispatchOutcome> {
    const supabase = getSupabase()
    if (!supabase) return 'skipped'

    // Pull the canonical appointment row so the payload reflects current
    // state (in case the row was edited between enqueue + drain).
    const { data: appt, error } = await supabase
        .from('appointments')
        .select('id, customer_id, vehicle_id, date, time, service_type, advisor, duration_est_hours, cdk_id')
        .eq('id', job.entity_id)
        .maybeSingle()
    if (error) throw new Error(`appointments select: ${error.message}`)
    if (!appt) throw new Error(`appointment ${job.entity_id} not found`)
    if ((appt as { cdk_id: string | null }).cdk_id) {
        // Already synced previously; this is a re-enqueue race. Treat as
        // success without re-calling Fortellis.
        return 'handled'
    }

    const row = appt as {
        id: string
        customer_id: string
        vehicle_id: string
        date: string
        time: string
        service_type: string
        advisor: string | null
        duration_est_hours: number | null
    }

    const result = await createAppointment(
        {
            customer_id: row.customer_id,
            vehicle_id: row.vehicle_id,
            date: row.date,
            time: row.time,
            service_type: row.service_type,
            advisor: row.advisor ?? undefined,
            duration_est_hours: row.duration_est_hours ?? undefined,
        } as AppointmentPayload,
        dealerId,
    )

    const { error: updateError } = await supabase
        .from('appointments')
        .update({ cdk_id: result.appointment_cdk_id })
        .eq('id', row.id)
    if (updateError) throw new Error(`appointments.cdk_id update: ${updateError.message}`)
    return 'handled'
}

async function dispatchNote(job: CdkSyncRow, dealerId: string): Promise<DispatchOutcome> {
    const payload = job.payload as { ro_id?: string; note?: string }
    if (!payload.ro_id || !payload.note) {
        // Bad payload — log and dead-letter (skip retries).
        throw new Error(`note payload missing ro_id or note (got keys: ${Object.keys(payload).join(',')})`)
    }
    await createRONote(payload.ro_id, payload.note, dealerId)
    return 'handled'
}

async function dispatchUpsell(job: CdkSyncRow, dealerId: string): Promise<DispatchOutcome> {
    const supabase = getSupabase()
    if (!supabase) return 'skipped'

    const { data: upsell, error } = await supabase
        .from('upsells')
        .select('id, customer_id, vehicle_id, upsell_type, description, value_est')
        .eq('id', job.entity_id)
        .maybeSingle()
    if (error) throw new Error(`upsells select: ${error.message}`)
    if (!upsell) throw new Error(`upsell ${job.entity_id} not found`)

    const u = upsell as {
        id: string
        customer_id: string
        vehicle_id: string
        upsell_type: string
        description: string | null
        value_est: number | null
    }

    // We need an RO to hang the note on. Strategy: take the RO from the
    // payload first (worker caller's hint), else look up the most recent
    // open RO for this customer/vehicle from CDK… but for now we don't
    // have that lookup wired. If the payload has ro_id, attach. Otherwise
    // mark skipped so it surfaces as 'no actionable target' rather than
    // burning retries.
    const payload = job.payload as { ro_id?: string }
    if (!payload.ro_id) {
        return 'skipped'
    }

    const note = [
        `Aria-flagged upsell: ${u.upsell_type}`,
        u.description ? `Details: ${u.description}` : null,
        u.value_est !== null ? `Estimated value: $${u.value_est}` : null,
    ]
        .filter(Boolean)
        .join('\n')

    await createRONote(payload.ro_id, note, dealerId)
    return 'handled'
}

// ─── Outcome marking ────────────────────────────────────────────────────────

async function markSynced(jobId: string, meta?: { note?: string }): Promise<void> {
    const supabase = getSupabase()
    if (!supabase) return
    await supabase
        .from('cdk_sync_queue')
        .update({
            status: 'synced',
            last_attempt: new Date().toISOString(),
            ...(meta?.note ? { last_error: meta.note } : {}),
        })
        .eq('id', jobId)
}

async function markFailedOrDeadLetter(job: CdkSyncRow, err: unknown): Promise<void> {
    const supabase = getSupabase()
    if (!supabase) return
    const message = err instanceof Error ? err.message : String(err)
    const nextAttempts = job.attempts + 1
    const shouldDeadLetter = nextAttempts >= MAX_ATTEMPTS

    console.error(
        `[CDK Worker] job ${job.id} (${job.entity_type}) attempt ${nextAttempts}/${MAX_ATTEMPTS} ` +
        `${shouldDeadLetter ? 'DEAD-LETTERED' : 'failed (will retry)'}: ${message}`,
    )

    await supabase
        .from('cdk_sync_queue')
        .update({
            status: shouldDeadLetter ? 'dead_letter' : 'pending',
            attempts: nextAttempts,
            last_error: message.slice(0, 1000),
            last_attempt: new Date().toISOString(),
        })
        .eq('id', job.id)
}
