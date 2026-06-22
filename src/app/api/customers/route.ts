import { NextResponse } from 'next/server';
import { resolveDealerForRequest } from '@/lib/dealer';
import {
    countOpenROsForCustomer,
    getLastServiceForCustomer,
    getVehiclesForCustomer,
    MOCK_CUSTOMERS,
    type MockCustomer,
} from '@/lib/mock-customers';
import type { MockVehicle } from '@/lib/mock-vehicles';
import { getSupabase, type CallSummary } from '@/lib/supabase';

// GET /api/customers
//   ?search=text   — case-insensitive name + phone + email match
//
// Returns the directory list. Each row carries:
//   - core customer fields from MOCK_CUSTOMERS
//   - vehicles[] derived from MOCK_VEHICLES (year/make/model/id + first_id
//     for the "View vehicles" link)
//   - open_ros_count derived from MOCK_REPAIR_ORDERS
//   - last_service_date derived from MOCK_REPAIR_ORDERS
//   - last_call (date + outcome) from Supabase call_logs when available,
//     null otherwise — same pattern as /api/vehicles/[id].

export const dynamic = 'force-dynamic';

export interface CustomerListRow {
    id: string;
    name: string;
    first_name: string;
    last_name: string;
    phone: string;
    email: string;
    loyalty_tier: MockCustomer['loyaltyTier'];
    preferred_language: MockCustomer['preferredLanguage'];
    customer_since_year: number;
    lifetime_visits: number;
    lifetime_spend: number;
    vehicles: Array<Pick<MockVehicle, 'id' | 'year' | 'make' | 'model' | 'trim'>>;
    open_ros_count: number;
    last_service_date: string | null;
    last_call: { date: string; outcome: CallSummary['outcome'] | null } | null;
}

interface CustomersListResponse {
    customers: CustomerListRow[];
    total: number;
    dealer: { id: string; name: string };
    persistence: 'supabase' | 'mock';
}

export async function GET(request: Request): Promise<NextResponse<CustomersListResponse>> {
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('search') ?? '').trim().toLowerCase();

    const dealer = await resolveDealerForRequest(request);

    const rows: CustomerListRow[] = MOCK_CUSTOMERS.map((c) => {
        const vehicles = getVehiclesForCustomer(c.id);
        return {
            id: c.id,
            name: `${c.firstName} ${c.lastName}`,
            first_name: c.firstName,
            last_name: c.lastName,
            phone: c.phone,
            email: c.email,
            loyalty_tier: c.loyaltyTier,
            preferred_language: c.preferredLanguage,
            customer_since_year: c.customerSinceYear,
            lifetime_visits: c.lifetimeVisits,
            lifetime_spend: c.lifetimeSpend,
            vehicles: vehicles.map((v) => ({
                id: v.id,
                year: v.year,
                make: v.make,
                model: v.model,
                trim: v.trim,
            })),
            open_ros_count: countOpenROsForCustomer(c.id),
            last_service_date: getLastServiceForCustomer(c.id),
            last_call: null,
        };
    });

    // Enrich last_call from Supabase when configured. One query, group by
    // customer_id client-side. Failure is non-fatal — page still renders.
    const persistence = await enrichLastCalls(rows, dealer.id);

    // Filter by search.
    const filtered = search
        ? rows.filter((r) =>
              r.name.toLowerCase().includes(search) ||
              r.phone.includes(search) ||
              r.email.toLowerCase().includes(search),
          )
        : rows;

    return NextResponse.json({
        customers: filtered,
        total: rows.length,
        dealer: { id: dealer.id, name: dealer.name },
        persistence,
    });
}

async function enrichLastCalls(
    rows: CustomerListRow[],
    dealerId: string,
): Promise<'supabase' | 'mock'> {
    const supabase = getSupabase();
    if (!supabase) return 'mock';

    try {
        const { data, error } = await supabase
            .from('call_logs')
            .select('customer_id, started_at, summary')
            .eq('dealer_id', dealerId)
            .not('customer_id', 'is', null)
            .order('started_at', { ascending: false })
            .limit(200);
        if (error) {
            console.error('[/api/customers] last-call enrichment failed:', error.message);
            return 'mock';
        }

        // Walk in order; keep the first hit per customer_id.
        const seen = new Set<string>();
        for (const row of (data ?? []) as Array<{ customer_id: string; started_at: string; summary: CallSummary | null }>) {
            const cust = rows.find((r) => r.id === row.customer_id);
            if (!cust || seen.has(row.customer_id)) continue;
            seen.add(row.customer_id);
            cust.last_call = {
                date: row.started_at,
                outcome: row.summary?.outcome ?? null,
            };
        }
        return 'supabase';
    } catch (err) {
        console.error('[/api/customers] enrichment threw:', err instanceof Error ? err.message : err);
        return 'mock';
    }
}
