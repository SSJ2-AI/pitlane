import { NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured, type CallLogRow } from '@/lib/supabase';

// GET /api/calls
//   ?customer_id=cust_001          filter by customer
//   ?outcome=appointment_booked    filter by summary.outcome
//   ?since=2026-06-01              start date inclusive (YYYY-MM-DD)
//   ?until=2026-06-30              end date inclusive (YYYY-MM-DD)
//   ?limit=50                      page size (default 50, max 200)
//   ?offset=0                      pagination offset
//
// Returns: { calls: CallLogRow[], total: number, persistence: 'supabase' | 'none' }
//
// When Supabase isn't configured we return an empty list rather than erroring,
// so the dashboard's /calls page renders an empty state instead of an HTTP
// failure.

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function GET(request: Request) {
    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ calls: [], total: 0, persistence: 'none' as const });
    }

    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customer_id')?.trim() || undefined;
    const outcome = searchParams.get('outcome')?.trim() || undefined;
    const since = searchParams.get('since')?.trim() || undefined;
    const until = searchParams.get('until')?.trim() || undefined;

    const rawLimit = Number(searchParams.get('limit') ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;
    const offset = Math.max(0, Number(searchParams.get('offset') ?? 0)) || 0;

    let query = supabase
        .from('call_logs')
        .select('*', { count: 'exact' })
        .order('started_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (customerId) query = query.eq('customer_id', customerId);
    if (outcome) query = query.eq('summary->>outcome', outcome);
    if (since) query = query.gte('started_at', `${since}T00:00:00Z`);
    if (until) query = query.lte('started_at', `${until}T23:59:59Z`);

    const { data, error, count } = await query;
    if (error) {
        console.error('[/api/calls] query failed:', error.message);
        return NextResponse.json(
            { calls: [], total: 0, error: error.message, persistence: 'supabase' as const },
            { status: 500 },
        );
    }

    return NextResponse.json({
        calls: (data ?? []) as CallLogRow[],
        total: count ?? data?.length ?? 0,
        persistence: 'supabase' as const,
        filters: { customer_id: customerId, outcome, since, until, limit, offset },
        configured: isSupabaseConfigured(),
    });
}
