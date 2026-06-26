import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { readSessionFromRequest, type PitLaneSession } from '@/lib/role';
import { getSupabase, type ServiceScheduleRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type ScheduleInput = {
    day_of_week?: number;
    open_time?: string;
    close_time?: string;
    slot_duration_mins?: number;
    max_concurrent_bookings?: number;
    is_active?: boolean;
};

function dealerIdFromHeaders(session: PitLaneSession): string | null {
    return session.dealerId || null;
}

function isAuthenticatedStaff(session: PitLaneSession): boolean {
    return Boolean(session.userId || process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true');
}

function normalizeTime(value: unknown, fallback: string): string {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return /^\d{2}:\d{2}(:\d{2})?$/.test(trimmed) ? trimmed.slice(0, 5) : fallback;
}

function normalizeDay(input: ScheduleInput, dealerId: string, userId: string | null): Omit<ServiceScheduleRow, 'id' | 'created_at' | 'updated_at'> {
    if (typeof input.day_of_week !== 'number' || input.day_of_week < 0 || input.day_of_week > 6) {
        throw new Error('Each schedule row must include day_of_week 0-6.');
    }
    const slotDuration = Number(input.slot_duration_mins ?? 60);
    const maxConcurrent = Number(input.max_concurrent_bookings ?? 3);
    if (![30, 60, 90].includes(slotDuration)) {
        throw new Error('slot_duration_mins must be 30, 60, or 90.');
    }
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
        throw new Error('max_concurrent_bookings must be at least 1.');
    }
    return {
        dealer_id: dealerId,
        day_of_week: input.day_of_week,
        open_time: normalizeTime(input.open_time, '08:00'),
        close_time: normalizeTime(input.close_time, '18:00'),
        slot_duration_mins: slotDuration,
        max_concurrent_bookings: maxConcurrent,
        is_active: input.is_active !== false,
        created_by: userId,
    };
}

function mockSchedule(dealerId: string): ServiceScheduleRow[] {
    const now = new Date().toISOString();
    return Array.from({ length: 7 }, (_, day) => ({
        id: `schedule_mock_${day}`,
        dealer_id: dealerId,
        day_of_week: day,
        open_time: day === 0 ? '10:00' : '08:00',
        close_time: day === 0 ? '16:00' : '18:00',
        slot_duration_mins: 60,
        max_concurrent_bookings: 3,
        is_active: day !== 0,
        created_by: null,
        created_at: now,
        updated_at: now,
    }));
}

export async function GET(request: Request) {
    const session = readSessionFromRequest(request);
    if (!isAuthenticatedStaff(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const dealerId = dealerIdFromHeaders(session);
    if (!dealerId) {
        return NextResponse.json({ error: 'x-pitlane-dealer header is required' }, { status: 400 });
    }

    const supabase = getSupabase();
    if (!supabase || process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ schedule: mockSchedule(dealerId), persistence: 'mock' });
    }

    const { data, error } = await supabase
        .from('service_schedule')
        .select('*')
        .eq('dealer_id', dealerId)
        .order('day_of_week', { ascending: true });

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ schedule: [], persistence: 'supabase_pending_migration' });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ schedule: (data ?? []) as ServiceScheduleRow[], persistence: 'supabase' });
}

export async function POST(request: Request) {
    const session = readSessionFromRequest(request);
    if (session.role !== 'service_manager') {
        return NextResponse.json({ error: 'Forbidden — service managers only.' }, { status: 403 });
    }
    const dealerId = dealerIdFromHeaders(session);
    if (!dealerId) {
        return NextResponse.json({ error: 'x-pitlane-dealer header is required' }, { status: 400 });
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!Array.isArray(body) || body.length !== 7) {
        return NextResponse.json({ error: 'Expected an array of 7 day configs.' }, { status: 400 });
    }

    let rows: Array<Omit<ServiceScheduleRow, 'id' | 'created_at' | 'updated_at'>>;
    try {
        rows = body.map((row) => normalizeDay(row as ScheduleInput, dealerId, session.userId));
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid schedule config' }, { status: 400 });
    }

    const supabase = getSupabase();
    if (!supabase || process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        const now = new Date().toISOString();
        return NextResponse.json({
            schedule: rows.map((row) => ({ id: `schedule_mock_${row.day_of_week}`, ...row, created_at: now, updated_at: now })),
            persistence: 'mock',
        });
    }

    const { data, error } = await supabase
        .from('service_schedule')
        .upsert(rows, { onConflict: 'dealer_id,day_of_week' })
        .select('*')
        .order('day_of_week', { ascending: true });

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ error: 'service_schedule table missing — apply migration 0013' }, { status: 503 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'update_service_schedule',
        resourceType: 'service_schedule',
        resourceId: dealerId,
    });

    return NextResponse.json({ schedule: (data ?? []) as ServiceScheduleRow[], persistence: 'supabase' });
}
