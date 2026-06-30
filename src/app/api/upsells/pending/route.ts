// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSupabase, type UpsellRow } from '@/lib/supabase';
import { resolveScopeForRequest } from '@/lib/dealer';
import { enrichMockUpsells, enrichSupabaseUpsells } from '@/lib/upsell-context';

export const dynamic = 'force-dynamic';

const MOCK_UPSELLS: UpsellRow[] = [
    {
        id: 'ups_001',
        call_log_id: 'call_001',
        customer_id: 'cust_001',
        dealer_id: 'dealer_porsche_toronto',
        vehicle_id: 'veh_001a',
        upsell_type: 'brake_replacement',
        description: 'Rear Brake Replacement — previously declined Nov 2025',
        value_est: 875,
        status: 'pending',
        created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
    {
        id: 'ups_002',
        call_log_id: 'call_002',
        customer_id: 'cust_002',
        dealer_id: 'dealer_porsche_toronto',
        vehicle_id: 'veh_002a',
        upsell_type: 'cabin_air_filter',
        description: 'Cabin Air Filter Replacement',
        value_est: 240,
        status: 'pending',
        created_at: new Date(Date.now() - 86400000).toISOString(),
    },
    {
        id: 'ups_003',
        call_log_id: 'call_004',
        customer_id: 'cust_004',
        dealer_id: 'dealer_porsche_toronto',
        vehicle_id: 'veh_004a',
        upsell_type: 'software_update',
        description: 'Annual Taycan Software Update Package',
        value_est: 420,
        status: 'pending',
        created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
];

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '25', 10), 1), 200);

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        const upsells = enrichMockUpsells(MOCK_UPSELLS).slice(0, limit);
        return NextResponse.json({ upsells, total: upsells.length, persistence: 'mock' as const });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ upsells: [], total: 0, persistence: 'none' as const });
    }

    const scope = await resolveScopeForRequest(request);

    let query = supabase
        .from('upsells')
        .select('*')
        .eq('status', 'pending')
        .order('value_est', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit);

    if (scope.dealerId) query = query.eq('dealer_id', scope.dealerId);

    const { data, error } = await query;
    if (error) {
        console.error('[/api/upsells/pending] select failed:', error.message);
        return NextResponse.json({ error: error.message, upsells: [], total: 0 }, { status: 500 });
    }

    const enriched = await enrichSupabaseUpsells(supabase, (data ?? []) as UpsellRow[]);
    return NextResponse.json({ upsells: enriched, total: enriched.length, persistence: 'supabase' as const });
}
