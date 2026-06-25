// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSupabase, type DepartmentRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';
import { canEditDepartments, readRoleFromRequest, readSessionFromRequest } from '@/lib/role';
import { recordAudit } from '@/lib/audit';

// /api/departments
//
// GET   — read the dealer's phone-tree departments. Available to all
//         dashboard roles (service_advisor + service_manager).
// POST  — insert a new department. Service-manager only.
//
// Schema mirrors public.departments (migration 0008 post sprint review):
//   id, dealer_id, name, phone_number, extension, display_name,
//   display_order, is_active.
//
// This table is PitLane metadata only — it's NOT pulled from CDK.

export const dynamic = 'force-dynamic';

function getMockDepartments(): DepartmentRow[] {
    const dealerId = 'aaaaaaaa-0000-0000-0000-000000000001';
    const now = new Date().toISOString();
    return [
        { id: 'dept_mock_service', dealer_id: dealerId, name: 'service', phone_number: '+16475550101', extension: null, display_name: 'Service Advisor', display_order: 1, is_active: true, created_at: now, updated_at: now },
        { id: 'dept_mock_parts', dealer_id: dealerId, name: 'parts', phone_number: '+16475550102', extension: '201', display_name: 'Parts Department', display_order: 2, is_active: true, created_at: now, updated_at: now },
        { id: 'dept_mock_sales', dealer_id: dealerId, name: 'sales', phone_number: '+16475550103', extension: null, display_name: 'Sales Team', display_order: 3, is_active: true, created_at: now, updated_at: now },
        { id: 'dept_mock_manager', dealer_id: dealerId, name: 'manager', phone_number: '+16475550104', extension: null, display_name: 'Service Manager', display_order: 4, is_active: true, created_at: now, updated_at: now },
        { id: 'dept_mock_reception', dealer_id: dealerId, name: 'reception', phone_number: '+19063760066', extension: null, display_name: 'Reception', display_order: 5, is_active: true, created_at: now, updated_at: now },
    ];
}

export async function GET(request: Request) {
    const role = readRoleFromRequest(request);

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ departments: getMockDepartments(), role, can_edit: canEditDepartments(role), persistence: 'mock' });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ departments: getMockDepartments(), role, can_edit: canEditDepartments(role), persistence: 'mock' });
    }

    const dealer = await resolveDealerForRequest(request);
    const { data, error } = await supabase
        .from('departments')
        .select('*')
        .eq('dealer_id', dealer.id)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });
    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ departments: getMockDepartments(), role, can_edit: canEditDepartments(role), persistence: 'mock' });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ departments: data ?? [], role, can_edit: canEditDepartments(role), persistence: 'supabase' });
}

export async function POST(request: Request) {
    const role = readRoleFromRequest(request);
    if (!canEditDepartments(role)) {
        return NextResponse.json(
            { error: 'Forbidden — only service managers can add departments.' },
            { status: 403 },
        );
    }

    let body: { name?: string; phone_number?: string; extension?: string | null; display_name?: string; display_order?: number };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const name = body.name?.trim().toLowerCase();
    const displayName = body.display_name?.trim();
    if (!name || !displayName) {
        return NextResponse.json({ error: 'name and display_name are required' }, { status: 400 });
    }

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({
            department: {
                id: `dept_mock_${Date.now().toString(36)}`,
                dealer_id: 'aaaaaaaa-0000-0000-0000-000000000001',
                name,
                phone_number: body.phone_number ?? null,
                extension: body.extension ?? null,
                display_name: displayName,
                display_order: body.display_order ?? 99,
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            } satisfies DepartmentRow,
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

    const dealer = await resolveDealerForRequest(request);
    const { data, error } = await supabase
        .from('departments')
        .insert({
            dealer_id: dealer.id,
            name,
            phone_number: body.phone_number ?? null,
            extension: body.extension ?? null,
            display_name: displayName,
            display_order: body.display_order ?? 99,
            is_active: true,
        })
        .select('*')
        .single();

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ error: 'departments table missing — apply migration 0008' }, { status: 503 });
        }
        if (code === '23505') {
            return NextResponse.json({ error: `A department named "${name}" already exists for this dealer.` }, { status: 409 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    void recordAudit(request, readSessionFromRequest(request), {
        action: 'create_department',
        resourceType: 'department',
        resourceId: (data as { id?: string } | null)?.id ?? null,
    });

    return NextResponse.json({ department: data, persistence: 'supabase' });
}
