import { NextResponse } from 'next/server';
import { DEFAULT_DEALER_ID } from '@/lib/dealer';
import { recordAudit } from '@/lib/audit';
import { readSessionFromRequest } from '@/lib/role';
import { getSupabase, type ServiceScheduleRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface DayConfigInput {
    day_of_week: number;
    open_time?: string;
    close_time?: string;
    slot_duration_mins?: number;
    max_concurrent_bookings?: number;
    is_active?: boolean;
}

function resolveScopedDealerId(request: Request): string | null {
    const headerDealer = request.headers.get('x-pitlane-dealer');
    if (headerDealer && headerDealer.trim().length > 0) return headerDealer.trim();
    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') return DEFAULT_DEALER_ID;
    return null;
}

function hasRoleHeader(request: Request): boolean {
    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') return true;
    return Boolean(request.headers.get('x-pitlane-role'));
}

export async function GET(request: Request) {
    if (!hasRoleHeader(request)) {
        return NextResponse.json({ error: 'Unauthorized — missing x-pitlane-role header' }, { status: 401 });
    }

    const dealerId = resolveScopedDealerId(request);
    if (!dealerId) {
        return NextResponse.json({ error: 'Missing x-pitlane-dealer header' }, { status: 400 });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ schedules: [] as ServiceScheduleRow[], persistence: 'mock' });
    }

    const { data, error } = await supabase
        .from('service_schedule')
        .select('*')
        .eq('dealer_id', dealerId)
        .order('day_of_week', { ascending: true });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ schedules: (data ?? []) as ServiceScheduleRow[], persistence: 'supabase' });
}

export async function POST(request: Request) {
    if (!hasRoleHeader(request)) {
        return NextResponse.json({ error: 'Unauthorized — missing x-pitlane-role header' }, { status: 401 });
    }

    const session = readSessionFromRequest(request);
    if (session.role !== 'service_manager') {
        return NextResponse.json({ error: 'Forbidden — service_manager role required' }, { status: 403 });
    }

    const dealerId = resolveScopedDealerId(request);
    if (!dealerId) {
        return NextResponse.json({ error: 'Missing x-pitlane-dealer header' }, { status: 400 });
    }

    let body: DayConfigInput[];
    try {
        body = await request.json() as DayConfigInput[];
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!Array.isArray(body) || body.length !== 7) {
        return NextResponse.json({ error: 'Expected an array of 7 day configs' }, { status: 400 });
    }

    const seen = new Set<number>();
    let rows: Array<Record<string, unknown>>;
    try {
        rows = body.map((row) => {
            if (!Number.isInteger(row.day_of_week) || row.day_of_week < 0 || row.day_of_week > 6) {
                throw new Error(`Invalid day_of_week: ${row.day_of_week}`);
            }
            if (seen.has(row.day_of_week)) {
                throw new Error(`Duplicate day_of_week: ${row.day_of_week}`);
            }
            seen.add(row.day_of_week);
            return {
                dealer_id: dealerId,
                day_of_week: row.day_of_week,
                open_time: row.open_time ?? '08:00',
                close_time: row.close_time ?? '18:00',
                slot_duration_mins: row.slot_duration_mins ?? 60,
                max_concurrent_bookings: row.max_concurrent_bookings ?? 3,
                is_active: row.is_active ?? true,
                created_by: session.userId ?? null,
                updated_at: new Date().toISOString(),
            };
        });
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid schedule payload' }, { status: 400 });
    }

    if (seen.size !== 7) {
        return NextResponse.json({ error: 'All day_of_week values (0-6) must be present exactly once' }, { status: 400 });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    try {
        const { data, error } = await supabase
            .from('service_schedule')
            .upsert(rows, { onConflict: 'dealer_id,day_of_week' })
            .select('*');

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        void recordAudit(request, session, {
            action: 'update_service_schedule',
            resourceType: 'service_schedule',
            resourceId: dealerId,
        });

        const sorted = ((data ?? []) as ServiceScheduleRow[]).sort((a, b) => a.day_of_week - b.day_of_week);
        return NextResponse.json({ schedules: sorted, persistence: 'supabase' });
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save schedule' }, { status: 400 });
    }
}
