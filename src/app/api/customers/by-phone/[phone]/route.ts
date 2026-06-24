// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSupabase, type CallLogRow, type CustomerRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';
import { MOCK_CALLS } from '@/lib/mock-calls';
import { findMockCustomer, getCustomerName } from '@/lib/mock-customers';

// GET /api/customers/by-phone/:phone
//
// Phase 8b — return the customer (Supabase customers table when available,
// MOCK_CUSTOMERS as fallback for known cust_xxx demo numbers) plus EVERY
// call_log row for this phone number, newest first.
//
// Used by /customers/by-phone/:phone to show every conversation Aria has
// had with a single caller — even those that never made it into CDK.

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
        source: 'supabase' | 'mock';
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

    const customerLookup = await supabase
        .from('customers')
        .select('*')
        .eq('phone', phone)
        .eq('dealer_id', dealer.id)
        .maybeSingle();

    let customerRow: CustomerRow | null = null;
    if (customerLookup.error) {
        const code = (customerLookup.error as { code?: string }).code;
        if (code !== '42P01') {
            console.error('[/api/customers/by-phone] customers select failed:', customerLookup.error.message);
        }
    } else {
        customerRow = (customerLookup.data as CustomerRow | null) ?? null;
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
    const calls = ((callsRes.data ?? []) as CallLogRow[]).map((c) => ({
        ...c,
        customer_name: customerRow?.name ?? getCustomerName(c.customer_id),
    }));

    const customer: ByPhoneResponse['customer'] = customerRow
        ? {
              phone: customerRow.phone,
              name: customerRow.name,
              email: customerRow.email,
              is_new_customer: customerRow.is_new_customer,
              total_calls: customerRow.total_calls,
              last_call_at: customerRow.last_call_at,
              last_sentiment: customerRow.last_sentiment,
              source: 'supabase',
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
              source: 'supabase',
          }
        : null;

    return NextResponse.json({ customer, calls, persistence: 'supabase' });
}
