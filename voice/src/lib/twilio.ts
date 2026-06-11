import twilio from 'twilio'
import type { Twilio } from 'twilio'

// ─── PitLane × Twilio client ─────────────────────────────────────────────────
//
// Single lazy client used by every SMS dispatch site. Pattern matches
// supabase.ts / fortellis.ts: when TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
// (+ TWILIO_FROM_PHONE) are unset, the wrapper returns a "dry run" outcome
// so the rest of the pipeline (consent check, template render, Supabase log)
// still runs end-to-end during demos / local dev without hitting Twilio.

export interface SendResult {
    ok: boolean
    twilio_sid?: string
    status: 'sent' | 'failed' | 'skipped'
    failure_reason?: string
    dry_run: boolean
}

let cached: Twilio | null = null
let probed = false

function getAccountSid() {
    return (process.env.TWILIO_ACCOUNT_SID ?? '').trim() || null
}
function getAuthToken() {
    return (process.env.TWILIO_AUTH_TOKEN ?? '').trim() || null
}
export function getDefaultFromPhone(): string | null {
    return (process.env.TWILIO_FROM_PHONE ?? '').trim() || null
}

export function isTwilioConfigured(): boolean {
    return Boolean(getAccountSid() && getAuthToken() && getDefaultFromPhone())
}

function getClient(): Twilio | null {
    if (cached) return cached
    if (probed) return null
    probed = true
    const sid = getAccountSid()
    const token = getAuthToken()
    if (!sid || !token) {
        console.log('[Twilio] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set — SMS dispatch is dry-run only')
        return null
    }
    try {
        cached = twilio(sid, token)
        return cached
    } catch (err) {
        console.error('[Twilio] failed to construct client:', err instanceof Error ? err.message : err)
        return null
    }
}

export interface SendInput {
    to: string
    body: string
    /** Override the default from-phone (TWILIO_FROM_PHONE). */
    from?: string
}

export async function sendSms(input: SendInput): Promise<SendResult> {
    const client = getClient()
    const from = input.from ?? getDefaultFromPhone() ?? null

    // Dry-run path: still useful for logging the intent even when not configured.
    if (!client || !from) {
        console.log(`[Twilio][dry-run] -> ${input.to}: ${input.body.slice(0, 100)}`)
        return { ok: true, status: 'sent', dry_run: true }
    }

    try {
        const message = await client.messages.create({
            from,
            to: input.to,
            body: input.body,
        })
        return {
            ok: true,
            twilio_sid: message.sid,
            status: 'sent',
            dry_run: false,
        }
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        console.error('[Twilio] sendSms failed:', reason)
        return {
            ok: false,
            status: 'failed',
            failure_reason: reason,
            dry_run: false,
        }
    }
}
