import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { resolveScopeForRequest } from '@/lib/dealer';
import { readSessionFromRequest } from '@/lib/role';
import { getSupabase, type AppointmentRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface RouteContext {
    params: { id: string };
}

function isDeskRole(role: string): boolean {
    return role === 'service_advisor' || role === 'service_manager';
}

function isDateString(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimeString(value: string): boolean {
    if (!/^\d{2}:\d{2}:\d{2}$/.test(value)) return false;
    const [hh, mm, ss] = value.split(':').map(Number);
    return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59 && ss >= 0 && ss <= 59;
}

export async function PATCH(request: Request, context: RouteContext) {
    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const mockMode = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';
    const session = readSessionFromRequest(request);
    if (!mockMode && (!session.userId || !session.dealerId)) {
        return NextResponse.json({ error: 'Unauthenticated appointment reschedule request.' }, { status: 401 });
    }
    if (!isDeskRole(session.role)) {
        return NextResponse.json(
            { error: 'Forbidden — only service advisors and service managers can reschedule appointments.' },
            { status: 403 },
        );
    }

    let body: { new_date?: string; new_time?: string };
    try {
        body = (await request.json()) as { new_date?: string; new_time?: string };
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.new_date || !isDateString(body.new_date)) {
        return NextResponse.json({ error: 'new_date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (!body.new_time || !isTimeString(body.new_time)) {
        return NextResponse.json({ error: 'new_time must be HH:MM:SS' }, { status: 400 });
    }

    const scope = await resolveScopeForRequest(request);
    const dealerId = scope.dealerId ?? scope.dealer.id;
    if (!dealerId) {
        return NextResponse.json({ error: 'Appointment reschedule requires a dealer scope.' }, { status: 403 });
    }

    if (mockMode) {
        return NextResponse.json({
            appointment: {
                id,
                dealer_id: dealerId,
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

    const appointment = current as AppointmentRow;
    if (appointment.status === 'completed' || appointment.status === 'cancelled') {
        return NextResponse.json(
            { error: `Cannot reschedule a ${appointment.status} appointment` },
            { status: 409 },
        );
    }

    const originalAppointmentId = appointment.rescheduled_from ?? appointment.id;
    const { data, error } = await supabase
        .from('appointments')
        .update({
            date: body.new_date,
            time: body.new_time,
            rescheduled_from: originalAppointmentId,
        })
        .eq('id', id)
        .eq('dealer_id', dealerId)
        .select('*')
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'reschedule_appointment',
        resourceType: 'appointment',
        resourceId: id,
    });

    return NextResponse.json({ appointment: data as AppointmentRow, persistence: 'supabase' });
}
