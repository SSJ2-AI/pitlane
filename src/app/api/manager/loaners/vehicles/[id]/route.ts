import { NextResponse } from 'next/server';
import { getSupabase, type LoanerVehicleRow } from '@/lib/supabase';
import { resolveScopeForRequest } from '@/lib/dealer';
import { readSessionFromRequest } from '@/lib/role';
import { recordAudit } from '@/lib/audit';

// PATCH  /api/manager/loaners/vehicles/[id]
// DELETE /api/manager/loaners/vehicles/[id]
//
// Service-manager only. PATCH allows updating ONLY is_available, notes,
// color — make / model / year / license_plate are immutable here to keep
// the audit trail honest (a different vehicle becomes a new row, not an
// in-place edit). DELETE is a soft delete (sets is_available = false) so
// historical loaner_requests retain their FK target.

export const dynamic = 'force-dynamic';

interface RouteContext {
    params: { id: string };
}

interface VehiclePatch {
    is_available?: boolean;
    notes?: string | null;
    color?: string | null;
}

export async function PATCH(request: Request, context: RouteContext) {
    const session = readSessionFromRequest(request);
    if (session.role !== 'service_manager') {
        return NextResponse.json(
            { error: 'Forbidden — only service managers can update loaner vehicles.' },
            { status: 403 },
        );
    }

    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    let body: VehiclePatch;
    try {
        body = (await request.json()) as VehiclePatch;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
    };
    if (typeof body.is_available === 'boolean') update.is_available = body.is_available;
    if (body.notes !== undefined) update.notes = body.notes;
    if (body.color !== undefined) update.color = body.color;

    if (Object.keys(update).length === 1) {
        return NextResponse.json(
            { error: 'At least one of is_available, notes, color is required' },
            { status: 400 },
        );
    }

    const scope = await resolveScopeForRequest(request);
    const dealerId = scope.dealerId ?? scope.dealer.id;

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ vehicle: { id, ...update }, persistence: 'mock' });
    }

    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

    const { data, error } = await supabase
        .from('loaner_vehicles')
        .update(update)
        .eq('id', id)
        .eq('dealer_id', dealerId)
        .select('*')
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
        return NextResponse.json({ error: 'Loaner vehicle not found' }, { status: 404 });
    }

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
        return NextResponse.json(
            { error: 'Forbidden — only service managers can remove loaner vehicles.' },
            { status: 403 },
        );
    }

    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const scope = await resolveScopeForRequest(request);
    const dealerId = scope.dealerId ?? scope.dealer.id;

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ deleted: true, id, persistence: 'mock' });
    }

    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

    const { error } = await supabase
        .from('loaner_vehicles')
        .update({ is_available: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('dealer_id', dealerId);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'delete_loaner_vehicle',
        resourceType: 'loaner_vehicle',
        resourceId: id,
    });

    return NextResponse.json({ deleted: true, soft: true, id, persistence: 'supabase' });
}
