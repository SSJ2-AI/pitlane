import { NextResponse } from 'next/server';
import { getSupabase, type CallLogRow, type AppointmentRow, type UpsellRow, type LoanerRequestRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';
import { MOCK_CUSTOMERS } from '@/lib/mock-customers';
import { MOCK_VEHICLES } from '@/lib/mock-vehicles';
import { enrichUpsellsWithCustomerContext } from '@/lib/upsell-context';

// GET /api/calls/:id
//
// Returns the full record + every row created during the call:
//   { call, appointments, upsells, loaner_requests, persistence }
//
// Mock mode: reads from MOCK_CALLS (no Supabase needed) — fixes crash on Vercel demo.
// 404 when not found, 503 when Supabase is not configured (non-mock only).

export const dynamic = 'force-dynamic';

interface RouteContext {
    params: { id: string };
}

function mockVehicleSummary(vehicleId: string | null | undefined, customerId: string | null | undefined): string | null {
    const vehicle =
        (vehicleId ? MOCK_VEHICLES.find((v) => v.id === vehicleId) : null) ??
        (customerId ? MOCK_VEHICLES.find((v) => v.customer_id === customerId) : null);
    if (!vehicle) return null;
    return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ');
}

export async function GET(request: Request, context: RouteContext) {
    const id = context.params.id;
    if (!id) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // ─── Mock mode ────────���───────────────────────────────────────────────────
    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        const { MOCK_CALLS } = await import('@/lib/mock-calls');
        const call = (MOCK_CALLS as unknown[]).find((c: any) => c.id === id) as any;
        if (!call) {
            return NextResponse.json({ error: 'Call not found' }, { status: 404 });
        }
        const customer = MOCK_CUSTOMERS.find((c) => c.id === call.customer_id);
        const mockVehicle = call.customer_id ? MOCK_VEHICLES.find((v) => v.customer_id === call.customer_id) : null;
        const upsells = ((call.summary?.upsells_flagged ?? []) as any[]).map((u: any, i: number) => ({
            id: `mock-upsell-${id}-${i}`,
            call_log_id: id,
            customer_id: call.customer_id ?? null,
            dealer_id: 'aaaaaaaa-0000-0000-0000-000000000001',
            vehicle_id: mockVehicle?.id ?? '',
            upsell_type: u.type ?? '',
            description: u.description ?? '',
            value_est: u.value_est ?? null,
            status: 'pending',
            created_at: call.started_at ?? new Date().toISOString(),
            customer_phone: customer?.phone ?? null,
            customer_tier: customer?.loyaltyTier ?? null,
            vehicle_summary: mockVehicleSummary(mockVehicle?.id, call.customer_id),
        }));
        const loaner_requests = call.summary?.loaner_needed ? [{
            id: `mock-loaner-${id}`,
            call_log_id: id,
            customer_id: call.customer_id ?? null,
            dealer_id: 'aaaaaaaa-0000-0000-0000-000000000001',
            status: 'pending',
            requested_date: null,
            notes: call.summary?.summary_text ?? null,
            created_at: call.started_at ?? new Date().toISOString(),
        }] : [];
        return NextResponse.json({
            call,
            appointments: [],
            upsells,
            loaner_requests,
            persistence: 'mock' as const,
        });
    }

    // ─── Supabase mode ────────────────────────────────────────────────────────
    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json(
            { error: 'Supabase is not configured on this deploy', persistence: 'none' as const },
            { status: 503 },
        );
    }

    const dealer = await resolveDealerForRequest(request);

    const [callResult, apptResult, upsellResult, loanerResult] = await Promise.all([
        supabase.from('call_logs').select('*').eq('id', id).eq('dealer_id', dealer.id).maybeSingle(),
        supabase.from('appointments').select('*').eq('call_log_id', id).eq('dealer_id', dealer.id),
        supabase.from('upsells').select('*').eq('call_log_id', id).eq('dealer_id', dealer.id),
        supabase.from('loaner_requests').select('*').eq('call_log_id', id).eq('dealer_id', dealer.id),
    ]);

    if (callResult.error) {
        console.error('[/api/calls/:id] call_logs select failed:', callResult.error.message);
        return NextResponse.json({ error: callResult.error.message }, { status: 500 });
    }
    if (!callResult.data) {
        return NextResponse.json({ error: 'Call not found' }, { status: 404 });
    }

    return NextResponse.json({
        call: callResult.data as CallLogRow,
        appointments: (apptResult.data ?? []) as AppointmentRow[],
        upsells: await enrichUpsellsWithCustomerContext(
            supabase,
            (upsellResult.data ?? []) as UpsellRow[],
            '[/api/calls/:id]',
        ),
        loaner_requests: (loanerResult.data ?? []) as LoanerRequestRow[],
        dealer: { id: dealer.id, name: dealer.name },
        persistence: 'supabase' as const,
    });
}
