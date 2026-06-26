import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';
import { recordAudit } from '@/lib/audit';
import { readSessionFromRequest } from '@/lib/role';

// PATCH /api/loaner-requests/:id
//   body: { status: 'approved' | 'declined' | 'fulfilled', resolved_by?, notes? }
//
// Used by the /service-desk page's loaner queue. Stamps resolved_at when the
// status moves out of 'pending'. Returns the updated row.

const ALLOWED = new Set(['approved', 'declined', 'fulfilled', 'pending']);

interface RouteContext {
    params: { id: string };
}

export async function PATCH(request: Request, context: RouteContext) {
    const session = readSessionFromRequest(request);
    if (!session.userId && process.env.NEXT_PUBLIC_USE_MOCK_DATA !== 'true') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!['service_advisor', 'service_manager'].includes(session.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }
    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    let body: { status?: string; resolved_by?: string; notes?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.status || !ALLOWED.has(body.status)) {
        return NextResponse.json({ error: `status must be one of ${Array.from(ALLOWED).join(', ')}` }, { status: 400 });
    }

    const update: Record<string, unknown> = { status: body.status };
    if (body.status !== 'pending') {
        update.resolved_by = body.resolved_by ?? 'service_desk';
        update.resolved_at = new Date().toISOString();
    } else {
        update.resolved_by = null;
        update.resolved_at = null;
    }
    if (typeof body.notes === 'string') update.notes = body.notes;

    const dealer = await resolveDealerForRequest(request);
    const dealerId = session.dealerId || dealer.id;

    const { data, error } = await supabase
        .from('loaner_requests')
        .update(update)
        .eq('id', id)
        .eq('dealer_id', dealerId)
        .select('*')
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
        return NextResponse.json({ error: 'Loaner request not found' }, { status: 404 });
    }

    void recordAudit(request, session, {
        action: 'update_loaner_request',
        resourceType: 'loaner_request',
        resourceId: id,
    });

    return NextResponse.json({ loaner_request: data });
}
