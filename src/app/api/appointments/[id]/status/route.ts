import { NextResponse } from 'next/server';
import { getSupabase, type AppointmentRow } from '@/lib/supabase';
import { resolveScopeForRequest } from '@/lib/dealer';
import { recordAudit } from '@/lib/audit';

type AppointmentStatus = 'confirmed' | 'checked_in' | 'in_progress' | 'completed' | 'cancelled';

const ALLOWED_STATUSES: AppointmentStatus[] = [
    'checked_in',
    'in_progress',
    'completed',
    'cancelled',
];

const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
    confirmed: ['checked_in', 'cancelled'],
    checked_in: ['in_progress', 'completed', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
};

interface RouteContext {
    params: { id: string };
}

function isStatus(input: string): input is AppointmentStatus {
    return (ALLOWED_STATUSES as string[]).includes(input);
}

function canTransition(from: string, to: AppointmentStatus): boolean {
    const next = ALLOWED_TRANSITIONS[from as AppointmentStatus];
    return Array.isArray(next) && next.includes(to);
}

export async function PATCH(request: Request, context: RouteContext) {
    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const scope = await resolveScopeForRequest(request);
    const session = scope.session;
    if (session.role !== 'service_advisor' && session.role !== 'service_manager') {
        return NextResponse.json(
            { error: 'Forbidden — only service advisors/managers can update appointment status.' },
            { status: 403 },
        );
    }

    const dealerId = scope.dealerId ?? scope.dealer.id;
    if (!dealerId) {
        return NextResponse.json({ error: 'No dealer scope for this session.' }, { status: 400 });
    }

    let body: { status?: string };
    try {
        body = (await request.json()) as { status?: string };
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.status || !isStatus(body.status)) {
        return NextResponse.json(
            { error: `status must be one of ${ALLOWED_STATUSES.join(', ')}` },
            { status: 400 },
        );
    }

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        const now = new Date().toISOString();
        const checkedInAt = body.status === 'checked_in' ? now : null;
        const completedAt = body.status === 'completed' ? now : null;
        return NextResponse.json({
            appointment: {
                id,
                dealer_id: dealerId,
                status: body.status,
                checked_in_at: checkedInAt,
                completed_at: completedAt,
                updated_at: now,
            },
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const currentRes = await supabase
        .from('appointments')
        .select('*')
        .eq('id', id)
        .eq('dealer_id', dealerId)
        .maybeSingle();

    if (currentRes.error) {
        const code = (currentRes.error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json(
                { error: 'appointments table missing — apply migration 0015' },
                { status: 503 },
            );
        }
        return NextResponse.json({ error: currentRes.error.message }, { status: 500 });
    }

    const current = currentRes.data as AppointmentRow | null;
    if (!current) {
        return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    if (!canTransition(current.status, body.status)) {
        return NextResponse.json(
            { error: `Invalid transition: ${current.status} -> ${body.status}` },
            { status: 400 },
        );
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = { status: body.status };
    if (body.status === 'checked_in') update.checked_in_at = now;
    if (body.status === 'completed') update.completed_at = now;

    const { data, error } = await supabase
        .from('appointments')
        .update(update)
        .eq('id', id)
        .eq('dealer_id', dealerId)
        .select('*')
        .single();

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json(
                { error: 'appointments table missing — apply migration 0015' },
                { status: 503 },
            );
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'update_appointment_status',
        resourceType: 'appointment',
        resourceId: id,
    });

    return NextResponse.json({ appointment: data, persistence: 'supabase' });
}
