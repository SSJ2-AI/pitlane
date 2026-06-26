import { NextResponse } from 'next/server';
import { DEFAULT_DEALER_ID } from '@/lib/dealer';
import { recordAudit } from '@/lib/audit';
import { readSessionFromRequest } from '@/lib/role';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

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

export async function DELETE(request: Request, context: { params: { id: string } }) {
    if (!hasRoleHeader(request)) {
        return NextResponse.json({ error: 'Unauthorized — missing x-pitlane-role header' }, { status: 401 });
    }

    const session = readSessionFromRequest(request);
    if (session.role !== 'service_manager') {
        return NextResponse.json({ error: 'Forbidden — service_manager role required' }, { status: 403 });
    }

    const dealerId = resolveScopedDealerId(request);
    if (!dealerId) {
        return NextResponse.json({ error: 'Missing x-pitlane-dealer header' }, { status: 400 });
    }

    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const { error, count } = await supabase
        .from('schedule_overrides')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('dealer_id', dealerId);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!count) {
        return NextResponse.json({ error: 'Override not found' }, { status: 404 });
    }

    void recordAudit(request, session, {
        action: 'delete_schedule_override',
        resourceType: 'schedule_override',
        resourceId: id,
    });

    return NextResponse.json({ deleted: true, id, persistence: 'supabase' });
}
