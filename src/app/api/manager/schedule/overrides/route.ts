import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { readSessionFromRequest, type PitLaneSession } from '@/lib/role';
import { getSupabase, type ScheduleOverrideRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type OverrideInput = {
    override_date?: string;
    is_blocked?: boolean;
    reason?: string | null;
    open_time?: string | null;
    close_time?: string | null;
    max_concurrent_bookings?: number | null;
};

function dealerIdFromHeaders(session: PitLaneSession): string | null {
    return session.dealerId || null;
}

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

function isIsoDate(value: string | undefined): value is string {
    return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function normalizeTime(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return /^\d{2}:\d{2}(:\d{2})?$/.test(trimmed) ? trimmed.slice(0, 5) : null;
}

function mockOverrides(dealerId: string): ScheduleOverrideRow[] {
    return [{
        id: 'override_mock_closed',
        dealer_id: dealerId,
        override_date: todayIso(),
        is_blocked: true,
        reason: 'Demo closure',
        open_time: null,
        close_time: null,
        max_concurrent_bookings: null,
        created_by: null,
        created_at: new Date().toISOString(),
    }];
}

export async function GET(request: Request) {
    const session = readSessionFromRequest(request);
    if (!session.userId && process.env.NEXT_PUBLIC_USE_MOCK_DATA !== 'true') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const dealerId = dealerIdFromHeaders(session);
    if (!dealerId) {
        return NextResponse.json({ error: 'x-pitlane-dealer header is required' }, { status: 400 });
    }

    const supabase = getSupabase();
    if (!supabase || process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ overrides: mockOverrides(dealerId), persistence: 'mock' });
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
            return NextResponse.json({ overrides: [], persistence: 'supabase_pending_migration' });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ overrides: (data ?? []) as ScheduleOverrideRow[], persistence: 'supabase' });
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

    let body: OverrideInput;
    try {
        body = (await request.json()) as OverrideInput;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!isIsoDate(body.override_date)) {
        return NextResponse.json({ error: 'override_date must be YYYY-MM-DD.' }, { status: 400 });
    }
    const isBlocked = body.is_blocked === true;
    const openTime = isBlocked ? null : normalizeTime(body.open_time);
    const closeTime = isBlocked ? null : normalizeTime(body.close_time);
    if (!isBlocked && (!openTime || !closeTime)) {
        return NextResponse.json({ error: 'Custom hours require open_time and close_time.' }, { status: 400 });
    }
    const maxConcurrent = body.max_concurrent_bookings == null ? null : Number(body.max_concurrent_bookings);
    if (maxConcurrent !== null && (!Number.isInteger(maxConcurrent) || maxConcurrent < 1)) {
        return NextResponse.json({ error: 'max_concurrent_bookings must be at least 1.' }, { status: 400 });
    }

    const insert = {
        dealer_id: dealerId,
        override_date: body.override_date,
        is_blocked: isBlocked,
        reason: typeof body.reason === 'string' ? body.reason.trim() || null : null,
        open_time: openTime,
        close_time: closeTime,
        max_concurrent_bookings: maxConcurrent,
        created_by: session.userId,
    };

    const supabase = getSupabase();
    if (!supabase || process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({
            override: { id: `override_mock_${Date.now().toString(36)}`, ...insert, created_at: new Date().toISOString() },
            persistence: 'mock',
        });
    }

    const { data, error } = await supabase
        .from('schedule_overrides')
        .upsert(insert, { onConflict: 'dealer_id,override_date' })
        .select('*')
        .single();

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ error: 'schedule_overrides table missing — apply migration 0013' }, { status: 503 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'create_schedule_override',
        resourceType: 'schedule_override',
        resourceId: (data as ScheduleOverrideRow | null)?.id ?? null,
    });

    return NextResponse.json({ override: data as ScheduleOverrideRow, persistence: 'supabase' });
}
