import { NextResponse } from 'next/server';
import { getSupabase, type RepairOrderAssignmentRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';

// /api/repair-orders/:id
//
// Phase 9b — single endpoint that handles three actions via ?action=:
//   ?action=assign   POST { techIds: string[], techNames: string[], assignedBy }
//   ?action=complete POST { completedAt?: ISO, notes? }
//   ?action=extend   POST { newDate: ISO, reason, notes? }
//
// All three upsert into public.repair_order_assignments keyed by
// (dealer_id, repair_order_id). Mock mode echoes a synthetic row.

const DEMO_DEALER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

export const dynamic = 'force-dynamic';

interface AssignBody {
    techIds?: string[];
    techNames?: string[];
    assignedBy?: string;
    notes?: string;
    estimatedCompletion?: string;
}
interface CompleteBody {
    completedAt?: string;
    notes?: string;
}
interface ExtendBody {
    newDate?: string;
    reason?: string;
    notes?: string;
}

function nowIso(): string {
    return new Date().toISOString();
}

function mockResponse(roId: string, patch: Partial<RepairOrderAssignmentRow>) {
    const base: RepairOrderAssignmentRow = {
        id: `mock-roa-${roId}`,
        dealer_id: DEMO_DEALER_ID,
        repair_order_id: roId,
        customer_phone: null,
        tech_ids: [],
        tech_names: [],
        service_status: 'in_progress',
        estimated_completion: null,
        actual_completion: null,
        extended_until: null,
        extension_reason: null,
        notes: null,
        assigned_by: null,
        created_at: nowIso(),
        updated_at: nowIso(),
    };
    return NextResponse.json({
        repair_order_assignment: { ...base, ...patch },
        persistence: 'mock',
    });
}

export async function POST(request: Request, context: { params: { id: string } }) {
    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const { searchParams } = new URL(request.url);
    const action = (searchParams.get('action') ?? '').toLowerCase();
    if (!['assign', 'complete', 'extend'].includes(action)) {
        return NextResponse.json(
            { error: 'action must be one of: assign, complete, extend' },
            { status: 400 },
        );
    }

    let body: Record<string, unknown>;
    try {
        body = (await request.json()) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Build the patch shape per action.
    let patch: Partial<RepairOrderAssignmentRow> = {};
    if (action === 'assign') {
        const b = body as AssignBody;
        patch = {
            tech_ids: Array.isArray(b.techIds) ? b.techIds : [],
            tech_names: Array.isArray(b.techNames) ? b.techNames : [],
            assigned_by: b.assignedBy ?? 'service_desk',
            service_status: 'in_progress',
            estimated_completion: b.estimatedCompletion ?? null,
            notes: b.notes ?? null,
        };
        if (patch.tech_ids?.length === 0) {
            return NextResponse.json({ error: 'techIds is required' }, { status: 400 });
        }
    } else if (action === 'complete') {
        const b = body as CompleteBody;
        patch = {
            service_status: 'completed',
            actual_completion: b.completedAt ?? nowIso(),
            notes: b.notes ?? null,
        };
    } else if (action === 'extend') {
        const b = body as ExtendBody;
        if (!b.newDate || !b.reason) {
            return NextResponse.json({ error: 'newDate and reason are required' }, { status: 400 });
        }
        patch = {
            service_status: 'extended',
            extended_until: b.newDate,
            extension_reason: b.reason,
            notes: b.notes ?? null,
        };
    }

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return mockResponse(id, patch);
    }

    const supabase = getSupabase();
    if (!supabase) return mockResponse(id, patch);

    const dealer = await resolveDealerForRequest(request);
    const upsertRow = {
        dealer_id: dealer.id,
        repair_order_id: id,
        ...patch,
        updated_at: nowIso(),
    };

    const { data, error } = await supabase
        .from('repair_order_assignments')
        .upsert(upsertRow, { onConflict: 'dealer_id,repair_order_id' })
        .select('*')
        .single();

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json(
                { error: 'repair_order_assignments table missing — apply migration 0008' },
                { status: 503 },
            );
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ repair_order_assignment: data, persistence: 'supabase' });
}

export async function GET(request: Request, context: { params: { id: string } }) {
    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ repair_order_assignment: null, persistence: 'mock' });
    }
    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ repair_order_assignment: null, persistence: 'mock' });

    const dealer = await resolveDealerForRequest(request);
    const { data, error } = await supabase
        .from('repair_order_assignments')
        .select('*')
        .eq('repair_order_id', id)
        .eq('dealer_id', dealer.id)
        .maybeSingle();
    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ repair_order_assignment: null, persistence: 'mock' });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ repair_order_assignment: data, persistence: 'supabase' });
}
