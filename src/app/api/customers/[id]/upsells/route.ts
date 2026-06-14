import { NextResponse } from 'next/server';
import { getSupabase, type UpsellRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';

// GET /api/customers/:id/upsells
//
// Returns every upsell Aria has flagged for this customer across all calls,
// sorted by created_at desc. Used by the customer-detail upsells timeline on
// the main dashboard.

export const dynamic = 'force-dynamic';

interface RouteContext {
    params: { id: string };
}

export async function GET(request: Request, context: RouteContext) {
    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ upsells: [] as UpsellRow[], persistence: 'none' as const });
    }
    const customerId = context.params.id;
    if (!customerId) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const dealer = await resolveDealerForRequest(request);

    const { data, error } = await supabase
        .from('upsells')
        .select('*')
        .eq('dealer_id', dealer.id)
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('[/api/customers/:id/upsells] query failed:', error.message);
        return NextResponse.json({ upsells: [] as UpsellRow[], error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        upsells: (data ?? []) as UpsellRow[],
        persistence: 'supabase' as const,
    });
}
