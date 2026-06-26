import { NextResponse } from 'next/server';
import { DEFAULT_DEALER_ID } from '@/lib/dealer';
import { recordAudit } from '@/lib/audit';
import { readSessionFromRequest } from '@/lib/role';
import { getSupabase, type LoanerVehicleRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface VehiclePatchInput {
    is_available?: boolean;
    notes?: string | null;
    color?: string | null;
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

export async function PATCH(request: Request, context: { params: { id: string } }) {
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

    let body: VehiclePatchInput;
    try {
        body = await request.json() as VehiclePatchInput;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.is_available === 'boolean') update.is_available = body.is_available;
    if (body.notes !== undefined) update.notes = body.notes ?? null;
    if (body.color !== undefined) update.color = body.color ?? null;

    const keys = Object.keys(update);
    if (keys.length === 1) {
        return NextResponse.json({ error: 'Only is_available, notes, and color can be updated' }, { status: 400 });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

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

    void recordAudit(request, session, {
        action: 'update_loaner_vehicle',
        resourceType: 'loaner_vehicle',
        resourceId: id,
    });

    return NextResponse.json({ vehicle: data as LoanerVehicleRow, persistence: 'supabase' });
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

    const { data, error } = await supabase
        .from('loaner_vehicles')
        .update({ is_available: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('dealer_id', dealerId)
        .select('*')
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'delete_loaner_vehicle',
        resourceType: 'loaner_vehicle',
        resourceId: id,
    });

    return NextResponse.json({ deleted: true, vehicle: data as LoanerVehicleRow, persistence: 'supabase' });
}
