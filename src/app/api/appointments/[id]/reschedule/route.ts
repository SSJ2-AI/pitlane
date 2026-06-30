import { NextResponse } from 'next/server';
import { getSupabase, type AppointmentRow } from '@/lib/supabase';
import { resolveScopeForRequest } from '@/lib/dealer';
import { recordAudit } from '@/lib/audit';

interface RouteContext {
    params: { id: string };
}

function isIsoDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime());
}

function normalizeTime(value: string): string | null {
    const trimmed = value.trim();
    if (/^\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00`;
    if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
    return null;
}

export async function PATCH(request: Request, context: RouteContext) {
    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const scope = await resolveScopeForRequest(request);
    const session = scope.session;
    if (session.role !== 'service_advisor' && session.role !== 'service_manager') {
        return NextResponse.json(
            { error: 'Forbidden — only service advisors/managers can reschedule appointments.' },
            { status: 403 },
        );
    }

    const dealerId = scope.dealerId ?? scope.dealer.id;
    if (!dealerId) {
        return NextResponse.json({ error: 'No dealer scope for this session.' }, { status: 400 });
    }

    let body: { new_date?: string; new_time?: string };
    try {
        body = (await request.json()) as { new_date?: string; new_time?: string };
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const newDate = body.new_date?.trim() ?? '';
    const normalizedTime = body.new_time ? normalizeTime(body.new_time) : null;
    if (!isIsoDate(newDate)) {
        return NextResponse.json({ error: 'new_date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (!normalizedTime) {
        return NextResponse.json({ error: 'new_time must be HH:MM or HH:MM:SS' }, { status: 400 });
    }

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        const now = new Date().toISOString();
        return NextResponse.json({
            appointment: {
                id,
                dealer_id: dealerId,
                date: newDate,
                time: normalizedTime,
                scheduled_date: newDate,
                scheduled_time: normalizedTime,
                rescheduled_from: id,
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

    const primaryUpdate: Record<string, unknown> = {
        scheduled_date: newDate,
        scheduled_time: normalizedTime,
        date: newDate,
        time: normalizedTime,
        rescheduled_from: current.id,
    };

    let updateRes = await supabase
        .from('appointments')
        .update(primaryUpdate)
        .eq('id', id)
        .eq('dealer_id', dealerId)
        .select('*')
        .single();

    // Legacy schema fallback when scheduled_date/scheduled_time do not exist.
    if (updateRes.error && (updateRes.error as { code?: string }).code === '42703') {
        updateRes = await supabase
            .from('appointments')
            .update({
                date: newDate,
                time: normalizedTime,
                rescheduled_from: current.id,
            })
            .eq('id', id)
            .eq('dealer_id', dealerId)
            .select('*')
            .single();
    }

    if (updateRes.error) {
        const code = (updateRes.error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json(
                { error: 'appointments table missing — apply migration 0015' },
                { status: 503 },
            );
        }
        return NextResponse.json({ error: updateRes.error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'reschedule_appointment',
        resourceType: 'appointment',
        resourceId: id,
    });

    return NextResponse.json({ appointment: updateRes.data, persistence: 'supabase' });
}
