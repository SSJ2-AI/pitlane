import { NextResponse } from 'next/server';
import { DEFAULT_DEALER_ID } from '@/lib/dealer';
import { recordAudit } from '@/lib/audit';
import { readSessionFromRequest } from '@/lib/role';
import { getSupabase, type ScheduleOverrideRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface OverrideInput {
    override_date?: string;
    is_blocked?: boolean;
    reason?: string | null;
    open_time?: string | null;
    close_time?: string | null;
    max_concurrent_bookings?: number | null;
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

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
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
        return NextResponse.json({ overrides: [] as ScheduleOverrideRow[], persistence: 'mock' });
    }

    const { data, error } = await supabase
        .from('schedule_overrides')
        .select('*')
        .eq('dealer_id', dealerId)
        .gte('override_date', todayIso())
        .order('override_date', { ascending: true });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ overrides: (data ?? []) as ScheduleOverrideRow[], persistence: 'supabase' });
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

    let body: OverrideInput;
    try {
        body = await request.json() as OverrideInput;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.override_date) {
        return NextResponse.json({ error: 'override_date is required' }, { status: 400 });
    }

    if (body.is_blocked === false && (!body.open_time || !body.close_time)) {
        return NextResponse.json({ error: 'open_time and close_time are required for custom-hour overrides' }, { status: 400 });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const { data, error } = await supabase
        .from('schedule_overrides')
        .insert({
            dealer_id: dealerId,
            override_date: body.override_date,
            is_blocked: body.is_blocked ?? false,
            reason: body.reason ?? null,
            open_time: body.is_blocked ? null : (body.open_time ?? null),
            close_time: body.is_blocked ? null : (body.close_time ?? null),
            max_concurrent_bookings: body.max_concurrent_bookings ?? null,
            created_by: session.userId ?? null,
        })
        .select('*')
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'create_schedule_override',
        resourceType: 'schedule_override',
        resourceId: (data as { id?: string } | null)?.id ?? null,
    });

    return NextResponse.json({ override: data as ScheduleOverrideRow, persistence: 'supabase' });
}
