import { NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured, type CallLogRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';

export const dynamic = 'force-dynamic';

const MOCK_CALLS: CallLogRow[] = [
    { id: 'call_001', dealer_id: 'dealer_porsche_toronto', customer_id: 'cust_001', customer_name: 'James Whitfield', customer_phone: '647-555-0192', vehicle_vin: 'WP1AA2AY4MDA12345', duration_seconds: 187, summary: 'Called about 2021 Cayenne S service appointment. Discussed open recall Campaign 24V-271 (fuel injector) and declined rear brake replacement from Nov 2025. Booked Annual Service B for May 28.', outcome: 'appointment_booked', sentiment: 'positive', created_at: new Date(Date.now() - 3600000 * 2).toISOString(), upsells: [], appointments: ['appt_001'] },
    { id: 'call_002', dealer_id: 'dealer_porsche_toronto', customer_id: 'cust_002', customer_name: 'Sarah Park', customer_phone: '416-555-0847', vehicle_vin: 'WP0AA2A71LS200456', duration_seconds: 94, summary: 'Called for routine oil change inquiry. Confirmed 10:30 AM slot for tomorrow. Mentioned rattle noise from front end — flagged for inspection.', outcome: 'appointment_booked', sentiment: 'positive', created_at: new Date(Date.now() - 3600000 * 5).toISOString(), upsells: ['ups_002'], appointments: ['appt_002'] },
    { id: 'call_003', dealer_id: 'dealer_porsche_toronto', customer_id: 'cust_003', customer_name: 'Michael Chen', customer_phone: '905-555-0321', vehicle_vin: 'WP0CA2985NS610087', duration_seconds: 243, summary: 'Checking status of 911 GT3 repair order. Brake fluid + 60K service in progress. Requested loaner vehicle — Cayenne or equivalent. Estimated completion by 4 PM.', outcome: 'inquiry', sentiment: 'neutral', created_at: new Date(Date.now() - 86400000).toISOString(), upsells: [], appointments: [] },
    { id: 'call_004', dealer_id: 'dealer_porsche_toronto', customer_id: 'cust_004', customer_name: 'Priya Nair', customer_phone: '647-555-0411', vehicle_vin: 'WP0AB2A97NS123456', duration_seconds: 132, summary: 'Inquired about Taycan software update package. Quoted $420 CAD. Interested but wants to schedule next month after return from travel.', outcome: 'upsell_flagged', sentiment: 'positive', created_at: new Date(Date.now() - 86400000 * 2).toISOString(), upsells: ['ups_003'], appointments: [] },
    { id: 'call_005', dealer_id: 'dealer_porsche_toronto', customer_id: 'cust_005', customer_name: 'David Kowalski', customer_phone: '416-555-0992', vehicle_vin: 'WP1AE2AY9NDA55789', duration_seconds: 68, summary: 'Called to report issue with Macan Turbo — intermittent warning light. Booked diagnostic appointment for Monday.', outcome: 'issue_reported', sentiment: 'negative', created_at: new Date(Date.now() - 86400000 * 3).toISOString(), upsells: [], appointments: [] },
];

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    // Mock mode
    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        let calls = [...MOCK_CALLS];
        const outcome = searchParams.get('outcome');
        if (outcome) calls = calls.filter(c => c.outcome === outcome);
        const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
        const offset = parseInt(searchParams.get('offset') ?? '0', 10);
        return NextResponse.json({ calls: calls.slice(offset, offset + limit), total: calls.length, persistence: 'mock' });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ calls: [] as CallLogRow[], total: 0, persistence: 'none' });
    }

    const dealer = await resolveDealerForRequest(request);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    let query = supabase.from('call_logs').select('*', { count: 'exact' }).eq('dealer_id', dealer.id).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    const outcome = searchParams.get('outcome');
    if (outcome) query = query.eq('outcome' as any, outcome);
    const since = searchParams.get('since');
    if (since) query = query.gte('created_at', since);
    const until = searchParams.get('until');
    if (until) query = query.lte('created_at', until + 'T23:59:59Z');

    const { data, error, count } = await query;
    if (error) console.error('[/api/calls] query error:', error.message);

    return NextResponse.json({ calls: (data ?? []) as CallLogRow[], total: count ?? 0, persistence: 'supabase' });
}
