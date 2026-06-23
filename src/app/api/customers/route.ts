import { NextResponse } from 'next/server';
import { resolveDealerForRequest } from '@/lib/dealer';
import {
    countOpenROsForCustomer,
    getLastServiceForCustomer,
    getVehiclesForCustomer,
    isCustomerServiceOverdue,
    MOCK_CUSTOMERS,
    type MockCustomer,
} from '@/lib/mock-customers';
import { MOCK_CALLS } from '@/lib/mock-calls';
import type { MockVehicle } from '@/lib/mock-vehicles';
import { getSupabase, type CallSummary } from '@/lib/supabase';

// GET /api/customers
//   ?search=text   — case-insensitive name + phone + email match
//
// Returns the directory list. Each row carries:
//   - core customer fields from MOCK_CUSTOMERS
//   - vehicles[] derived from MOCK_VEHICLES (year/make/model/id + first_id
//     for the "View vehicles" link)
//   - open_ros_count + last_service_date derived from MOCK_REPAIR_ORDERS
//   - is_service_overdue (Phase 9 — drives the orange "Service overdue"
//     badge on /customers and the default sort)
//   - has_open_loaner_request (Phase 9 — drives the "Open loaner requests"
//     sort; true if any recent call had summary.loaner_needed === true)
//   - last_call (date + outcome) from Supabase call_logs when available
//     (or MOCK_CALLS when USE_MOCK_DATA=true), null otherwise.

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
    is_service_overdue: boolean;
    has_open_loaner_request: boolean;
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
            is_service_overdue: isCustomerServiceOverdue(c.id),
            has_open_loaner_request: false,
            last_call: null,
        };
    });

    const persistence = await enrichFromCalls(rows, dealer.id);

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

/**
 * Walk recent calls — newest first — and stamp two derived fields on each
 * customer row:
 *
 *   - last_call: { date, outcome } from the first hit per customer_id
 *   - has_open_loaner_request: true iff any of the customer's recent calls
 *     (last 10 per customer) flagged summary.loaner_needed = true
 *
 * Source is Supabase when configured, otherwise MOCK_CALLS. Failure is
 * non-fatal — the page still renders.
 */
async function enrichFromCalls(
    rows: CustomerListRow[],
    dealerId: string,
): Promise<'supabase' | 'mock'> {
    const useMock = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';
    const supabase = useMock ? null : getSupabase();

    let records: Array<{ customer_id: string | null; started_at: string; summary: CallSummary | null }> = [];

    if (supabase) {
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
            } else {
                records = (data ?? []) as typeof records;
            }
        } catch (err) {
            console.error('[/api/customers] enrichment threw:', err instanceof Error ? err.message : err);
        }
    } else {
        records = MOCK_CALLS
            .filter((c) => c.customer_id != null)
            .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
            .map((c) => ({
                customer_id: c.customer_id,
                started_at: c.started_at ?? new Date().toISOString(),
                summary: c.summary,
            }));
    }

    const lastSeen = new Set<string>();
    const loanerCounts = new Map<string, number>();

    for (const row of records) {
        if (!row.customer_id) continue;
        const cust = rows.find((r) => r.id === row.customer_id);
        if (!cust) continue;

        if (!lastSeen.has(row.customer_id)) {
            lastSeen.add(row.customer_id);
            cust.last_call = {
                date: row.started_at,
                outcome: row.summary?.outcome ?? null,
            };
        }

        if (row.summary?.loaner_needed === true) {
            const prev = loanerCounts.get(row.customer_id) ?? 0;
            if (prev < 10) {
                loanerCounts.set(row.customer_id, prev + 1);
                cust.has_open_loaner_request = true;
            }
        }
    }

    return useMock || !supabase ? 'mock' : 'supabase';
}
