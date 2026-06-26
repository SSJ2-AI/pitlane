import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { readSessionFromRequest } from '@/lib/role';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface RouteContext {
    params: { id: string };
}

export async function DELETE(request: Request, context: RouteContext) {
    const session = readSessionFromRequest(request);
    if (session.role !== 'service_manager') {
        return NextResponse.json({ error: 'Forbidden — service managers only.' }, { status: 403 });
    }
    const dealerId = session.dealerId || null;
    if (!dealerId) {
        return NextResponse.json({ error: 'x-pitlane-dealer header is required' }, { status: 400 });
    }
    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const supabase = getSupabase();
    if (!supabase || process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ deleted: true, id, persistence: 'mock' });
    }

    const { error, count } = await supabase
        .from('schedule_overrides')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('dealer_id', dealerId);

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ error: 'schedule_overrides table missing — apply migration 0013' }, { status: 503 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!count) return NextResponse.json({ error: 'Override not found' }, { status: 404 });

    void recordAudit(request, session, {
        action: 'delete_schedule_override',
        resourceType: 'schedule_override',
        resourceId: id,
    });

    return NextResponse.json({ deleted: true, id, persistence: 'supabase' });
}
