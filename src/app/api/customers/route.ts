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
import { isFortellisConfigured, lookupCustomerByPhone } from '@/lib/fortellis';
import { getSupabase, type CallSummary, type CustomerRow } from '@/lib/supabase';

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
    /** Phase 8b — true when this row comes from public.customers (Aria
     *  auto-created) rather than MOCK_CUSTOMERS (canonical demo roster). */
    is_phone_only: boolean;
    last_sentiment: string | null;
    total_calls: number;
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
            is_phone_only: false,
            last_sentiment: null,
            total_calls: 0,
        };
    });

    const persistence = await enrichFromCalls(rows, dealer.id);
    await appendPhoneOnlyRows(rows, dealer.id);

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

/**
 * Phase 8b — append rows from public.customers (Aria auto-created callers)
 * that aren't already covered by MOCK_CUSTOMERS. Keyed by phone match.
 *
 * CDK-FIRST GUARD: when Fortellis is configured, each local row is checked
 * against CDK by phone. If CDK has the customer we DON'T surface the local
 * row in the directory — the canonical customer should appear via the CDK
 * read path (MOCK_CUSTOMERS today; live CDK once the customer pull lands).
 * The local row continues to exist purely as a metadata anchor for call
 * logs / callbacks / loaner requests keyed by phone.
 *
 * When Fortellis isn't configured we surface every local row — the
 * directory is the only place to find Aria-only callers in that case.
 */
async function appendPhoneOnlyRows(rows: CustomerListRow[], dealerId: string): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) return;

    const knownPhones = new Set(rows.map((r) => r.phone));
    const fortellisLive = isFortellisConfigured();

    try {
        const { data, error } = await supabase
            .from('customers')
            .select('*')
            .eq('dealer_id', dealerId)
            .order('last_call_at', { ascending: false, nullsFirst: false })
            .limit(200);
        if (error) {
            const code = (error as { code?: string }).code;
            if (code !== '42P01') {
                console.error('[/api/customers] phone-only enrichment failed:', error.message);
            }
            return;
        }
        for (const row of ((data ?? []) as CustomerRow[])) {
            if (knownPhones.has(row.phone)) continue;

            // CDK-first: when live Fortellis has the record, suppress
            // the local row so the dashboard doesn't show two entries
            // (one CDK, one local) for the same person. The CDK row
            // would normally come through MOCK_CUSTOMERS today; once a
            // real-CDK customer pull lands it'll feed the same loop.
            if (fortellisLive) {
                try {
                    const cdkHit = await lookupCustomerByPhone(row.phone);
                    if (cdkHit) continue;
                } catch (err) {
                    console.error('[/api/customers] CDK probe failed (non-fatal):', err instanceof Error ? err.message : err);
                }
            }

            rows.push({
                id: `phone:${row.phone}`,
                name: row.name ?? row.phone,
                first_name: row.name?.split(' ')[0] ?? '',
                last_name: row.name?.split(' ').slice(1).join(' ') ?? '',
                phone: row.phone,
                email: row.email ?? '',
                loyalty_tier: 'Bronze',
                preferred_language: 'en',
                customer_since_year: row.created_at ? new Date(row.created_at).getFullYear() : new Date().getFullYear(),
                lifetime_visits: row.total_calls,
                lifetime_spend: 0,
                vehicles: [],
                open_ros_count: 0,
                last_service_date: null,
                is_service_overdue: false,
                has_open_loaner_request: false,
                last_call: row.last_call_at ? { date: row.last_call_at, outcome: null } : null,
                is_phone_only: true,
                last_sentiment: row.last_sentiment,
                total_calls: row.total_calls,
            });
        }
    } catch (err) {
        console.error('[/api/customers] appendPhoneOnlyRows threw:', err instanceof Error ? err.message : err);
    }
}
