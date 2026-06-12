import { config } from '../config'
import { getDealerIdForConversation, getSupabase } from './supabase'
import { decrypt, isEncrypted } from './secrets'

// ─── PitLane multi-tenancy ───────────────────────────────────────────────────
//
// Every operational row (call_logs, appointments, upsells, loaner_requests,
// sms_log) carries a dealer_id FK. This module is the single place we resolve
// "which dealer is this request for?" — either by the Twilio number Aria was
// dialed on (inbound) or by an explicit override.
//
// While a dealership hasn't been provisioned in Supabase yet, the wrapper
// returns DEFAULT_DEALER so everything keeps working with hardcoded creds
// from env vars. This means the multi-tenant schema lands today; the cutover
// to per-dealer routing is a no-op when a single dealer is configured.

export interface Dealer {
    id: string
    name: string
    brand: string
    location: string
    phone_number: string | null
    elevenlabs_agent_id: string | null
    fortellis_subscription_id: string | null
    fortellis_client_id: string | null
    fortellis_client_secret: string | null
    subdomain: string | null
    timezone: string
    active: boolean
}

// Matches the seed row inserted by supabase/migrations/0003_multi_tenancy.sql.
// Keep these in sync — the uuid is referenced directly in queries before
// Supabase is configured.
export const DEFAULT_DEALER_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

export const DEFAULT_DEALER: Dealer = {
    id: DEFAULT_DEALER_ID,
    name: config.dealershipName,
    brand: 'porsche',
    location: config.dealershipBranch,
    phone_number: '+19063760066',
    elevenlabs_agent_id: process.env.ELEVENLABS_AGENT_ID ?? 'agent_2701ktpgkyr7f37vq8dmgxjw4bkt',
    fortellis_subscription_id: process.env.FORTELLIS_SUBSCRIPTION_ID ?? null,
    fortellis_client_id: process.env.FORTELLIS_CLIENT_ID ?? null,
    fortellis_client_secret: process.env.FORTELLIS_CLIENT_SECRET ?? null,
    subdomain: 'porsche-toronto',
    timezone: 'America/Toronto',
    active: true,
}

// ─── Cache ───────────────────────────────────────────────────────────────────
// Dealer rows change rarely. Cache resolved lookups in-process for 5 minutes
// to avoid hitting Supabase on every pre-call / tool invocation.

const CACHE_TTL_MS = 5 * 60 * 1000
const byPhone = new Map<string, { dealer: Dealer; cachedAt: number }>()
const byId = new Map<string, { dealer: Dealer; cachedAt: number }>()

function rememberAll(dealer: Dealer) {
    const now = Date.now()
    byId.set(dealer.id, { dealer, cachedAt: now })
    if (dealer.phone_number) byPhone.set(dealer.phone_number, { dealer, cachedAt: now })
}

function isFresh(entry: { cachedAt: number } | undefined): boolean {
    return Boolean(entry && Date.now() - entry.cachedAt < CACHE_TTL_MS)
}

function normalizePhone(input: string): string {
    const digits = input.replace(/\D/g, '')
    return digits.length === 10 ? `+1${digits}` : digits.startsWith('+') ? input : `+${digits}`
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve which dealer a Twilio inbound number routes to.
 * Falls back to DEFAULT_DEALER when Supabase isn't configured OR no row
 * matches. Callers can detect the fallback via dealer.id === DEFAULT_DEALER_ID.
 */
export async function getDealerByPhone(phoneNumber: string | null | undefined): Promise<Dealer> {
    if (!phoneNumber) return DEFAULT_DEALER
    const e164 = normalizePhone(phoneNumber)

    const cached = byPhone.get(e164)
    if (isFresh(cached)) return cached!.dealer

    const supabase = getSupabase()
    if (!supabase) return DEFAULT_DEALER

    try {
        const { data, error } = await supabase
            .from('dealers')
            .select('*')
            .eq('phone_number', e164)
            .maybeSingle()
        if (error) {
            console.error('[Dealer] getDealerByPhone supabase error:', error.message)
            return DEFAULT_DEALER
        }
        if (!data) {
            // Cache the miss against DEFAULT so we don't pound Supabase for
            // every unmatched inbound number during a Twilio misconfiguration.
            byPhone.set(e164, { dealer: DEFAULT_DEALER, cachedAt: Date.now() })
            return DEFAULT_DEALER
        }
        const dealer = data as Dealer
        rememberAll(dealer)
        return dealer
    } catch (err) {
        console.error('[Dealer] getDealerByPhone threw:', err instanceof Error ? err.message : err)
        return DEFAULT_DEALER
    }
}

export async function getDealerById(dealerId: string | null | undefined): Promise<Dealer> {
    if (!dealerId) return DEFAULT_DEALER

    const cached = byId.get(dealerId)
    if (isFresh(cached)) return cached!.dealer

    const supabase = getSupabase()
    if (!supabase) return DEFAULT_DEALER

    try {
        const { data, error } = await supabase
            .from('dealers')
            .select('*')
            .eq('id', dealerId)
            .maybeSingle()
        if (error) {
            console.error('[Dealer] getDealerById supabase error:', error.message)
            return DEFAULT_DEALER
        }
        if (!data) return DEFAULT_DEALER
        const dealer = data as Dealer
        rememberAll(dealer)
        return dealer
    } catch (err) {
        console.error('[Dealer] getDealerById threw:', err instanceof Error ? err.message : err)
        return DEFAULT_DEALER
    }
}

/**
 * Resolve the dealer that owns the call this conversation_id refers to.
 * Used by Aria's mid-call tools so the rows they insert (appointments,
 * upsells, loaner requests, sms_log) get the correct dealer_id FK without
 * needing the agent to pass it explicitly.
 *
 * Strategy:
 *   1. Look up call_logs.dealer_id for this conversation (pre-call set it).
 *   2. Resolve that uuid to a full Dealer via getDealerById (cached).
 *   3. Fall back to DEFAULT_DEALER if either step misses.
 */
export async function resolveDealerForCall(conversationId?: string | null): Promise<Dealer> {
    if (!conversationId) return DEFAULT_DEALER
    const dealerId = await getDealerIdForConversation(conversationId)
    if (!dealerId) return DEFAULT_DEALER
    return getDealerById(dealerId)
}

// ─── Decrypt-on-demand credentials ───────────────────────────────────────────
//
// IMPORTANT: getDealerByPhone/getDealerById return the dealer row AS STORED,
// which means fortellis_client_secret stays in its encrypted `enc:v1:...`
// form. We never decrypt eagerly into the Dealer object because any code
// path that logs `dealer` or returns it from an API would then leak
// plaintext.
//
// Phase 3 (CDK write-back) will call getDealerFortellisCredentials() at the
// exact moment it needs the secret to construct an OAuth client. The
// plaintext lives only inside that call chain.

export interface FortellisCredentials {
    clientId: string
    clientSecret: string
    subscriptionId: string
}

export class MissingFortellisCredentialsError extends Error {
    constructor(public readonly dealerId: string, public readonly missing: string[]) {
        super(`Dealer ${dealerId} is missing Fortellis credentials: ${missing.join(', ')}`)
        this.name = 'MissingFortellisCredentialsError'
    }
}

export class FortellisDecryptionError extends Error {
    constructor(public readonly dealerId: string, cause: unknown) {
        super(`Failed to decrypt Fortellis credentials for dealer ${dealerId}: ${
            cause instanceof Error ? cause.message : String(cause)
        }`)
        this.name = 'FortellisDecryptionError'
    }
}

/**
 * Resolve a dealer's plaintext Fortellis credentials at the point of use.
 * Pulls from the encrypted `dealers` row when available, falling back to
 * environment variables (the legacy single-dealer config path).
 *
 * Never log the return value of this function.
 */
export function getDealerFortellisCredentials(dealer: Dealer): FortellisCredentials {
    const clientId =
        dealer.fortellis_client_id != null && dealer.fortellis_client_id.length > 0
            ? safeDecrypt(dealer.id, dealer.fortellis_client_id)
            : process.env.FORTELLIS_CLIENT_ID ?? ''
    const clientSecret =
        dealer.fortellis_client_secret != null && dealer.fortellis_client_secret.length > 0
            ? safeDecrypt(dealer.id, dealer.fortellis_client_secret)
            : process.env.FORTELLIS_CLIENT_SECRET ?? ''
    const subscriptionId =
        dealer.fortellis_subscription_id ?? process.env.FORTELLIS_SUBSCRIPTION_ID ?? ''

    const missing: string[] = []
    if (!clientId) missing.push('client_id')
    if (!clientSecret) missing.push('client_secret')
    if (!subscriptionId) missing.push('subscription_id')
    if (missing.length > 0) throw new MissingFortellisCredentialsError(dealer.id, missing)

    return { clientId, clientSecret, subscriptionId }
}

function safeDecrypt(dealerId: string, value: string): string {
    if (!isEncrypted(value)) return value
    try {
        return decrypt(value)
    } catch (err) {
        throw new FortellisDecryptionError(dealerId, err)
    }
}

/**
 * Reset the in-process cache. Used by tests + the future admin endpoint
 * that updates dealer config.
 */
export function clearDealerCache() {
    byPhone.clear()
    byId.clear()
}
