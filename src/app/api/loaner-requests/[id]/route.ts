import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { DEFAULT_DEALER_ID } from '@/lib/dealer';
import { readSessionFromRequest } from '@/lib/role';
import { recordAudit } from '@/lib/audit';

// PATCH /api/loaner-requests/:id
//   body: { status: 'approved' | 'declined' | 'fulfilled', resolved_by?, notes? }
//
// Used by the /service-desk page's loaner queue. Stamps resolved_at when the
// status moves out of 'pending'. Returns the updated row.

const ALLOWED = new Set(['approved', 'declined', 'fulfilled', 'pending']);

interface RouteContext {
    params: { id: string };
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

export async function PATCH(request: Request, context: RouteContext) {
    if (!hasRoleHeader(request)) {
        return NextResponse.json({ error: 'Unauthorized — missing x-pitlane-role header' }, { status: 401 });
    }

    const session = readSessionFromRequest(request);
    if (session.role !== 'service_manager') {
        return NextResponse.json({ error: 'Forbidden — service_manager role required' }, { status: 403 });
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

    const dealerId = resolveScopedDealerId(request);
    if (!dealerId) {
        return NextResponse.json({ error: 'Missing x-pitlane-dealer header' }, { status: 400 });
    }

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
        action: 'loaner_request_updated',
        resourceType: 'loaner_request',
        resourceId: id,
    });
    return NextResponse.json({ loaner_request: data });
}
