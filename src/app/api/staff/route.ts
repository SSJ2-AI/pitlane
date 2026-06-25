// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSupabase, type StaffRow } from '@/lib/supabase';
import { canManageStaff, dealerFilter, readSessionFromRequest } from '@/lib/role';

// /api/staff
//
// GET  -> list staff for the caller's dealer scope.
//          service_advisor  -> their own row only
//          service_manager  -> all staff for their dealer
//          group_manager    -> all staff across the group
//
// POST -> invite a new service_advisor (manager-only). Uses Supabase
//         Auth admin.inviteUserByEmail() to send a magic-link sign-up
//         email + creates the staff row keyed to that auth user.

export const dynamic = 'force-dynamic';

function getMockStaff(): StaffRow[] {
    const now = new Date().toISOString();
    return [
        { id: 'staff_mock_advisor_1', dealer_id: 'aaaaaaaa-0000-0000-0000-000000000001', role: 'service_advisor', full_name: 'Marco Alvarez', email: 'marco@pfaffporsche.ca', is_active: true, invited_by: null, created_at: now, updated_at: now },
        { id: 'staff_mock_advisor_2', dealer_id: 'aaaaaaaa-0000-0000-0000-000000000001', role: 'service_advisor', full_name: 'Sarah Kowalski', email: 'sarah@pfaffporsche.ca', is_active: true, invited_by: null, created_at: now, updated_at: now },
        { id: 'staff_mock_manager_1', dealer_id: 'aaaaaaaa-0000-0000-0000-000000000001', role: 'service_manager', full_name: 'Demo Manager', email: 'manager@pfaffporsche.ca', is_active: true, invited_by: null, created_at: now, updated_at: now },
    ];
}

export async function GET(request: Request) {
    const session = readSessionFromRequest(request);

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({
            staff: getMockStaff(),
            session: { role: session.role, dealer_id: session.dealerId },
            can_manage: canManageStaff(session.role),
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ staff: getMockStaff(), session: { role: session.role, dealer_id: session.dealerId }, can_manage: canManageStaff(session.role), persistence: 'mock' });
    }

    let query = supabase.from('staff').select('*').order('role', { ascending: true }).order('full_name', { ascending: true });

    if (session.role === 'service_advisor') {
        if (!session.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        query = query.eq('id', session.userId);
    } else if (session.role === 'service_manager') {
        const filter = dealerFilter(session);
        if (!filter) return NextResponse.json({ error: 'Manager has no dealer scope' }, { status: 400 });
        query = query.eq('dealer_id', filter);
    }
    // group_manager: no filter, sees everyone.

    const { data, error } = await query;
    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            console.warn('[/api/staff] staff table missing — apply migration 0010');
            return NextResponse.json({ staff: [], session: { role: session.role, dealer_id: session.dealerId }, can_manage: canManageStaff(session.role), persistence: 'mock' });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
        staff: data ?? [],
        session: { role: session.role, dealer_id: session.dealerId },
        can_manage: canManageStaff(session.role),
        persistence: 'supabase',
    });
}

export async function POST(request: Request) {
    const session = readSessionFromRequest(request);
    if (!canManageStaff(session.role)) {
        return NextResponse.json({ error: 'Forbidden — service managers only.' }, { status: 403 });
    }

    let body: { email?: string; full_name?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const email = body.email?.trim().toLowerCase();
    const fullName = body.full_name?.trim();
    if (!email || !fullName) {
        return NextResponse.json({ error: 'email and full_name are required' }, { status: 400 });
    }

    // Service managers can only invite service_advisor accounts in their
    // own dealer scope. The spec calls this out explicitly.
    const dealerId = session.dealerId || null;
    if (!dealerId) {
        return NextResponse.json({ error: 'Manager has no dealer scope; cannot invite.' }, { status: 400 });
    }

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        const now = new Date().toISOString();
        return NextResponse.json({
            staff: {
                id: `staff_mock_${Date.now().toString(36)}`,
                dealer_id: dealerId,
                role: 'service_advisor',
                full_name: fullName,
                email,
                is_active: true,
                invited_by: session.userId,
                created_at: now,
                updated_at: now,
            } satisfies StaffRow,
            invite_sent: false,
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

    // Step 1: send the invite via Supabase Auth admin (service-role key
    // required — getSupabase() uses it).
    let inviteSent = false;
    let authUserId: string | null = null;
    try {
        const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
            data: { full_name: fullName, invited_by: session.userId },
        });
        if (inviteError) {
            // If the user already exists, fall back to looking them up so
            // we can still attach a staff row.
            if (/already (registered|exists)/i.test(inviteError.message)) {
                const { data: existing } = await supabase.auth.admin.listUsers();
                const match = existing?.users?.find((u) => u.email?.toLowerCase() === email);
                if (match) {
                    authUserId = match.id;
                } else {
                    return NextResponse.json({ error: inviteError.message }, { status: 400 });
                }
            } else {
                return NextResponse.json({ error: inviteError.message }, { status: 400 });
            }
        } else {
            inviteSent = true;
            authUserId = inviteData?.user?.id ?? null;
        }
    } catch (err) {
        console.error('[/api/staff] invite threw:', err instanceof Error ? err.message : err);
        return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 });
    }

    if (!authUserId) {
        return NextResponse.json({ error: 'Invite succeeded but no auth user id returned' }, { status: 500 });
    }

    // Step 2: insert the staff row. Conflict resolution: if a row already
    // exists for this auth user we just update name/role/is_active.
    const { data, error } = await supabase
        .from('staff')
        .upsert(
            {
                id: authUserId,
                dealer_id: dealerId,
                role: 'service_advisor',
                full_name: fullName,
                email,
                is_active: true,
                invited_by: session.userId,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' },
        )
        .select('*')
        .single();

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ error: 'staff table missing — apply migration 0010' }, { status: 503 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ staff: data, invite_sent: inviteSent, persistence: 'supabase' });
}
