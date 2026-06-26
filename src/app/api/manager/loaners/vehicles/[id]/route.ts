import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { readSessionFromRequest } from '@/lib/role';
import { getSupabase, type LoanerVehicleRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface RouteContext {
    params: { id: string };
}

type PatchBody = {
    is_available?: boolean;
    notes?: string | null;
    color?: string | null;
};

export async function PATCH(request: Request, context: RouteContext) {
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

    let body: PatchBody;
    try {
        body = (await request.json()) as PatchBody;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const allowedKeys = new Set(['is_available', 'notes', 'color']);
    const invalidKeys = Object.keys(body).filter((key) => !allowedKeys.has(key));
    if (invalidKeys.length > 0) {
        return NextResponse.json({ error: `Only is_available, notes, and color can be updated. Invalid: ${invalidKeys.join(', ')}` }, { status: 400 });
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.is_available === 'boolean') update.is_available = body.is_available;
    if (body.notes !== undefined) update.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
    if (body.color !== undefined) update.color = typeof body.color === 'string' ? body.color.trim() || null : null;

    const supabase = getSupabase();
    if (!supabase || process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ vehicle: { id, dealer_id: dealerId, ...update }, persistence: 'mock' });
    }

    const { data, error } = await supabase
        .from('loaner_vehicles')
        .update(update)
        .eq('id', id)
        .eq('dealer_id', dealerId)
        .select('*')
        .single();

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ error: 'loaner_vehicles table missing — apply migration 0014' }, { status: 503 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Loaner vehicle not found' }, { status: 404 });

    void recordAudit(request, session, {
        action: 'update_loaner_vehicle',
        resourceType: 'loaner_vehicle',
        resourceId: id,
    });

    return NextResponse.json({ vehicle: data as LoanerVehicleRow, persistence: 'supabase' });
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

    const { data, error } = await supabase
        .from('loaner_vehicles')
        .update({ is_available: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('dealer_id', dealerId)
        .select('id')
        .single();

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ error: 'loaner_vehicles table missing — apply migration 0014' }, { status: 503 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Loaner vehicle not found' }, { status: 404 });

    void recordAudit(request, session, {
        action: 'delete_loaner_vehicle',
        resourceType: 'loaner_vehicle',
        resourceId: id,
    });

    return NextResponse.json({ deleted: true, id, persistence: 'supabase' });
}
