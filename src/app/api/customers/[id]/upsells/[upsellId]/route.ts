import { NextResponse } from 'next/server';
import { getSupabase, type UpsellRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';

// PATCH /api/customers/:id/upsells/:upsellId
//   body: { status: 'accepted' | 'declined' | 'expired' | 'pending' }
//
// Scoped variant of /api/upsells/:upsellId used by the customer-profile
// CustomerUpsellsPanel. We also enforce that the upsell belongs to the
// customer in the URL — the parent route already filters by dealer for
// the GET, so we keep the same guarantee on writes.

export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['accepted', 'declined', 'expired', 'pending']);

interface RouteContext {
    params: { id: string; upsellId: string };
}

export async function PATCH(request: Request, context: RouteContext) {
    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const { id: customerId, upsellId } = context.params;
    if (!customerId || !upsellId) {
        return NextResponse.json({ error: 'customer id and upsell id required' }, { status: 400 });
    }

    let body: { status?: string };
    try {
        body = (await request.json()) as { status?: string };
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.status || !ALLOWED.has(body.status)) {
        return NextResponse.json(
            { error: `status must be one of ${Array.from(ALLOWED).join(', ')}` },
            { status: 400 },
        );
    }

    const dealer = await resolveDealerForRequest(request);

    const { data, error } = await supabase
        .from('upsells')
        .update({ status: body.status })
        .eq('id', upsellId)
        .eq('customer_id', customerId)
        .eq('dealer_id', dealer.id)
        .select('*')
        .single();

    if (error) {
        console.error('[/api/customers/:id/upsells/:upsellId] update failed:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
        return NextResponse.json({ error: 'Upsell not found for this customer' }, { status: 404 });
    }
    return NextResponse.json({ upsell: data as UpsellRow });
}
