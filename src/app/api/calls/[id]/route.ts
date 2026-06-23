import { NextResponse } from 'next/server';
import {
    getSupabase,
    type AppointmentRow,
    type CallLogRow,
    type LoanerRequestRow,
    type UpsellRow,
} from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';
import { MOCK_CALLS } from '@/lib/mock-calls';

// GET /api/calls/:id
//
// Returns the full record + every row created during the call:
//   { call, appointments, upsells, loaner_requests, persistence }
//
// 404 when not found.
//
// Mock-mode handling (NEXT_PUBLIC_USE_MOCK_DATA=true on Vercel preview /
// demo deploys): synthesise appointments/upsells/loaner_requests from
// MOCK_CALLS.summary so the calls detail pane has something to render.
// Without this branch the route would 503 on Vercel (no Supabase) and
// the client's setDetail(errorObject) crashed when reading detail.call.

export const dynamic = 'force-dynamic';

interface RouteContext {
    params: { id: string };
}

const DEMO_DEALER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function buildMockResponse(call: CallLogRow) {
    const summary = call.summary;
    const customerId = call.customer_id ?? '';

    const upsells: UpsellRow[] = (summary?.upsells_flagged ?? []).map((u, idx) => ({
        id: `mock-upsell-${call.id}-${idx}`,
        call_log_id: call.id,
        customer_id: customerId,
        dealer_id: call.dealer_id ?? DEMO_DEALER_ID,
        vehicle_id: '',
        upsell_type: u.type,
        description: u.description ?? null,
        value_est: u.value_est ?? null,
        status: 'flagged',
        created_at: call.started_at,
    }));

    const loaner_requests: LoanerRequestRow[] = summary?.loaner_needed
        ? [
              {
                  id: `mock-loaner-${call.id}`,
                  call_log_id: call.id,
                  appointment_id: null,
                  customer_id: customerId,
                  dealer_id: call.dealer_id ?? DEMO_DEALER_ID,
                  requested_date: null,
                  loaner_preferred: null,
                  status: 'pending',
                  notes: summary?.summary_text ?? null,
                  resolved_by: null,
                  resolved_at: null,
                  created_at: call.started_at,
              },
          ]
        : [];

    return {
        call,
        appointments: [] as AppointmentRow[],
        upsells,
        loaner_requests,
        persistence: 'mock' as const,
    };
}

export async function GET(request: Request, context: RouteContext) {
    const id = context.params.id;
    if (!id) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        const call = MOCK_CALLS.find((c) => c.id === id);
        if (!call) {
            return NextResponse.json({ error: 'Call not found' }, { status: 404 });
        }
        return NextResponse.json(buildMockResponse(call));
    }

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
        upsells: (upsellResult.data ?? []) as UpsellRow[],
        loaner_requests: (loanerResult.data ?? []) as LoanerRequestRow[],
        dealer: { id: dealer.id, name: dealer.name },
        persistence: 'supabase' as const,
    });
}
