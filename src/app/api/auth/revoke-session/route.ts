// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { canManageStaff, readSessionFromRequest } from '@/lib/role';
import { recordAudit } from '@/lib/audit';

// POST /api/auth/revoke-session?staffId=<uuid>
//
// PIPEDA + Canadian employment law require that when a staff member is
// terminated (or their account is deactivated for any reason), their
// existing Supabase Auth session is invalidated immediately — not at the
// next 8-hour idle expiry. This endpoint calls auth.admin.signOut(userId)
// which invalidates ALL active refresh tokens for the user, so any browser
// tab they have open is bounced to /login on the very next request.
//
// Service-manager only. Service managers can revoke advisors in their own
// dealer; group_manager could be allowed here too but is intentionally
// excluded — group_manager is read-only by spec.

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const session = readSessionFromRequest(request);
    if (!canManageStaff(session.role)) {
        return NextResponse.json({ error: 'Forbidden — service managers only.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const staffId = searchParams.get('staffId');
    if (!staffId) {
        return NextResponse.json({ error: 'staffId query param is required' }, { status: 400 });
    }

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ revoked: true, staff_id: staffId, persistence: 'mock' });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    // Verify the target staff row belongs to the manager's dealer before
    // invalidating their session. group_manager rows cannot be revoked
    // here — service managers don't have that authority.
    const { data: staffRow, error: staffErr } = await supabase
        .from('staff')
        .select('id,dealer_id,role')
        .eq('id', staffId)
        .maybeSingle();
    if (staffErr) {
        const code = (staffErr as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ error: 'staff table missing — apply migration 0010' }, { status: 503 });
        }
        return NextResponse.json({ error: staffErr.message }, { status: 500 });
    }
    if (!staffRow) return NextResponse.json({ error: 'Staff row not found' }, { status: 404 });
    if (staffRow.dealer_id !== session.dealerId) {
        return NextResponse.json({ error: 'Cannot revoke sessions for another dealer' }, { status: 403 });
    }
    if (staffRow.role !== 'service_advisor') {
        return NextResponse.json({ error: 'Cannot revoke a manager session — escalate to a group manager.' }, { status: 403 });
    }

    // signOut(userId) invalidates every refresh token for the user, so
    // existing sessions are dead at the next request.
    try {
        const { error: revokeErr } = await supabase.auth.admin.signOut(staffId);
        if (revokeErr) {
            return NextResponse.json({ error: revokeErr.message }, { status: 500 });
        }
    } catch (err) {
        console.error('[/api/auth/revoke-session] signOut threw:', err instanceof Error ? err.message : err);
        return NextResponse.json({ error: 'Failed to revoke session' }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'revoke_session',
        resourceType: 'staff',
        resourceId: staffId,
    });

    return NextResponse.json({ revoked: true, staff_id: staffId, persistence: 'supabase' });
}
