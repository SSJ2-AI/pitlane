// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSupabase, type AppointmentRow, type LoanerRequestRow, type UpsellRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';

export const dynamic = 'force-dynamic';

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

function getMockSummary(today: string) {
    const arrivals: AppointmentRow[] = [
        { id: 'appt_001', customer_id: 'cust_001', dealer_id: 'dealer_porsche_toronto', vehicle_id: 'veh_001a', date: today, time: '09:00', service_type: 'Annual Service B + Recall 24V-271', advisor: 'Marco Alvarez', duration_est_hours: 2.5, status: 'confirmed', confirmation_number: 'PCA-001', cdk_id: null, call_log_id: 'call_001', created_at: new Date().toISOString() },
        { id: 'appt_002', customer_id: 'cust_002', dealer_id: 'dealer_porsche_toronto', vehicle_id: 'veh_002a', date: today, time: '10:30', service_type: 'Oil Change + Tire Rotation', advisor: 'Nina Patel', duration_est_hours: 1.5, status: 'confirmed', confirmation_number: 'PCA-002', cdk_id: null, call_log_id: 'call_002', created_at: new Date().toISOString() },
        { id: 'appt_003', customer_id: 'cust_003', dealer_id: 'dealer_porsche_toronto', vehicle_id: 'veh_003a', date: today, time: '14:00', service_type: 'Brake Fluid + 60K Service', advisor: 'Marco Alvarez', duration_est_hours: 4.0, status: 'scheduled', confirmation_number: 'PCA-003', cdk_id: null, call_log_id: 'call_003', created_at: new Date().toISOString() },
    ];
    const loaner_queue: LoanerRequestRow[] = [
        { id: 'loan_001', call_log_id: 'call_003', appointment_id: 'appt_003', customer_id: 'cust_003', dealer_id: 'dealer_porsche_toronto', requested_date: today, loaner_preferred: 'SUV — Cayenne or Macan', status: 'pending', notes: 'Customer dropping off at 2 PM', resolved_by: null, resolved_at: null, created_at: new Date().toISOString() },
    ];
    const upsells: UpsellRow[] = [
        { id: 'ups_001', call_log_id: 'call_001', customer_id: 'cust_001', dealer_id: 'dealer_porsche_toronto', vehicle_id: 'veh_001a', upsell_type: 'brake_replacement', description: 'Rear Brake Replacement — previously declined Nov 2025', value_est: 875, status: 'pending', created_at: new Date(Date.now() - 86400000 * 3).toISOString() },
        { id: 'ups_002', call_log_id: 'call_002', customer_id: 'cust_002', dealer_id: 'dealer_porsche_toronto', vehicle_id: 'veh_002a', upsell_type: 'cabin_air_filter', description: 'Cabin Air Filter Replacement', value_est: 240, status: 'pending', created_at: new Date(Date.now() - 86400000).toISOString() },
        { id: 'ups_003', call_log_id: 'call_004', customer_id: 'cust_004', dealer_id: 'dealer_porsche_toronto', vehicle_id: 'veh_004a', upsell_type: 'software_update', description: 'Annual Taycan Software Update Package', value_est: 420, status: 'pending', created_at: new Date(Date.now() - 86400000 * 2).toISOString() },
    ];
    const upsellValue = upsells.reduce((s, u) => s + (u.value_est ?? 0), 0);
    return { persistence: 'supabase' as const, today, arrivals, loaner_queue, upsells, stats: { arrivals_count: arrivals.length, loaner_pending: loaner_queue.length, upsell_count: upsells.length, upsell_value: upsellValue } };
}

export async function GET(request: Request) {
    const today = todayIso();
    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json(getMockSummary(today));
    }
    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ persistence: 'none' as const, today, arrivals: [] as AppointmentRow[], loaner_queue: [] as LoanerRequestRow[], upsells: [] as UpsellRow[], stats: { arrivals_count: 0, loaner_pending: 0, upsell_count: 0, upsell_value: 0 } });
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
    return NextResponse.json({ persistence: 'supabase' as const, today, arrivals, loaner_queue: loaners, upsells, stats: { arrivals_count: arrivals.length, loaner_pending: loaners.length, upsell_count: upsells.length, upsell_value: upsellValue } });
}
