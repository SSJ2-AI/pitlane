import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import {
    appendMockDealer,
    listMockDealers,
    type CreateDealerInput,
    type DealerListRow,
} from '@/lib/mock-dealers';

// /api/admin/dealers — Fix 3 (Phase 10) dealer onboarding portal.
//
// GET  → returns the dealer roster. Reads Supabase `dealers` when
//        configured, otherwise falls back to the in-process mock roster.
// POST → inserts a new dealer. Same fallback: writes to Supabase if
//        available, otherwise appends to the mock roster so the demo
//        can show the new row land without a backing database.
//
// IMPORTANT: this route is NOT auth-gated yet. It's intended for the
// PitLane admin team only — production deploy should add header/cookie
// auth before exposing /admin/* to the open internet. See Phase 11 task
// list in COMPLIANCE_ANALYSIS.md.

export const dynamic = 'force-dynamic';

interface DealersResponse {
    dealers: DealerListRow[];
    persistence: 'supabase' | 'mock';
}

interface CreateResponse {
    dealer?: DealerListRow;
    error?: string;
    persistence: 'supabase' | 'mock';
}

function isMockMode(): boolean {
    return process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true' || !getSupabase();
}

export async function GET(): Promise<NextResponse<DealersResponse>> {
    if (isMockMode()) {
        return NextResponse.json({ dealers: listMockDealers(), persistence: 'mock' });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ dealers: listMockDealers(), persistence: 'mock' });
    }

    try {
        const { data, error } = await supabase
            .from('dealers')
            .select('*')
            .order('name', { ascending: true });
        if (error) {
            console.error('[/api/admin/dealers] supabase select failed:', error.message);
            return NextResponse.json({ dealers: listMockDealers(), persistence: 'mock' });
        }
        const dealers: DealerListRow[] = (data ?? []).map((row) => ({
            ...(row as DealerListRow),
            status: row.active ? 'live' : 'offline',
            aria_status: row.elevenlabs_agent_id ? 'live' : 'training',
            aria_persona: 'Aria',
        }));
        return NextResponse.json({ dealers, persistence: 'supabase' });
    } catch (err) {
        console.error('[/api/admin/dealers] threw:', err instanceof Error ? err.message : err);
        return NextResponse.json({ dealers: listMockDealers(), persistence: 'mock' });
    }
}

export async function POST(request: Request): Promise<NextResponse<CreateResponse>> {
    let payload: CreateDealerInput;
    try {
        payload = (await request.json()) as CreateDealerInput;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body', persistence: 'mock' }, { status: 400 });
    }

    if (!payload?.name?.trim() || !payload?.brand?.trim()) {
        return NextResponse.json(
            { error: 'name and brand are required', persistence: 'mock' },
            { status: 400 },
        );
    }

    if (isMockMode()) {
        try {
            const dealer = appendMockDealer(payload);
            return NextResponse.json({ dealer, persistence: 'mock' });
        } catch (err) {
            return NextResponse.json(
                { error: err instanceof Error ? err.message : 'Failed to create dealer', persistence: 'mock' },
                { status: 400 },
            );
        }
    }

    const supabase = getSupabase();
    if (!supabase) {
        const dealer = appendMockDealer(payload);
        return NextResponse.json({ dealer, persistence: 'mock' });
    }

    try {
        const insertRow = {
            name: payload.name.trim(),
            brand: payload.brand.trim().toLowerCase(),
            location: payload.location?.trim() ?? '—',
            phone_number: payload.phone_number?.trim() || null,
            fortellis_subscription_id: payload.fortellis_subscription_id?.trim() || null,
            subdomain: payload.subdomain?.trim() || null,
            timezone: payload.timezone?.trim() || 'America/Toronto',
            active: true,
        };
        const { data, error } = await supabase
            .from('dealers')
            .insert(insertRow)
            .select('*')
            .single();
        if (error || !data) {
            console.error('[/api/admin/dealers] insert failed:', error?.message);
            return NextResponse.json(
                { error: error?.message ?? 'Insert failed', persistence: 'supabase' },
                { status: 500 },
            );
        }
        const dealer: DealerListRow = {
            ...(data as DealerListRow),
            status: 'live',
            aria_status: 'training',
            aria_persona: payload.aria_persona?.trim() || 'Aria',
        };
        return NextResponse.json({ dealer, persistence: 'supabase' });
    } catch (err) {
        console.error('[/api/admin/dealers] threw:', err instanceof Error ? err.message : err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to create dealer', persistence: 'supabase' },
            { status: 500 },
        );
    }
}
