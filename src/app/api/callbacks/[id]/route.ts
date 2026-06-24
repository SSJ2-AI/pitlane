import { NextResponse } from 'next/server';
import { getSupabase, type CallbackStatus } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';

// PATCH /api/callbacks/:id
//   body: { status: 'pending' | 'acknowledged' | 'completed' | 'cancelled',
//           assigned_advisor_id?: string }
//
// Used by the /service-desk Callback Queue panel to mark a callback
// acknowledged or completed. Stamps acknowledged_at / completed_at on
// the corresponding status transition. Mock mode echoes a synthetic row
// for the Vercel demo.

const ALLOWED: CallbackStatus[] = ['pending', 'acknowledged', 'completed', 'cancelled'];

export async function PATCH(request: Request, context: { params: { id: string } }) {
    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    let body: { status?: string; assigned_advisor_id?: string | null };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body.status || !(ALLOWED as string[]).includes(body.status)) {
        return NextResponse.json(
            { error: `status must be one of ${ALLOWED.join(', ')}` },
            { status: 400 },
        );
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = { status: body.status };
    if (body.status === 'acknowledged') update.acknowledged_at = now;
    if (body.status === 'completed') update.completed_at = now;
    if (typeof body.assigned_advisor_id === 'string') {
        update.assigned_advisor_id = body.assigned_advisor_id;
    }

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({
            callback_request: { id, ...update, updated_at: now },
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const dealer = await resolveDealerForRequest(request);
    const { data, error } = await supabase
        .from('callback_requests')
        .update(update)
        .eq('id', id)
        .eq('dealer_id', dealer.id)
        .select('*')
        .single();

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json(
                { error: 'callback_requests table missing — apply migration 0007' },
                { status: 503 },
            );
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
        return NextResponse.json({ error: 'Callback request not found' }, { status: 404 });
    }
    return NextResponse.json({ callback_request: data, persistence: 'supabase' });
}
