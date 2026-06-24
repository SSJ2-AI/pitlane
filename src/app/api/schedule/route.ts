// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSupabase, type AppointmentRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';
import { getCustomerName, MOCK_APPOINTMENTS } from '@/lib/mock-customers';
import { MOCK_VEHICLES } from '@/lib/mock-vehicles';

// GET /api/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Phase 10 — feed the weekly calendar grid. Each row is an appointment
// enriched with customer_name + vehicle_label (rather than raw IDs).
// is_aria_booked drives the teal-vs-gray cell colour.

export const dynamic = 'force-dynamic';

export interface ScheduleRow extends AppointmentRow {
    customer_name: string | null;
    vehicle_label: string | null;
    is_aria_booked: boolean;
}

function inWeekRange(date: string, from: Date, to: Date): boolean {
    const d = new Date(date);
    return d >= from && d <= to;
}

function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function getMockSchedule(from: Date, to: Date): ScheduleRow[] {
    return MOCK_APPOINTMENTS.filter((a) => inWeekRange(a.date, from, to)).map((a) => {
        const v = MOCK_VEHICLES.find((mv) => mv.id === a.vehicle_id);
        return {
            id: a.id,
            customer_id: a.customer_id,
            dealer_id: 'aaaaaaaa-0000-0000-0000-000000000001',
            vehicle_id: a.vehicle_id,
            date: a.date,
            time: a.time,
            service_type: a.service_type,
            advisor: a.advisor_name,
            duration_est_hours: a.duration_est_hours,
            status: 'confirmed',
            confirmation_number: a.confirmation_number,
            cdk_id: null,
            call_log_id: a.source_call_id ?? null,
            created_at: new Date().toISOString(),
            customer_name: getCustomerName(a.customer_id),
            vehicle_label: v ? `${v.year} ${v.make} ${v.model}` : null,
            // Every mock appointment with a source_call_id was Aria-booked.
            is_aria_booked: Boolean(a.source_call_id),
        };
    });
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const from = searchParams.get('from') ? new Date(searchParams.get('from') as string) : new Date(now);
    const to = searchParams.get('to') ? new Date(searchParams.get('to') as string) : new Date(now);
    if (!searchParams.get('to')) to.setDate(to.getDate() + 7);

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({
            appointments: getMockSchedule(from, to),
            from: isoDate(from),
            to: isoDate(to),
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({
            appointments: getMockSchedule(from, to),
            from: isoDate(from),
            to: isoDate(to),
            persistence: 'mock',
        });
    }

    const dealer = await resolveDealerForRequest(request);
    const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('dealer_id', dealer.id)
        .gte('date', isoDate(from))
        .lte('date', isoDate(to))
        .neq('status', 'cancelled')
        .order('date', { ascending: true })
        .order('time', { ascending: true });

    if (error) {
        console.error('[/api/schedule] query failed:', error.message);
        return NextResponse.json({ appointments: [], from: isoDate(from), to: isoDate(to), persistence: 'supabase' });
    }

    const enriched = ((data ?? []) as AppointmentRow[]).map((a): ScheduleRow => {
        const v = MOCK_VEHICLES.find((mv) => mv.id === a.vehicle_id);
        return {
            ...a,
            customer_name: getCustomerName(a.customer_id),
            vehicle_label: v ? `${v.year} ${v.make} ${v.model}` : null,
            // appointments.is_aria_booked comes from migration 0009 — fall
            // back to call_log_id != null when the column isn't there yet.
            is_aria_booked:
                (a as AppointmentRow & { is_aria_booked?: boolean }).is_aria_booked === true ||
                Boolean(a.call_log_id),
        };
    });

    return NextResponse.json({
        appointments: enriched,
        from: isoDate(from),
        to: isoDate(to),
        persistence: 'supabase',
    });
}
