// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSupabase, type CallLogRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';

export const dynamic = 'force-dynamic';

const MOCK_CALLS: CallLogRow[] = [
    {
        id: 'call_001', caller_phone: '647-555-0192', customer_id: 'cust_001', dealer_id: 'dealer_porsche_toronto',
        call_sid: null, conversation_id: null, direction: 'inbound', duration_secs: 187,
        summary: {
            outcome: 'appointment_booked', sentiment: 'positive', loaner_needed: false,
            topics: ['service appointment', 'recall 24V-271'],
            upsells_flagged: [{ type: 'brake_replacement', description: 'Rear Brake Replacement', value_est: 875 }],
            action_items: ['Book Annual Service B for May 28'],
            summary_text: 'Customer called about 2021 Cayenne S. Discussed open recall 24V-271 (fuel injector). Annual Service B booked for May 28. Rear brake replacement declined again.',
            generated_by: 'openai',
        },
        transcript: null, status: 'completed',
        started_at: new Date(Date.now() - 3600000 * 2).toISOString(),
        ended_at: new Date(Date.now() - 3600000 * 2 + 187000).toISOString(),
        created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    },
    {
        id: 'call_002', caller_phone: '416-555-0847', customer_id: 'cust_002', dealer_id: 'dealer_porsche_toronto',
        call_sid: null, conversation_id: null, direction: 'inbound', duration_secs: 94,
        summary: {
            outcome: 'appointment_booked', sentiment: 'positive', loaner_needed: false,
            topics: ['oil change', 'noise complaint'],
            upsells_flagged: [{ type: 'cabin_air_filter', description: 'Cabin Air Filter', value_est: 240 }],
            action_items: ['Confirm 10:30 AM slot', 'Inspect front-end rattle'],
            summary_text: 'Routine oil change inquiry. Confirmed 10:30 AM tomorrow. Customer mentioned front-end rattle — flagged for inspection.',
            generated_by: 'openai',
        },
        transcript: null, status: 'completed',
        started_at: new Date(Date.now() - 3600000 * 5).toISOString(),
        ended_at: new Date(Date.now() - 3600000 * 5 + 94000).toISOString(),
        created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    },
    {
        id: 'call_003', caller_phone: '905-555-0321', customer_id: 'cust_003', dealer_id: 'dealer_porsche_toronto',
        call_sid: null, conversation_id: null, direction: 'inbound', duration_secs: 243,
        summary: {
            outcome: 'inquiry', sentiment: 'neutral', loaner_needed: true,
            topics: ['RO status', 'loaner request'],
            upsells_flagged: [],
            action_items: ['Confirm completion by 4 PM', 'Arrange Cayenne loaner'],
            summary_text: 'Checking status of 911 GT3 repair order. Brake fluid + 60K service in progress. Customer requested loaner — Cayenne or equivalent. ETA 4 PM.',
            generated_by: 'openai',
        },
        transcript: null, status: 'completed',
        started_at: new Date(Date.now() - 86400000).toISOString(),
        ended_at: new Date(Date.now() - 86400000 + 243000).toISOString(),
        created_at: new Date(Date.now() - 86400000).toISOString(),
    },
    {
        id: 'call_004', caller_phone: '647-555-0411', customer_id: 'cust_004', dealer_id: 'dealer_porsche_toronto',
        call_sid: null, conversation_id: null, direction: 'inbound', duration_secs: 132,
        summary: {
            outcome: 'upsell_flagged', sentiment: 'positive', loaner_needed: false,
            topics: ['Taycan software update'],
            upsells_flagged: [{ type: 'software_update', description: 'Annual Software Update Package', value_est: 420 }],
            action_items: ['Follow up in 4 weeks after travel'],
            summary_text: 'Inquired about Taycan software update package. Quoted $420 CAD. Interested but wants to schedule next month after return from travel.',
            generated_by: 'openai',
        },
        transcript: null, status: 'completed',
        started_at: new Date(Date.now() - 86400000 * 2).toISOString(),
        ended_at: new Date(Date.now() - 86400000 * 2 + 132000).toISOString(),
        created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
        id: 'call_005', caller_phone: '416-555-0992', customer_id: 'cust_005', dealer_id: 'dealer_porsche_toronto',
        call_sid: null, conversation_id: null, direction: 'inbound', duration_secs: 68,
        summary: {
            outcome: 'issue_reported', sentiment: 'negative', loaner_needed: false,
            topics: ['warning light', 'diagnostic'],
            upsells_flagged: [],
            action_items: ['Book Monday diagnostic appointment'],
            summary_text: 'Macan Turbo intermittent warning light reported. Diagnostic booked for Monday morning.',
            generated_by: 'openai',
        },
        transcript: null, status: 'completed',
        started_at: new Date(Date.now() - 86400000 * 3).toISOString(),
        ended_at: new Date(Date.now() - 86400000 * 3 + 68000).toISOString(),
        created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
];

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        let calls = [...MOCK_CALLS];
        const outcome = searchParams.get('outcome');
        if (outcome) calls = calls.filter(c => c.summary?.outcome === outcome);
        const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
        const offset = parseInt(searchParams.get('offset') ?? '0', 10);
        return NextResponse.json({ calls: calls.slice(offset, offset + limit), total: calls.length, persistence: 'supabase' });
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
