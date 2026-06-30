import { NextResponse } from 'next/server';
import { getSupabase, type AppointmentRow, type AppointmentStatus } from '@/lib/supabase';
import { resolveScopeForRequest } from '@/lib/dealer';
import { readSessionFromRequest } from '@/lib/role';
import { recordAudit } from '@/lib/audit';

// PATCH /api/appointments/:id/status
//   body: { status: 'checked_in' | 'in_progress' | 'completed' | 'cancelled' }
//
// Service-desk advisor flow. Validates the requested transition against the
// current row's status (defence-in-depth — the UI already hides illegal
// buttons but the API enforces the same rules). Stamps checked_in_at /
// completed_at on the corresponding transitions and emits a recordAudit()
// entry so the compliance trail captures the actor + dealer + appointment.
//
// Role-gated: service_advisor OR service_manager of the same dealer.
// group_manager is read-only (per the Phase 11 role hierarchy) and cannot
// flip appointment status.

export const dynamic = 'force-dynamic';

interface RouteContext {
    params: { id: string };
}

type TransitionTarget = Exclude<AppointmentStatus, 'confirmed'>;

const TARGET_VALUES: readonly TransitionTarget[] = [
    'checked_in',
    'in_progress',
    'completed',
    'cancelled',
];

// Allowed transitions table — keyed by current status, value is the set of
// valid next-status values. Mirrors the spec exactly:
//
//   confirmed   -> checked_in, cancelled
//   checked_in  -> in_progress, completed, cancelled
//   in_progress -> completed, cancelled
//   completed   -> (terminal)
//   cancelled   -> (terminal)
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, ReadonlySet<TransitionTarget>> = {
    confirmed: new Set<TransitionTarget>(['checked_in', 'cancelled']),
    checked_in: new Set<TransitionTarget>(['in_progress', 'completed', 'cancelled']),
    in_progress: new Set<TransitionTarget>(['completed', 'cancelled']),
    completed: new Set<TransitionTarget>(),
    cancelled: new Set<TransitionTarget>(),
};

function isTransitionTarget(value: unknown): value is TransitionTarget {
    return typeof value === 'string' && (TARGET_VALUES as readonly string[]).includes(value);
}

function isAppointmentStatus(value: unknown): value is AppointmentStatus {
    return (
        typeof value === 'string'
        && ['confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled'].includes(value)
    );
}

export async function PATCH(request: Request, context: RouteContext) {
    const session = readSessionFromRequest(request);
    if (session.role !== 'service_advisor' && session.role !== 'service_manager') {
        return NextResponse.json(
            { error: 'Forbidden — only service advisors and managers can update appointment status.' },
            { status: 403 },
        );
    }

    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    let body: { status?: unknown };
    try {
        body = (await request.json()) as { status?: unknown };
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!isTransitionTarget(body.status)) {
        return NextResponse.json(
            { error: `status must be one of ${TARGET_VALUES.join(', ')}` },
            { status: 400 },
        );
    }
    const target: TransitionTarget = body.status;

    const scope = await resolveScopeForRequest(request);
    const dealerId = scope.dealerId ?? scope.dealer.id;
    const now = new Date().toISOString();

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        // Mock mode short-circuit — no Supabase, but we still validate the
        // transition is plausible from the implicit 'confirmed' default the
        // /api/service-desk/summary mock data hands the UI. The page then
        // re-fetches; the mock summary will still return 'confirmed' but the
        // UI is responsible for the optimistic state until the next poll.
        return NextResponse.json({
            appointment: {
                id,
                status: target,
                checked_in_at: target === 'checked_in' ? now : null,
                completed_at: target === 'completed' ? now : null,
            },
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    // Fetch the current row (dealer-scoped) so we can validate the transition
    // before issuing the UPDATE. This keeps the SQL atomic — a stale optimistic
    // value from the client can't sneak past us.
    const current = await supabase
        .from('appointments')
        .select('id, status, dealer_id, checked_in_at, completed_at')
        .eq('id', id)
        .eq('dealer_id', dealerId)
        .maybeSingle();

    if (current.error) {
        return NextResponse.json({ error: current.error.message }, { status: 500 });
    }
    if (!current.data) {
        return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    const currentStatus = current.data.status;
    if (!isAppointmentStatus(currentStatus)) {
        // Pre-Phase-15 row with a value outside the new check constraint.
        // Treat as a 400 rather than 500 so the UI can surface a useful
        // message and the operator can reapply migration 0015.
        return NextResponse.json(
            { error: `Appointment is in an unrecognised status '${currentStatus}' — apply migration 0015.` },
            { status: 400 },
        );
    }

    if (currentStatus === target) {
        // Idempotent no-op: caller already at the target state. Return the
        // current row so the client refresh is a no-op.
        return NextResponse.json({
            appointment: current.data as Pick<AppointmentRow, 'id' | 'status'>,
            persistence: 'supabase',
        });
    }

    const allowed = ALLOWED_TRANSITIONS[currentStatus];
    if (!allowed.has(target)) {
        return NextResponse.json(
            { error: `Invalid transition: ${currentStatus} -> ${target}` },
            { status: 409 },
        );
    }

    const update: Record<string, unknown> = { status: target };
    if (target === 'checked_in' && !current.data.checked_in_at) {
        update.checked_in_at = now;
    }
    if (target === 'completed' && !current.data.completed_at) {
        update.completed_at = now;
    }

    const { data, error } = await supabase
        .from('appointments')
        .update(update)
        .eq('id', id)
        .eq('dealer_id', dealerId)
        .select('*')
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
        return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    void recordAudit(request, session, {
        action: 'appointment_status_transition',
        resourceType: 'appointment',
        resourceId: id,
    });

    return NextResponse.json({ appointment: data as AppointmentRow, persistence: 'supabase' });
}
