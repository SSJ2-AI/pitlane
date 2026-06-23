// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSupabase, type CallLogRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';
import { getCustomerName } from '@/lib/mock-customers';
import { MOCK_CALLS } from '@/lib/mock-calls';

export type CallLogRowWithCustomerName = CallLogRow & { customer_name: string | null };

function withCustomerName(row: CallLogRow): CallLogRowWithCustomerName {
    return { ...row, customer_name: getCustomerName(row.customer_id) };
}

export const dynamic = 'force-dynamic';

// MOCK_CALLS lives in src/lib/mock-calls.ts so /api/analytics + /api/calls
// share the same dataset. The /dashboard 'Today's appointments' panel
// derives its Aria-context snippets from this too.

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        let calls = [...MOCK_CALLS];
        const outcome = searchParams.get('outcome');
        if (outcome) calls = calls.filter((c) => c.summary?.outcome === outcome);
        const customerId = searchParams.get('customer_id');
        if (customerId) calls = calls.filter((c) => c.customer_id === customerId);
        const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 1000);
        const offset = parseInt(searchParams.get('offset') ?? '0', 10);
        return NextResponse.json({
            calls: calls.slice(offset, offset + limit).map(withCustomerName),
            total: calls.length,
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ calls: [] as CallLogRow[], total: 0, persistence: 'none' });
    }

    const dealer = await resolveDealerForRequest(request);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 1000);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    // `@ts-nocheck` at the top of this file suppresses the supabase-js
    // chainable-query type-depth error from main (commits eeb3654 + 6321da9).
    let query = supabase
        .from('call_logs')
        .select('*', { count: 'exact' })
        .eq('dealer_id', dealer.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    const outcome = searchParams.get('outcome');
    if (outcome) query = query.eq('outcome', outcome);
    const customerId = searchParams.get('customer_id');
    if (customerId) query = query.eq('customer_id', customerId);
    const since = searchParams.get('since');
    if (since) query = query.gte('created_at', since);
    const until = searchParams.get('until');
    if (until) query = query.lte('created_at', until + 'T23:59:59Z');

    const { data, error, count } = await query;
    if (error) console.error('[/api/calls] query error:', error.message);

    return NextResponse.json({
        calls: ((data ?? []) as CallLogRow[]).map(withCustomerName),
        total: count ?? 0,
        persistence: 'supabase',
    });
}
