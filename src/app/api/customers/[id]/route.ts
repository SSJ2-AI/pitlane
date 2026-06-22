import { NextResponse } from 'next/server';
import { resolveDealerForRequest } from '@/lib/dealer';
import {
    countOpenROsForCustomer,
    findMockCustomer,
    getLastServiceForCustomer,
    getVehiclesForCustomer,
    type MockCustomer,
} from '@/lib/mock-customers';
import { findMockRepairOrders, type MockRepairOrder, type MockVehicle } from '@/lib/mock-vehicles';
import { getSupabase, type CallLogRow } from '@/lib/supabase';

// GET /api/customers/:customerId
//
// Returns the customer detail payload backing /customers/[id]:
//   { customer, vehicles[], open_ros[], last_service_date,
//     recent_calls[], dealer, persistence }
//
// `recent_calls` reads from Supabase call_logs filtered by dealer_id +
// customer_id (last 5). Falls through to [] when unconfigured.

export const dynamic = 'force-dynamic';

interface RouteContext {
    params: { id: string };
}

export interface CustomerDetailPayload {
    customer: MockCustomer & { name: string };
    vehicles: MockVehicle[];
    open_ros: MockRepairOrder[];
    last_service_date: string | null;
    recent_calls: CallLogRow[];
    dealer: { id: string; name: string };
    persistence: 'supabase' | 'mock';
}

export async function GET(
    request: Request,
    context: RouteContext,
): Promise<NextResponse<CustomerDetailPayload | { error: string }>> {
    const id = context.params.id;
    if (!id) {
        return NextResponse.json({ error: 'customer id required' }, { status: 400 });
    }

    const customer = findMockCustomer(id);
    if (!customer) {
        return NextResponse.json({ error: `customer ${id} not found` }, { status: 404 });
    }

    const dealer = await resolveDealerForRequest(request);
    const vehicles = getVehiclesForCustomer(customer.id);
    const openRos = vehicles
        .flatMap((v) => findMockRepairOrders(v.id, 5))
        .filter((ro) => ro.status !== 'completed')
        .sort((a, b) => (a.date < b.date ? 1 : -1));

    const { calls: recentCalls, persistence } = await loadRecentCalls(customer.id, dealer.id);

    return NextResponse.json({
        customer: { ...customer, name: `${customer.firstName} ${customer.lastName}` },
        vehicles,
        open_ros: openRos,
        last_service_date: getLastServiceForCustomer(customer.id),
        recent_calls: recentCalls,
        dealer: { id: dealer.id, name: dealer.name },
        persistence,
    });
}

async function loadRecentCalls(
    customerId: string,
    dealerId: string,
): Promise<{ calls: CallLogRow[]; persistence: 'supabase' | 'mock' }> {
    const supabase = getSupabase();
    if (!supabase) return { calls: [], persistence: 'mock' };

    try {
        const { data, error } = await supabase
            .from('call_logs')
            .select('*')
            .eq('dealer_id', dealerId)
            .eq('customer_id', customerId)
            .order('started_at', { ascending: false })
            .limit(5);
        if (error) {
            console.error('[/api/customers/:id] recent-calls failed:', error.message);
            return { calls: [], persistence: 'mock' };
        }
        return { calls: (data ?? []) as CallLogRow[], persistence: 'supabase' };
    } catch (err) {
        console.error('[/api/customers/:id] threw:', err instanceof Error ? err.message : err);
        return { calls: [], persistence: 'mock' };
    }
}
