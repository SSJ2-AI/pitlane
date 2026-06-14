import { NextResponse } from 'next/server';
import { getSupabase, type CallLogRow, type AppointmentRow, type UpsellRow, type LoanerRequestRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';

// GET /api/calls/:id
//
// Returns the full record + every row created during the call:
//   { call, appointments, upsells, loaner_requests, persistence }
//
// 404 when not found, 503 when Supabase isn't configured.

export const dynamic = 'force-dynamic';

interface RouteContext {
    params: { id: string };
}

export async function GET(request: Request, context: RouteContext) {
    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json(
            { error: 'Supabase is not configured on this deploy', persistence: 'none' as const },
            { status: 503 },
        );
    }

    const id = context.params.id;
    if (!id) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
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
