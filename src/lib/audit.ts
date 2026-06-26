// ─── PitLane Phase 11 compliance: audit_log helper ──────────────────────────
//
// PIPEDA + Quebec Law 25 require an audit trail of who saw what. This
// helper does the IP anonymization (truncate the last octet of an IPv4
// address, or the last 80 bits of an IPv6) + the Supabase insert. All
// API routes that surface customer-bearing data should call this once
// per request.
//
// The function is intentionally fire-and-forget — it returns a Promise<void>
// that the caller can `void` so a Supabase outage doesn't block a read.
// Audit log misses are surfaced via console.warn so an operator running
// `grep -c [audit]` against the Railway tail can spot drift.

import { getSupabase } from './supabase';
import type { PitLaneSession } from './role';

export type AuditAction =
    | 'view_customer'
    | 'view_call'
    | 'view_callbacks'
    | 'view_schedule'
    | 'update_service_schedule'
    | 'create_schedule_override'
    | 'delete_schedule_override'
    | 'create_loaner_vehicle'
    | 'update_loaner_vehicle'
    | 'delete_loaner_vehicle'
    | 'loaner_request_created'
    | 'loaner_request_updated'
    | 'edit_department'
    | 'create_department'
    | 'delete_department'
    | 'invite_staff'
    | 'deactivate_staff'
    | 'activate_staff'
    | 'revoke_session'
    | 'view_group_summary';

export interface AuditEntry {
    action: AuditAction;
    resourceType?: string | null;
    resourceId?: string | null;
}

/**
 * Anonymise a request IP to /24 (IPv4) or /48 (IPv6). Returns null when
 * the input is missing, malformed, or already a localhost / private
 * indicator that wouldn't be useful in an audit trail.
 */
export function anonymiseIp(input: string | null | undefined): string | null {
    if (!input) return null;
    // x-forwarded-for can be a comma-separated chain — first hop is the
    // public client IP per the standard.
    const ip = input.split(',')[0]?.trim();
    if (!ip || ip === '::1' || ip === '127.0.0.1') return null;

    // IPv4: split on '.' and zero the last octet.
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
        const parts = ip.split('.');
        return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }

    // IPv6: collapse the last 80 bits (last 5 hextets). We accept any
    // well-formed v6 address including the :: shorthand and rebuild a
    // /48-truncated form. This is intentionally approximate — the goal
    // is to preserve enough signal for compliance investigation without
    // retaining a precise identifier.
    if (ip.includes(':')) {
        // Expand :: to the right number of zero hextets so we always have 8.
        let expanded = ip;
        if (expanded.includes('::')) {
            const [head, tail] = expanded.split('::');
            const headParts = head ? head.split(':') : [];
            const tailParts = tail ? tail.split(':') : [];
            const missing = 8 - headParts.length - tailParts.length;
            expanded = [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts].join(':');
        }
        const hextets = expanded.split(':');
        if (hextets.length !== 8) return null;
        return `${hextets[0]}:${hextets[1]}:${hextets[2]}::/48`;
    }

    return null;
}

function getRequestIp(request: Request): string | null {
    // Prefer the standard x-forwarded-for from the upstream proxy
    // (Railway / Vercel both set it). Fall back to x-real-ip on rare
    // single-hop deploys.
    return (
        request.headers.get('x-forwarded-for') ??
        request.headers.get('x-real-ip') ??
        null
    );
}

/**
 * Insert a single audit_log row. Service-role insert via getSupabase()
 * so RLS doesn't block it (the table denies all authenticated reads).
 * Best-effort: failures log to console but don't throw.
 */
export async function recordAudit(
    request: Request,
    session: PitLaneSession,
    entry: AuditEntry,
): Promise<void> {
    // Mock mode -> skip the insert; we don't want test runs polluting the
    // audit table.
    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') return;

    const supabase = getSupabase();
    if (!supabase) return;

    try {
        const ip = anonymiseIp(getRequestIp(request));
        const { error } = await supabase.from('audit_log').insert({
            staff_id: session.userId,
            dealer_id: session.dealerId || null,
            action: entry.action,
            resource_type: entry.resourceType ?? null,
            resource_id: entry.resourceId ?? null,
            ip_address: ip,
        });
        if (error) {
            const code = (error as { code?: string }).code;
            if (code === '42P01') {
                console.warn('[audit] audit_log table missing — apply migration 0011');
                return;
            }
            console.warn('[audit] insert failed:', error.message);
        }
    } catch (err) {
        console.warn('[audit] insert threw:', err instanceof Error ? err.message : err);
    }
}
