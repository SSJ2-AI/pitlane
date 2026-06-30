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

export type AppointmentStatus =
    | 'confirmed'
    | 'checked_in'
    | 'in_progress'
    | 'completed'
    | 'cancelled';

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
    /** Phase 15 (migration 0015): lifecycle timestamps + reschedule self-FK. */
    checked_in_at?: string | null;
    completed_at?: string | null;
    rescheduled_from?: string | null;
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

/** Phase 11 — staff row (matches migration 0010). */
export type StaffRole = 'service_advisor' | 'service_manager' | 'group_manager';

export interface StaffRow {
    id: string;
    dealer_id: string | null;
    role: StaffRole;
    full_name: string;
    email: string;
    is_active: boolean;
    invited_by: string | null;
    created_at: string;
    updated_at: string;
}

/** Phase 9b — departments row (matches migration 0008, post sprint review). */
export interface DepartmentRow {
    id: string;
    dealer_id: string | null;
    name: string;
    phone_number: string | null;
    extension: string | null;
    display_name: string;
    display_order: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

/** Phase 9b — repair_order_assignments row (matches migration 0008). */
export interface RepairOrderAssignmentRow {
    id: string;
    dealer_id: string | null;
    repair_order_id: string;
    customer_phone: string | null;
    tech_ids: string[];
    tech_names: string[];
    service_status: 'pending' | 'in_progress' | 'awaiting_parts' | 'completed' | 'extended' | 'cancelled';
    estimated_completion: string | null;
    actual_completion: string | null;
    extended_until: string | null;
    extension_reason: string | null;
    notes: string | null;
    assigned_by: string | null;
    created_at: string;
    updated_at: string;
}

/** Phase 9a — callback_requests row (matches migration 0007). */
export type CallbackStatus = 'pending' | 'acknowledged' | 'completed' | 'cancelled';
export type RichSentiment = 'positive' | 'neutral' | 'negative' | 'frustrated';

export interface CallbackRequestRow {
    id: string;
    dealer_id: string | null;
    customer_phone: string;
    customer_name: string | null;
    call_log_id: string | null;
    reason: string | null;
    sentiment: string | null;
    sentiment_score: number | null;
    status: CallbackStatus;
    assigned_advisor_id: string | null;
    created_at: string;
    acknowledged_at: string | null;
    completed_at: string | null;
}

/** Phase 8b — local customers index row.
 *
 *  PHASE 11 PIPEDA CORRECTION (migration 0012): name + email dropped from
 *  the local schema. CDK is the source of truth for customer contact info.
 *  aria_notes carries Aria's non-PII session observations only.
 *
 *  last_call_at was renamed to last_seen_at in 0012 — same semantic. */
export interface CustomerRow {
    id: string;
    dealer_id: string | null;
    phone: string;
    cdk_customer_id: string | null;
    is_new_customer: boolean;
    total_calls: number;
    last_seen_at: string | null;
    last_sentiment: string | null;
    aria_notes: string | null;
    created_at: string;
    updated_at: string;
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
    /** Phase 13 (migration 0014): assigned loaner vehicle + planned dates. */
    loaner_vehicle_id?: string | null;
    start_date?: string | null;
    end_date?: string | null;
}

/** Phase 13 — service_schedule row (migration 0013). */
export interface ServiceScheduleRow {
    id: string;
    dealer_id: string;
    day_of_week: number;
    open_time: string;
    close_time: string;
    slot_duration_mins: number;
    max_concurrent_bookings: number;
    is_active: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

/** Phase 13 — schedule_overrides row (migration 0013). */
export interface ScheduleOverrideRow {
    id: string;
    dealer_id: string;
    override_date: string;
    is_blocked: boolean;
    reason: string | null;
    open_time: string | null;
    close_time: string | null;
    max_concurrent_bookings: number | null;
    created_by: string | null;
    created_at: string;
}

/** Phase 13 — loaner_vehicles row (migration 0014).
 *
 *  license_plate is QUASI-PII; never expose outside staff-only surfaces or
 *  send over outbound SMS / CDK sync payloads. See migration 0014 comment.
 */
export interface LoanerVehicleRow {
    id: string;
    dealer_id: string;
    make: string;
    model: string;
    year: number;
    license_plate: string;
    color: string | null;
    is_available: boolean;
    notes: string | null;
    created_at: string;
    updated_at: string;
}
