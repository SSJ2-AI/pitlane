import { NextResponse } from 'next/server';
import { getSupabase, type ServiceScheduleRow } from '@/lib/supabase';
import { resolveScopeForRequest } from '@/lib/dealer';
import { readSessionFromRequest } from '@/lib/role';
import { recordAudit } from '@/lib/audit';

// /api/manager/schedule
//
// Phase 13 — service-schedule template (weekly).
//
// GET   — any active staff scoped to a dealer. Returns 7 day rows (or
//         fewer if the schedule hasn't been seeded yet), ordered by
//         day_of_week 0..6.
// POST  — service_manager only. Body: { days: ScheduleUpsert[] }. Upserts
//         all 7 day rows in one shot. Writes a single
//         'save_service_schedule' audit_log entry.
//
// Server-side role validation is the load-bearing gate. Migration 0013
// also adds RLS for defense-in-depth.

export const dynamic = 'force-dynamic';

interface ScheduleUpsert {
    day_of_week: number;
    open_time: string;
    close_time: string;
    slot_duration_mins: number;
    max_concurrent_bookings: number;
    is_active: boolean;
}

interface ScheduleResponse {
    schedule: ServiceScheduleRow[];
    dealer_id: string | null;
    persistence: 'supabase' | 'mock';
}

function mockSchedule(dealerId: string): ServiceScheduleRow[] {
    const now = new Date().toISOString();
    return Array.from({ length: 7 }, (_, day) => ({
        id: `sched_mock_${day}`,
        dealer_id: dealerId,
        day_of_week: day,
        open_time: day === 0 ? '00:00' : '08:00',
        close_time: day === 0 ? '00:00' : day === 6 ? '14:00' : '18:00',
        slot_duration_mins: 60,
        max_concurrent_bookings: day === 0 ? 0 : 3,
        is_active: day !== 0,
        created_by: null,
        created_at: now,
        updated_at: now,
    }));
}

export async function GET(request: Request) {
    const scope = await resolveScopeForRequest(request);
    const dealerId = scope.dealerId ?? scope.dealer.id;

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        const payload: ScheduleResponse = {
            schedule: mockSchedule(dealerId),
            dealer_id: dealerId,
            persistence: 'mock',
        };
        return NextResponse.json(payload);
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({
            schedule: mockSchedule(dealerId),
            dealer_id: dealerId,
            persistence: 'mock',
        } satisfies ScheduleResponse);
    }

    const { data, error } = await supabase
        .from('service_schedule')
        .select('*')
        .eq('dealer_id', dealerId)
        .order('day_of_week', { ascending: true });

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({
                schedule: mockSchedule(dealerId),
                dealer_id: dealerId,
                persistence: 'mock',
            } satisfies ScheduleResponse);
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        schedule: (data ?? []) as ServiceScheduleRow[],
        dealer_id: dealerId,
        persistence: 'supabase',
    } satisfies ScheduleResponse);
}

export async function POST(request: Request) {
    const session = readSessionFromRequest(request);
    if (session.role !== 'service_manager') {
        return NextResponse.json(
            { error: 'Forbidden — only service managers can edit the schedule.' },
            { status: 403 },
        );
    }

    let body: { days?: ScheduleUpsert[] };
    try {
        body = (await request.json()) as { days?: ScheduleUpsert[] };
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const days = Array.isArray(body.days) ? body.days : [];
    if (days.length === 0) {
        return NextResponse.json({ error: 'days[] is required' }, { status: 400 });
    }
    for (const d of days) {
        if (typeof d.day_of_week !== 'number' || d.day_of_week < 0 || d.day_of_week > 6) {
            return NextResponse.json({ error: 'day_of_week must be 0..6' }, { status: 400 });
        }
    }

    const scope = await resolveScopeForRequest(request);
    const dealerId = scope.dealerId ?? scope.dealer.id;
    if (!dealerId) {
        return NextResponse.json({ error: 'Manager has no dealer scope.' }, { status: 400 });
    }

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        const now = new Date().toISOString();
        return NextResponse.json({
            schedule: days.map<ServiceScheduleRow>((d) => ({
                id: `sched_mock_${d.day_of_week}`,
                dealer_id: dealerId,
                day_of_week: d.day_of_week,
                open_time: d.open_time,
                close_time: d.close_time,
                slot_duration_mins: d.slot_duration_mins,
                max_concurrent_bookings: d.max_concurrent_bookings,
                is_active: d.is_active,
                created_by: session.userId,
                created_at: now,
                updated_at: now,
            })),
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const upsertRows = days.map((d) => ({
        dealer_id: dealerId,
        day_of_week: d.day_of_week,
        open_time: d.open_time,
        close_time: d.close_time,
        slot_duration_mins: d.slot_duration_mins,
        max_concurrent_bookings: d.max_concurrent_bookings,
        is_active: d.is_active,
        created_by: session.userId,
        updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
        .from('service_schedule')
        .upsert(upsertRows, { onConflict: 'dealer_id,day_of_week' })
        .select('*');

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json(
                { error: 'service_schedule table missing — apply migration 0013' },
                { status: 503 },
            );
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'save_service_schedule',
        resourceType: 'service_schedule',
        resourceId: dealerId,
    });

    return NextResponse.json({
        schedule: (data ?? []) as ServiceScheduleRow[],
        persistence: 'supabase',
    });
}
