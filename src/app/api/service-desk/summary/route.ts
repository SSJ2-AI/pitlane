import { NextResponse } from 'next/server';
import { getSupabase, type AppointmentRow, type LoanerRequestRow, type UpsellRow } from '@/lib/supabase';

// GET /api/service-desk/summary
//
// One round trip that returns the four panels the service-desk page renders:
//   - today's arrivals (appointments where date = today)
//   - pending loaner requests (loaner_requests where status = 'pending')
//   - active upsell pipeline (upsells where status = 'pending', sorted by value_est desc)
//   - pipeline stats (counts + sum of value_est)
//
// Returns empty arrays when Supabase isn't configured so the page renders an
// instructive empty state instead of failing.

export const dynamic = 'force-dynamic';

function todayIso(): string {
    // ISO YYYY-MM-DD in UTC. The dashboard is shown to advisors in Toronto,
    // but server timezone may differ — using UTC is good enough for a
    // "today's arrivals" panel and avoids `date-fns-tz` as a dependency.
    return new Date().toISOString().slice(0, 10);
}

export async function GET() {
    const supabase = getSupabase();
    const today = todayIso();

    if (!supabase) {
        return NextResponse.json({
            persistence: 'none' as const,
            today,
            arrivals: [] as AppointmentRow[],
            loaner_queue: [] as LoanerRequestRow[],
            upsells: [] as UpsellRow[],
            stats: { arrivals_count: 0, loaner_pending: 0, upsell_count: 0, upsell_value: 0 },
        });
    }

    const [arrivalsRes, loanersRes, upsellsRes] = await Promise.all([
        supabase
            .from('appointments')
            .select('*')
            .eq('date', today)
            .neq('status', 'cancelled')
            .order('time', { ascending: true }),
        supabase
            .from('loaner_requests')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: false }),
        supabase
            .from('upsells')
            .select('*')
            .eq('status', 'pending')
            .order('value_est', { ascending: false, nullsFirst: false }),
    ]);

    if (arrivalsRes.error) console.error('[/api/service-desk/summary] arrivals:', arrivalsRes.error.message);
    if (loanersRes.error) console.error('[/api/service-desk/summary] loaners:', loanersRes.error.message);
    if (upsellsRes.error) console.error('[/api/service-desk/summary] upsells:', upsellsRes.error.message);

    const arrivals = (arrivalsRes.data ?? []) as AppointmentRow[];
    const loaners = (loanersRes.data ?? []) as LoanerRequestRow[];
    const upsells = (upsellsRes.data ?? []) as UpsellRow[];

    const upsellValue = upsells.reduce((sum, u) => sum + (u.value_est ?? 0), 0);

    return NextResponse.json({
        persistence: 'supabase' as const,
        today,
        arrivals,
        loaner_queue: loaners,
        upsells,
        stats: {
            arrivals_count: arrivals.length,
            loaner_pending: loaners.length,
            upsell_count: upsells.length,
            upsell_value: upsellValue,
        },
    });
}
