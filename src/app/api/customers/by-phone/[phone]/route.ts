// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSupabase, type CallLogRow, type CustomerRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';
import { isFortellisConfigured, lookupCustomerByPhone } from '@/lib/fortellis';
import { MOCK_CALLS } from '@/lib/mock-calls';
import { findMockCustomer, getCustomerName } from '@/lib/mock-customers';
import { recordAudit } from '@/lib/audit';
import { readSessionFromRequest } from '@/lib/role';

// GET /api/customers/by-phone/:phone
//
// CDK-FIRST READ POLICY (Phase 10 architectural principle, re-applied to
// Phase 8b after sprint review):
//
//   1. When Fortellis is configured, hit CDK first via
//      lookupCustomerByPhone(). When a record exists in CDK, return the
//      CDK row as the canonical customer — name, email, preferred
//      language all come from CDK. PitLane's local customers row is NOT
//      surfaced to the dashboard in that case (avoids divergence between
//      what the advisor sees here and in the DMS).
//
//   2. When CDK has no record OR Fortellis isn't configured, fall back to
//      the local customers index. The local row exists as metadata only —
//      phone, optionally a name Aria collected during a missed-CDK call,
//      created_at, and notes. It is explicitly the "everyone Aria has
//      talked to who isn't in CDK yet" set.
//
//   3. call_logs always come from Supabase regardless of CDK status —
//      they're Aria-generated, CDK doesn't own them.

export const dynamic = 'force-dynamic';

interface ByPhoneResponse {
    customer: {
        phone: string;
        name: string | null;
        email: string | null;
        is_new_customer: boolean;
        total_calls: number;
        last_call_at: string | null;
        last_sentiment: string | null;
        /** Source label drives the dashboard's "Live CDK" vs "Local
         *  metadata only" badge. cdk = canonical CDK record, supabase =
         *  Aria-collected local row, mock = MOCK_CUSTOMERS for demo. */
        source: 'cdk' | 'supabase' | 'mock';
    } | null;
    calls: Array<CallLogRow & { customer_name: string | null }>;
    persistence: 'supabase' | 'mock' | 'none';
}

function normalisePhone(input: string): string {
    if (!input) return '';
    const trimmed = decodeURIComponent(input).trim();
    if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`;
    return trimmed.replace(/\D/g, '');
}

export async function GET(
    request: Request,
    context: { params: { phone: string } },
): Promise<NextResponse<ByPhoneResponse>> {
    const rawPhone = context.params?.phone ?? '';
    const phone = normalisePhone(rawPhone);

    if (!phone) {
        return NextResponse.json({ customer: null, calls: [], persistence: 'none' }, { status: 400 });
    }

    // Mock-first when env flag is set OR Supabase isn't configured.
    const useMock = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true' || !getSupabase();
    if (useMock) {
        const mockCustomer = findMockCustomer(phone);
        const calls = MOCK_CALLS
            .filter((c) => normalisePhone(c.caller_phone) === phone || c.customer_id === mockCustomer?.id)
            .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
            .map((c) => ({ ...c, customer_name: getCustomerName(c.customer_id) }));
        return NextResponse.json({
            customer: mockCustomer
                ? {
                      phone: mockCustomer.phone,
                      name: `${mockCustomer.firstName} ${mockCustomer.lastName}`,
                      email: mockCustomer.email,
                      is_new_customer: false,
                      total_calls: calls.length,
                      last_call_at: calls[0]?.started_at ?? null,
                      last_sentiment: calls[0]?.summary?.sentiment ?? null,
                      source: 'mock' as const,
                  }
                : calls.length > 0
                ? {
                      phone,
                      name: null,
                      email: null,
                      is_new_customer: true,
                      total_calls: calls.length,
                      last_call_at: calls[0]?.started_at ?? null,
                      last_sentiment: calls[0]?.summary?.sentiment ?? null,
                      source: 'mock' as const,
                  }
                : null,
            calls,
            persistence: 'mock',
        });
    }

    const supabase = getSupabase()!;
    const dealer = await resolveDealerForRequest(request);

    // ─── Step 1 — CDK first ────────────────────────────────────────────────
    // CDK is the source of truth for customer contact info. Try Fortellis
    // BEFORE the local customers row so dashboard display matches DMS.
    let cdkCustomer = null as Awaited<ReturnType<typeof lookupCustomerByPhone>>;
    if (isFortellisConfigured()) {
        try {
            cdkCustomer = await lookupCustomerByPhone(phone);
        } catch (err) {
            console.error('[/api/customers/by-phone] CDK lookup failed (non-fatal):', err instanceof Error ? err.message : err);
        }
    }

    // ─── Step 2 — local metadata fallback ─────────────────────────────────
    // Only read the public.customers row when CDK didn't return a record.
    // The local row is metadata-only (phone, name when Aria collected one,
    // created_at, notes) — it doesn't duplicate CDK contact info.
    let customerRow: CustomerRow | null = null;
    if (!cdkCustomer) {
        const customerLookup = await supabase
            .from('customers')
            .select('*')
            .eq('phone', phone)
            .eq('dealer_id', dealer.id)
            .maybeSingle();
        if (customerLookup.error) {
            const code = (customerLookup.error as { code?: string }).code;
            if (code !== '42P01') {
                console.error('[/api/customers/by-phone] customers select failed:', customerLookup.error.message);
            }
        } else {
            customerRow = (customerLookup.data as CustomerRow | null) ?? null;
        }
    }

    const callsRes = await supabase
        .from('call_logs')
        .select('*')
        .eq('caller_phone', phone)
        .eq('dealer_id', dealer.id)
        .order('started_at', { ascending: false })
        .limit(200);

    if (callsRes.error) {
        console.error('[/api/customers/by-phone] call_logs select failed:', callsRes.error.message);
    }
    // PIPEDA correction (migration 0012): the local customers row no
    // longer has a `name` column. Display name comes from CDK when CDK
    // has the record, else falls back to the mock customer lookup, else
    // null (the page shows the phone number in that case).
    const displayName = cdkCustomer ? `${cdkCustomer.firstName} ${cdkCustomer.lastName}`.trim() : null;
    const calls = ((callsRes.data ?? []) as CallLogRow[]).map((c) => ({
        ...c,
        customer_name: displayName ?? getCustomerName(c.customer_id),
    }));

    let customer: ByPhoneResponse['customer'];
    if (cdkCustomer) {
        // CDK record wins — return canonical fields directly. We don't
        // surface the local total_calls/last_call_at on top of CDK
        // because those are Aria-only metrics that don't belong with
        // CDK-owned contact info; they're available via /api/calls
        // anyway. Last sentiment is the exception (Aria-derived).
        customer = {
            phone,
            name: `${cdkCustomer.firstName} ${cdkCustomer.lastName}`.trim(),
            email: cdkCustomer.email ?? null,
            is_new_customer: false,
            total_calls: calls.length,
            last_call_at: calls[0]?.started_at ?? null,
            last_sentiment: calls[0]?.summary?.sentiment ?? null,
            source: 'cdk',
        };
    } else if (customerRow) {
        // PIPEDA correction (migration 0012): no name / email on local row.
        // The page renders the phone as the title until CDK has the record.
        customer = {
            phone: customerRow.phone,
            name: null,
            email: null,
            is_new_customer: customerRow.is_new_customer,
            total_calls: customerRow.total_calls,
            last_call_at: customerRow.last_seen_at,
            last_sentiment: customerRow.last_sentiment,
            source: 'supabase',
        };
    } else if (calls.length > 0) {
        customer = {
            phone,
            name: null,
            email: null,
            is_new_customer: true,
            total_calls: calls.length,
            last_call_at: calls[0]?.started_at ?? null,
            last_sentiment: calls[0]?.summary?.sentiment ?? null,
            source: 'supabase',
        };
    } else {
        customer = null;
    }

    void recordAudit(request, readSessionFromRequest(request), {
        action: 'view_customer',
        resourceType: 'customer',
        resourceId: phone,
    });

    return NextResponse.json({ customer, calls, persistence: 'supabase' });
}
