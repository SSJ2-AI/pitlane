// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { canManageStaff, dealerFilter, readSessionFromRequest } from '@/lib/role';
import { recordAudit } from '@/lib/audit';

// PATCH /api/staff/:id
//   body: { is_active?: boolean, full_name?: string }
//
// Service-manager only. Scoped to the manager's dealer — a manager
// cannot toggle a staff row that belongs to a different rooftop.
//
// Only is_active + full_name are mutable here. role + dealer_id stay
// write-locked so a manager can't escalate an advisor to manager and
// can't reassign a row to another dealer.

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: { id: string } }) {
    const session = readSessionFromRequest(request);
    if (!canManageStaff(session.role)) {
        return NextResponse.json({ error: 'Forbidden — service managers only.' }, { status: 403 });
    }

    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    let body: { is_active?: boolean; full_name?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.is_active === 'boolean') update.is_active = body.is_active;
    if (typeof body.full_name === 'string' && body.full_name.trim().length > 0) update.full_name = body.full_name.trim();

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ staff: { id, ...update }, persistence: 'mock' });
    }

    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

    const dealerId = dealerFilter(session);
    if (!dealerId) {
        return NextResponse.json({ error: 'Manager has no dealer scope' }, { status: 400 });
    }

    const { data, error } = await supabase
        .from('staff')
        .update(update)
        .eq('id', id)
        .eq('dealer_id', dealerId)
        // Don't let a manager flip another manager's flag.
        .eq('role', 'service_advisor')
        .select('*')
        .single();

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') return NextResponse.json({ error: 'staff table missing — apply migration 0010' }, { status: 503 });
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Staff row not found or not editable' }, { status: 404 });

    // PIPEDA + Canadian employment law: deactivation must invalidate the
    // existing Supabase session immediately, not at the next idle expiry.
    // We hit auth.admin.signOut(userId) here directly so we don't depend
    // on the revoke-session endpoint being called separately.
    if (body.is_active === false) {
        try {
            await supabase.auth.admin.signOut(id);
        } catch (err) {
            console.warn('[/api/staff/:id] auto-revoke on deactivate failed (non-fatal):', err instanceof Error ? err.message : err);
        }
        void recordAudit(request, session, { action: 'deactivate_staff', resourceType: 'staff', resourceId: id });
    } else if (body.is_active === true) {
        void recordAudit(request, session, { action: 'activate_staff', resourceType: 'staff', resourceId: id });
    }

    return NextResponse.json({ staff: data, persistence: 'supabase' });
}
