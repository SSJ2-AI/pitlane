import { NextResponse } from 'next/server';
import { getSupabase, type ScheduleOverrideRow } from '@/lib/supabase';
import { resolveScopeForRequest } from '@/lib/dealer';
import { readSessionFromRequest } from '@/lib/role';
import { recordAudit } from '@/lib/audit';

// /api/manager/schedule/overrides
//
// Phase 13 — date-specific schedule exceptions (holidays, training,
// custom hours).
//
// GET   — upcoming overrides (override_date >= today), any active staff
//         of the dealer.
// POST  — service_manager only. Body: { override_date, is_blocked,
//         reason?, open_time?, close_time?, max_concurrent_bookings? }.

export const dynamic = 'force-dynamic';

interface OverrideInsert {
    override_date: string;
    is_blocked: boolean;
    reason?: string | null;
    open_time?: string | null;
    close_time?: string | null;
    max_concurrent_bookings?: number | null;
}

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

export async function GET(request: Request) {
    const scope = await resolveScopeForRequest(request);
    const dealerId = scope.dealerId ?? scope.dealer.id;

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ overrides: [] as ScheduleOverrideRow[], persistence: 'mock' });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ overrides: [] as ScheduleOverrideRow[], persistence: 'mock' });
    }

    const { data, error } = await supabase
        .from('schedule_overrides')
        .select('*')
        .eq('dealer_id', dealerId)
        .gte('override_date', todayIso())
        .order('override_date', { ascending: true });

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ overrides: [] as ScheduleOverrideRow[], persistence: 'mock' });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        overrides: (data ?? []) as ScheduleOverrideRow[],
        persistence: 'supabase',
    });
}

export async function POST(request: Request) {
    const session = readSessionFromRequest(request);
    if (session.role !== 'service_manager') {
        return NextResponse.json(
            { error: 'Forbidden — only service managers can edit schedule overrides.' },
            { status: 403 },
        );
    }

    let body: OverrideInsert;
    try {
        body = (await request.json()) as OverrideInsert;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body.override_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.override_date)) {
        return NextResponse.json({ error: 'override_date (YYYY-MM-DD) is required' }, { status: 400 });
    }

    const scope = await resolveScopeForRequest(request);
    const dealerId = scope.dealerId ?? scope.dealer.id;
    if (!dealerId) {
        return NextResponse.json({ error: 'Manager has no dealer scope.' }, { status: 400 });
    }

    const row = {
        dealer_id: dealerId,
        override_date: body.override_date,
        is_blocked: Boolean(body.is_blocked),
        reason: body.reason ?? null,
        open_time: body.open_time ?? null,
        close_time: body.close_time ?? null,
        max_concurrent_bookings: body.max_concurrent_bookings ?? null,
        created_by: session.userId,
    };

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({
            override: {
                ...row,
                id: `ovr_mock_${Date.now().toString(36)}`,
                created_at: new Date().toISOString(),
            } satisfies ScheduleOverrideRow,
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

    const { data, error } = await supabase
        .from('schedule_overrides')
        .upsert(row, { onConflict: 'dealer_id,override_date' })
        .select('*')
        .single();

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json(
                { error: 'schedule_overrides table missing — apply migration 0013' },
                { status: 503 },
            );
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const created = data as ScheduleOverrideRow;
    void recordAudit(request, session, {
        action: 'create_schedule_override',
        resourceType: 'schedule_override',
        resourceId: created.id,
    });

    return NextResponse.json({ override: created, persistence: 'supabase' });
}
