import { NextResponse } from 'next/server';
import { getSupabase, type AppointmentRow } from '@/lib/supabase';
import { resolveScopeForRequest } from '@/lib/dealer';
import { readSessionFromRequest } from '@/lib/role';
import { recordAudit } from '@/lib/audit';

// PATCH /api/appointments/:id/reschedule
//   body: { new_date: 'YYYY-MM-DD', new_time: 'HH:MM:SS' }
//
// Moves an existing appointment to a new slot in-place. Stamps the row's
// rescheduled_from column with its own id so the audit trail can tell a
// fresh booking apart from a reschedule. The appointments table uses
// columns `date` + `time` (see migration 0001) which carry the canonical
// scheduled date/time; we update those fields here.
//
// Role-gated identically to the status route: service_advisor /
// service_manager of the same dealer. group_manager is read-only.

export const dynamic = 'force-dynamic';

interface RouteContext {
    params: { id: string };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Accept HH:MM or HH:MM:SS — Postgres `time` accepts either form; the UI
// supplies HH:MM from a `<input type="time">`.
const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

export async function PATCH(request: Request, context: RouteContext) {
    const session = readSessionFromRequest(request);
    if (session.role !== 'service_advisor' && session.role !== 'service_manager') {
        return NextResponse.json(
            { error: 'Forbidden — only service advisors and managers can reschedule appointments.' },
            { status: 403 },
        );
    }

    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    let body: { new_date?: unknown; new_time?: unknown };
    try {
        body = (await request.json()) as { new_date?: unknown; new_time?: unknown };
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (typeof body.new_date !== 'string' || !DATE_PATTERN.test(body.new_date)) {
        return NextResponse.json({ error: 'new_date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (typeof body.new_time !== 'string' || !TIME_PATTERN.test(body.new_time)) {
        return NextResponse.json({ error: 'new_time must be HH:MM or HH:MM:SS' }, { status: 400 });
    }

    const scope = await resolveScopeForRequest(request);
    const dealerId = scope.dealerId ?? scope.dealer.id;

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({
            appointment: {
                id,
                date: body.new_date,
                time: body.new_time,
                rescheduled_from: id,
            },
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const { data, error } = await supabase
        .from('appointments')
        .update({
            date: body.new_date,
            time: body.new_time,
            rescheduled_from: id,
        })
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
        action: 'appointment_rescheduled',
        resourceType: 'appointment',
        resourceId: id,
    });

    return NextResponse.json({ appointment: data as AppointmentRow, persistence: 'supabase' });
}
