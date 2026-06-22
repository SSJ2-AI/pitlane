import { NextResponse } from 'next/server';
import { getSupabase, type AppointmentRow, type LoanerRequestRow, type UpsellRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';

export const dynamic = 'force-dynamic';

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

// ─── Mock data for demo/Vercel preview ───────────────────────────────────────

function getMockSummary(today: string) {
    const arrivals: AppointmentRow[] = [
        { id: 'appt_001', dealer_id: 'dealer_porsche_toronto', customer_id: 'cust_001', customer_name: 'James Whitfield', customer_phone: '647-555-0192', vehicle_vin: 'WP1AA2AY4MDA12345', vehicle_desc: '2021 Porsche Cayenne S', date: today, time: '09:00', status: 'confirmed', services_requested: ['Annual Service B', 'Recall Remedy 24V-271'], notes: 'Recall remedy available — book now', created_at: new Date().toISOString() },
        { id: 'appt_002', dealer_id: 'dealer_porsche_toronto', customer_id: 'cust_002', customer_name: 'Sarah Park', customer_phone: '416-555-0847', vehicle_vin: 'WP0AA2A71LS200456', vehicle_desc: '2022 Porsche Macan GTS', date: today, time: '10:30', status: 'confirmed', services_requested: ['Oil Change', 'Tire Rotation'], notes: null, created_at: new Date().toISOString() },
        { id: 'appt_003', dealer_id: 'dealer_porsche_toronto', customer_id: 'cust_003', customer_name: 'Michael Chen', customer_phone: '905-555-0321', vehicle_vin: 'WP0CA2985NS610087', vehicle_desc: '2023 Porsche 911 GT3', date: today, time: '14:00', status: 'scheduled', services_requested: ['Brake Fluid Replacement', '60,000 km Service'], notes: '2nd vehicle dropping off — needs loaner', created_at: new Date().toISOString() },
    ];
    const loaner_queue: LoanerRequestRow[] = [
        { id: 'loan_001', dealer_id: 'dealer_porsche_toronto', customer_id: 'cust_003', customer_name: 'Michael Chen', customer_phone: '905-555-0321', requested_at: new Date().toISOString(), status: 'pending', notes: 'Requested Cayenne loaner, any SUV fine', created_at: new Date().toISOString() },
    ];
    const upsells: UpsellRow[] = [
        { id: 'ups_001', dealer_id: 'dealer_porsche_toronto', customer_id: 'cust_001', customer_name: 'James Whitfield', vehicle_vin: 'WP1AA2AY4MDA12345', vehicle_desc: '2021 Cayenne S', description: 'Rear Brake Replacement — previously declined Nov 2025', status: 'pending', value_est: 875, created_at: new Date(Date.now() - 86400000 * 3).toISOString() },
        { id: 'ups_002', dealer_id: 'dealer_porsche_toronto', customer_id: 'cust_002', customer_name: 'Sarah Park', vehicle_vin: 'WP0AA2A71LS200456', vehicle_desc: '2022 Macan GTS', description: 'Cabin Air Filter Replacement', status: 'pending', value_est: 240, created_at: new Date(Date.now() - 86400000).toISOString() },
        { id: 'ups_003', dealer_id: 'dealer_porsche_toronto', customer_id: 'cust_004', customer_name: 'Priya Nair', vehicle_vin: 'WP0AB2A97NS123456', vehicle_desc: '2022 Porsche Taycan', description: 'Annual Software Update Package', status: 'pending', value_est: 420, created_at: new Date(Date.now() - 86400000 * 2).toISOString() },
    ];
    const upsellValue = upsells.reduce((s, u) => s + (u.value_est ?? 0), 0);
    return {
        persistence: 'mock' as const,
        today,
        arrivals,
        loaner_queue,
        upsells,
        stats: { arrivals_count: arrivals.length, loaner_pending: loaner_queue.length, upsell_count: upsells.length, upsell_value: upsellValue },
    };
}

export async function GET(request: Request) {
    const today = todayIso();

    // Mock mode — return rich demo data (no Supabase needed)
    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json(getMockSummary(today));
    }

    const supabase = getSupabase();

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

    const dealer = await resolveDealerForRequest(request);

    const [arrivalsRes, loanersRes, upsellsRes] = await Promise.all([
        supabase.from('appointments').select('*').eq('dealer_id', dealer.id).eq('date', today).neq('status', 'cancelled').order('time', { ascending: true }),
        supabase.from('loaner_requests').select('*').eq('dealer_id', dealer.id).eq('status', 'pending').order('created_at', { ascending: false }),
        supabase.from('upsells').select('*').eq('dealer_id', dealer.id).eq('status', 'pending').order('value_est', { ascending: false, nullsFirst: false }),
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
        stats: { arrivals_count: arrivals.length, loaner_pending: loaners.length, upsell_count: upsells.length, upsell_value: upsellValue },
    });
}
