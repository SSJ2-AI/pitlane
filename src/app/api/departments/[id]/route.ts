// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSupabase, type DepartmentRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';
import { canEditDepartments, readRoleFromRequest } from '@/lib/role';

// /api/departments/:id — PATCH + DELETE for the service-manager UI.
// Both gated on canEditDepartments(role); advisors get a 403. Aria is
// expected to never hit these endpoints — she reads departments via the
// voice service's findDepartment() helper which goes through the
// service-role Supabase key, bypassing the role gate.

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: { id: string } }) {
    const role = readRoleFromRequest(request);
    if (!canEditDepartments(role)) {
        return NextResponse.json({ error: 'Forbidden — service managers only.' }, { status: 403 });
    }

    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    let body: Partial<Pick<DepartmentRow, 'name' | 'phone_number' | 'extension' | 'display_name' | 'display_order' | 'is_active'>>;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string') update.name = body.name.trim().toLowerCase();
    if (body.phone_number !== undefined) update.phone_number = body.phone_number ?? null;
    if (body.extension !== undefined) update.extension = body.extension ?? null;
    if (typeof body.display_name === 'string') update.display_name = body.display_name.trim();
    if (typeof body.display_order === 'number') update.display_order = body.display_order;
    if (typeof body.is_active === 'boolean') update.is_active = body.is_active;

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ department: { id, ...update }, persistence: 'mock' });
    }

    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

    const dealer = await resolveDealerForRequest(request);
    const { data, error } = await supabase
        .from('departments')
        .update(update)
        .eq('id', id)
        .eq('dealer_id', dealer.id)
        .select('*')
        .single();

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') return NextResponse.json({ error: 'departments table missing — apply migration 0008' }, { status: 503 });
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Department not found' }, { status: 404 });
    return NextResponse.json({ department: data, persistence: 'supabase' });
}

export async function DELETE(request: Request, context: { params: { id: string } }) {
    const role = readRoleFromRequest(request);
    if (!canEditDepartments(role)) {
        return NextResponse.json({ error: 'Forbidden — service managers only.' }, { status: 403 });
    }

    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ deleted: true, id, persistence: 'mock' });
    }

    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

    const dealer = await resolveDealerForRequest(request);
    const { error, count } = await supabase
        .from('departments')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('dealer_id', dealer.id);
    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') return NextResponse.json({ error: 'departments table missing — apply migration 0008' }, { status: 503 });
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!count) return NextResponse.json({ error: 'Department not found' }, { status: 404 });
    return NextResponse.json({ deleted: true, id, persistence: 'supabase' });
}
