import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─── PitLane dashboard Supabase client ───────────────────────────────────────
//
// Read-only-ish from the dashboard's perspective: surfaces call_logs,
// appointments, upsells, and loaner_requests that the voice service has
// written. When SUPABASE_URL / SUPABASE_*_KEY are unset this returns null,
// callers should respond with an empty list rather than crashing.

let cached: SupabaseClient | null = null;
let probed = false;

function getUrl() {
    return (process.env.SUPABASE_URL ?? '').trim() || null;
}

function getKey() {
    // Prefer service-role on the server (Next.js API routes). Fall back to
    // anon key. We never expose either to the browser — the dashboard reads
    // through its own API routes.
    return (
        (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
        || (process.env.SUPABASE_ANON_KEY ?? '').trim()
        || null
    );
}

export function isSupabaseConfigured(): boolean {
    return Boolean(getUrl() && getKey());
}

export function getSupabase(): SupabaseClient | null {
    if (cached) return cached;
    if (probed) return null;
    probed = true;

    const url = getUrl();
    const key = getKey();
    if (!url || !key) {
        console.log('[Dashboard][Supabase] credentials not set — API routes will return empty results');
        return null;
    }

    try {
        cached = createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { 'x-pitlane-source': 'dashboard' } },
        });
        return cached;
    } catch (error) {
        console.error('[Dashboard][Supabase] init failed:', error instanceof Error ? error.message : error);
        return null;
    }
}

// ─── Shared types matching the migration ─────────────────────────────────────

export type CallStatus = 'in_progress' | 'completed' | 'failed' | 'no_answer';
export type CallOutcome =
    | 'appointment_booked'
    | 'inquiry'
    | 'upsell_flagged'
    | 'issue_reported'
    | 'other';
export type CallSentiment = 'positive' | 'neutral' | 'negative';

export interface UpsellFlag {
    type: string;
    description?: string;
    value_est?: number;
}

export interface CallSummary {
    outcome: CallOutcome;
    topics: string[];
    upsells_flagged: UpsellFlag[];
    action_items: string[];
    sentiment: CallSentiment;
    loaner_needed: boolean;
    summary_text: string;
    generated_by?: 'openai' | 'heuristic';
}

export interface TranscriptTurn {
    role: 'agent' | 'user' | string;
    message: string;
}

export interface CallLogRow {
    id: string;
    caller_phone: string;
    customer_id: string | null;
    dealer_id: string | null;
    call_sid: string | null;
    conversation_id: string | null;
    direction: 'inbound' | 'outbound';
    duration_secs: number | null;
    summary: CallSummary | null;
    transcript: TranscriptTurn[] | null;
    status: CallStatus;
    started_at: string;
    ended_at: string | null;
    created_at: string;
}

export interface AppointmentRow {
    id: string;
    customer_id: string;
    dealer_id: string | null;
    vehicle_id: string;
    date: string;
    time: string;
    service_type: string;
    advisor: string | null;
    duration_est_hours: number | null;
    status: string;
    confirmation_number: string | null;
    cdk_id: string | null;
    call_log_id: string | null;
    created_at: string;
}

export interface UpsellRow {
    id: string;
    call_log_id: string | null;
    customer_id: string;
    dealer_id: string | null;
    vehicle_id: string;
    upsell_type: string;
    description: string | null;
    value_est: number | null;
    status: string;
    created_at: string;
}

export interface LoanerRequestRow {
    id: string;
    call_log_id: string | null;
    appointment_id: string | null;
    customer_id: string;
    dealer_id: string | null;
    requested_date: string | null;
    loaner_preferred: string | null;
    status: string;
    notes: string | null;
    resolved_by: string | null;
    resolved_at: string | null;
    created_at: string;
    /** Phase 10 task 2 — date the loaner is collected. Added in migration 0008. */
    pickup_date?: string | null;
    /** Phase 10 task 2 — assigned loaner vehicle (free text). NULL = standard loaner pool. */
    loaner_vehicle?: string | null;
}

/** Dashboard-side enrichment of LoanerRequestRow with customer + vehicle context. */
export interface LoanerRequestRowEnriched extends LoanerRequestRow {
    customer_name: string | null;
    appointment_date: string | null;
    vehicle_label: string | null;
}
