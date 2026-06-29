import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveScopeForRequest } from '@/lib/dealer';
import { readSessionFromRequest } from '@/lib/role';
import { recordAudit } from '@/lib/audit';

// DELETE /api/manager/schedule/overrides/[id]
//
// Service-manager-only. Scoped delete (id + dealer_id) so a manager
// can't accidentally clear another dealer's row even if they craft a
// request with a foreign id.

export const dynamic = 'force-dynamic';

interface RouteContext {
    params: { id: string };
}

export async function DELETE(request: Request, context: RouteContext) {
    const session = readSessionFromRequest(request);
    if (session.role !== 'service_manager') {
        return NextResponse.json(
            { error: 'Forbidden — only service managers can delete schedule overrides.' },
            { status: 403 },
        );
    }

    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const scope = await resolveScopeForRequest(request);
    const dealerId = scope.dealerId ?? scope.dealer.id;
    if (!dealerId) {
        return NextResponse.json({ error: 'Manager has no dealer scope.' }, { status: 400 });
    }

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ deleted: true, id, persistence: 'mock' });
    }

    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

    const { error } = await supabase
        .from('schedule_overrides')
        .delete()
        .eq('id', id)
        .eq('dealer_id', dealerId);

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json(
                { error: 'schedule_overrides table missing — apply migration 0013' },
                { status: 503 },
            );
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'delete_schedule_override',
        resourceType: 'schedule_override',
        resourceId: id,
    });

    return NextResponse.json({ deleted: true, id, persistence: 'supabase' });
}
