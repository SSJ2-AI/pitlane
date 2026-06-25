// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { canViewGroupConsole, readSessionFromRequest } from '@/lib/role';
import { getVehicleWarrantyInfo, MOCK_VEHICLES } from '@/lib/mock-vehicles';

// GET /api/group/summary
//
// group_manager-only feed for the /group dashboard. Aggregates per-dealer
// counts + a group total. Reads from Supabase when configured, falls back
// to a deterministic mock derived from MOCK_VEHICLES + the existing mock
// dealer roster.

export const dynamic = 'force-dynamic';

interface DealerStats {
    dealer_id: string;
    dealer_name: string;
    brand: string;
    calls_today: number;
    calls_this_week: number;
    callbacks_pending: number;
    callbacks_frustrated: number;
    open_repair_orders: number;
    avg_sentiment_score: number | null;
    loaners_active: number;
    warranty_expiring_soon: number;
    warranty_expired: number;
    top_topics: string[];
}

interface GroupSummary {
    dealers: DealerStats[];
    totals: {
        dealers_count: number;
        calls_today: number;
        calls_this_week: number;
        callbacks_pending: number;
        open_repair_orders: number;
        loaners_active: number;
        warranty_alerts: number;
    };
    top_callback_reasons: Array<{ reason: string; count: number }>;
    persistence: 'supabase' | 'mock';
}

function startOfDayIso(): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
}

function weekAgoIso(): string {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString();
}

function getMockSummary(): GroupSummary {
    // Walk the mock vehicle roster as the source of warranty signal.
    let expiringSoon = 0;
    let expired = 0;
    for (const v of MOCK_VEHICLES) {
        const w = getVehicleWarrantyInfo(v);
        if (w.status === 'expiring_soon') expiringSoon += 1;
        if (w.status === 'expired') expired += 1;
    }

    const dealers: DealerStats[] = [
        {
            dealer_id: 'aaaaaaaa-0000-0000-0000-000000000001',
            dealer_name: 'Pfaff Porsche Toronto',
            brand: 'porsche',
            calls_today: 12,
            calls_this_week: 64,
            callbacks_pending: 3,
            callbacks_frustrated: 1,
            open_repair_orders: 8,
            avg_sentiment_score: 0.71,
            loaners_active: 2,
            warranty_expiring_soon: expiringSoon,
            warranty_expired: expired,
            top_topics: ['recall remediation', 'oil change', 'brake service'],
        },
        {
            dealer_id: 'aaaaaaaa-0000-0000-0000-000000000002',
            dealer_name: 'Pfaff Audi Vaughan',
            brand: 'audi',
            calls_today: 7,
            calls_this_week: 41,
            callbacks_pending: 1,
            callbacks_frustrated: 0,
            open_repair_orders: 5,
            avg_sentiment_score: 0.82,
            loaners_active: 1,
            warranty_expiring_soon: 1,
            warranty_expired: 0,
            top_topics: ['software update', 'tire rotation'],
        },
        {
            dealer_id: 'aaaaaaaa-0000-0000-0000-000000000003',
            dealer_name: 'Pfaff BMW Mississauga',
            brand: 'bmw',
            calls_today: 5,
            calls_this_week: 29,
            callbacks_pending: 0,
            callbacks_frustrated: 0,
            open_repair_orders: 3,
            avg_sentiment_score: 0.65,
            loaners_active: 0,
            warranty_expiring_soon: 0,
            warranty_expired: 0,
            top_topics: ['M warranty', 'inspection'],
        },
    ];

    const totals = dealers.reduce(
        (acc, d) => ({
            dealers_count: acc.dealers_count + 1,
            calls_today: acc.calls_today + d.calls_today,
            calls_this_week: acc.calls_this_week + d.calls_this_week,
            callbacks_pending: acc.callbacks_pending + d.callbacks_pending,
            open_repair_orders: acc.open_repair_orders + d.open_repair_orders,
            loaners_active: acc.loaners_active + d.loaners_active,
            warranty_alerts: acc.warranty_alerts + d.warranty_expiring_soon + d.warranty_expired,
        }),
        { dealers_count: 0, calls_today: 0, calls_this_week: 0, callbacks_pending: 0, open_repair_orders: 0, loaners_active: 0, warranty_alerts: 0 },
    );

    return {
        dealers,
        totals,
        top_callback_reasons: [
            { reason: 'Wants to speak with their advisor', count: 4 },
            { reason: 'Warranty inquiry', count: 3 },
            { reason: 'Loaner confirmation', count: 2 },
            { reason: 'Recall question', count: 2 },
        ],
        persistence: 'mock',
    };
}

export async function GET(request: Request) {
    const session = readSessionFromRequest(request);
    if (!canViewGroupConsole(session.role)) {
        return NextResponse.json({ error: 'Forbidden — group managers only.' }, { status: 403 });
    }

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json(getMockSummary());
    }

    const supabase = getSupabase();
    if (!supabase) return NextResponse.json(getMockSummary());

    try {
        const { data: dealersData, error: dealersError } = await supabase
            .from('dealers')
            .select('id,name,brand')
            .eq('active', true)
            .order('name', { ascending: true });
        if (dealersError) {
            console.error('[/api/group/summary] dealers select failed:', dealersError.message);
            return NextResponse.json(getMockSummary());
        }
        const dealers = (dealersData ?? []) as Array<{ id: string; name: string; brand: string }>;
        if (dealers.length === 0) return NextResponse.json(getMockSummary());

        const today = startOfDayIso();
        const weekAgo = weekAgoIso();

        const perDealer = await Promise.all(dealers.map(async (d): Promise<DealerStats> => {
            const [todayCalls, weekCalls, pendingCb, frustratedCb, openROs, sentimentAvg, activeLoaners] = await Promise.all([
                supabase.from('call_logs').select('id', { count: 'exact', head: true }).eq('dealer_id', d.id).gte('started_at', today),
                supabase.from('call_logs').select('id', { count: 'exact', head: true }).eq('dealer_id', d.id).gte('started_at', weekAgo),
                supabase.from('callback_requests').select('id', { count: 'exact', head: true }).eq('dealer_id', d.id).eq('status', 'pending'),
                supabase.from('callback_requests').select('id', { count: 'exact', head: true }).eq('dealer_id', d.id).eq('sentiment', 'frustrated'),
                supabase.from('repair_order_assignments').select('id', { count: 'exact', head: true }).eq('dealer_id', d.id).in('service_status', ['in_progress', 'awaiting_parts', 'extended']),
                supabase.from('call_logs').select('sentiment_score').eq('dealer_id', d.id).not('sentiment_score', 'is', null).gte('started_at', weekAgo),
                supabase.from('loaner_requests').select('id', { count: 'exact', head: true }).eq('dealer_id', d.id).in('status', ['pending', 'approved']),
            ]);

            const scores = ((sentimentAvg.data ?? []) as Array<{ sentiment_score: number | null }>)
                .map((r) => r.sentiment_score)
                .filter((s): s is number => typeof s === 'number');
            const avgScore = scores.length === 0 ? null : Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;

            return {
                dealer_id: d.id,
                dealer_name: d.name,
                brand: d.brand,
                calls_today: todayCalls.count ?? 0,
                calls_this_week: weekCalls.count ?? 0,
                callbacks_pending: pendingCb.count ?? 0,
                callbacks_frustrated: frustratedCb.count ?? 0,
                open_repair_orders: openROs.count ?? 0,
                avg_sentiment_score: avgScore,
                loaners_active: activeLoaners.count ?? 0,
                warranty_expiring_soon: 0,
                warranty_expired: 0,
                top_topics: [],
            };
        }));

        const totals = perDealer.reduce(
            (acc, d) => ({
                dealers_count: acc.dealers_count + 1,
                calls_today: acc.calls_today + d.calls_today,
                calls_this_week: acc.calls_this_week + d.calls_this_week,
                callbacks_pending: acc.callbacks_pending + d.callbacks_pending,
                open_repair_orders: acc.open_repair_orders + d.open_repair_orders,
                loaners_active: acc.loaners_active + d.loaners_active,
                warranty_alerts: acc.warranty_alerts + d.warranty_expiring_soon + d.warranty_expired,
            }),
            { dealers_count: 0, calls_today: 0, calls_this_week: 0, callbacks_pending: 0, open_repair_orders: 0, loaners_active: 0, warranty_alerts: 0 },
        );

        // Top callback reasons across the group.
        const reasons = await supabase
            .from('callback_requests')
            .select('reason')
            .gte('created_at', weekAgo)
            .limit(500);
        const reasonCounts = new Map<string, number>();
        for (const r of ((reasons.data ?? []) as Array<{ reason: string | null }>)) {
            const key = (r.reason ?? '').trim().toLowerCase();
            if (!key) continue;
            reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
        }
        const top_callback_reasons = Array.from(reasonCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([reason, count]) => ({ reason, count }));

        return NextResponse.json({ dealers: perDealer, totals, top_callback_reasons, persistence: 'supabase' });
    } catch (err) {
        console.error('[/api/group/summary] aggregation threw:', err instanceof Error ? err.message : err);
        return NextResponse.json(getMockSummary());
    }
}
