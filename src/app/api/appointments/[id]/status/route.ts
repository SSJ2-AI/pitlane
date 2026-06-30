import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { resolveScopeForRequest } from '@/lib/dealer';
import { readSessionFromRequest } from '@/lib/role';
import { getSupabase, type AppointmentRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type AppointmentStatus = 'confirmed' | 'checked_in' | 'in_progress' | 'completed' | 'cancelled';
type ActionStatus = Exclude<AppointmentStatus, 'confirmed'>;

const ACTION_STATUSES = new Set<ActionStatus>(['checked_in', 'in_progress', 'completed', 'cancelled']);
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, ActionStatus[]> = {
    confirmed: ['checked_in', 'cancelled'],
    checked_in: ['in_progress', 'completed', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
};

interface RouteContext {
    params: { id: string };
}

function isDeskRole(role: string): boolean {
    return role === 'service_advisor' || role === 'service_manager';
}

function normaliseStatus(input: string): AppointmentStatus | null {
    // Legacy rows are normalized by migration 0015; this keeps the route safe
    // during rolling deploys where old data may still exist briefly.
    if (input === 'scheduled') return 'confirmed';
    if (input === 'confirmed' || input === 'checked_in' || input === 'in_progress' || input === 'completed' || input === 'cancelled') {
        return input;
    }
    return null;
}

export async function PATCH(request: Request, context: RouteContext) {
    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const mockMode = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';
    const session = readSessionFromRequest(request);
    if (!mockMode && (!session.userId || !session.dealerId)) {
        return NextResponse.json({ error: 'Unauthenticated appointment action request.' }, { status: 401 });
    }
    if (!isDeskRole(session.role)) {
        return NextResponse.json(
            { error: 'Forbidden — only service advisors and service managers can action appointments.' },
            { status: 403 },
        );
    }

    let body: { status?: string };
    try {
        body = (await request.json()) as { status?: string };
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.status || !ACTION_STATUSES.has(body.status as ActionStatus)) {
        return NextResponse.json(
            { error: 'status must be one of checked_in, in_progress, completed, cancelled' },
            { status: 400 },
        );
    }
    const nextStatus = body.status as ActionStatus;

    const scope = await resolveScopeForRequest(request);
    const dealerId = scope.dealerId ?? scope.dealer.id;
    if (!dealerId) {
        return NextResponse.json({ error: 'Appointment action requires a dealer scope.' }, { status: 403 });
    }

    const now = new Date().toISOString();

    if (mockMode) {
        const currentStatus: AppointmentStatus = 'confirmed';
        if (!ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus)) {
            return NextResponse.json(
                { error: `Invalid status transition ${currentStatus} -> ${nextStatus}` },
                { status: 409 },
            );
        }
        return NextResponse.json({
            appointment: {
                id,
                dealer_id: dealerId,
                status: nextStatus,
                checked_in_at: nextStatus === 'checked_in' ? now : null,
                completed_at: nextStatus === 'completed' ? now : null,
            },
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const { data: current, error: fetchError } = await supabase
        .from('appointments')
        .select('*')
        .eq('id', id)
        .eq('dealer_id', dealerId)
        .maybeSingle();

    if (fetchError) {
        const code = (fetchError as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json(
                { error: 'appointments table missing — apply migration 0001' },
                { status: 503 },
            );
        }
        return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!current) {
        return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    const currentStatus = normaliseStatus((current as AppointmentRow).status);
    if (!currentStatus) {
        return NextResponse.json({ error: `Unsupported current appointment status: ${(current as AppointmentRow).status}` }, { status: 409 });
    }
    if (!ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus)) {
        return NextResponse.json(
            { error: `Invalid status transition ${currentStatus} -> ${nextStatus}` },
            { status: 409 },
        );
    }

    const update: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === 'checked_in') update.checked_in_at = now;
    if (nextStatus === 'completed') update.completed_at = now;

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

    void recordAudit(request, session, {
        action: 'update_appointment_status',
        resourceType: 'appointment',
        resourceId: id,
    });

    return NextResponse.json({ appointment: data as AppointmentRow, persistence: 'supabase' });
}
