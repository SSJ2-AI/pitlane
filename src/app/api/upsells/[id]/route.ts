import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

// PATCH /api/upsells/:id
//   body: { status: 'accepted' | 'declined' | 'expired' | 'pending' }
//
// Used by the /service-desk page's upsell pipeline to advance the lifecycle
// when the advisor closes (or loses) the upsell with the customer.

const ALLOWED = new Set(['accepted', 'declined', 'expired', 'pending']);

interface RouteContext {
    params: { id: string };
}

export async function PATCH(request: Request, context: RouteContext) {
    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }
    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    let body: { status?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.status || !ALLOWED.has(body.status)) {
        return NextResponse.json({ error: `status must be one of ${Array.from(ALLOWED).join(', ')}` }, { status: 400 });
    }

    const { data, error } = await supabase
        .from('upsells')
        .update({ status: body.status })
        .eq('id', id)
        .select('*')
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Upsell not found' }, { status: 404 });
    return NextResponse.json({ upsell: data });
}
