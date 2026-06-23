import { NextResponse } from 'next/server';
import {
    findMockCustomer,
    getTodaysAppointments,
    MOCK_APPOINTMENTS,
    type MockAppointment,
} from '@/lib/mock-customers';
import { MOCK_CALLS } from '@/lib/mock-calls';
import { MOCK_VEHICLES } from '@/lib/mock-vehicles';
import type { CallSummary, UpsellFlag } from '@/lib/supabase';

// /api/appointments/today
//
// Denormalised feed for the /dashboard "Today's appointments" briefing
// panel. Each row carries everything the panel needs to render without a
// follow-up request:
//
//   - customer name / id / loyalty tier
//   - vehicle year/make/model + id (so "View vehicle" can link out)
//   - the appointment itself (time, service, advisor)
//   - aria_context: the call summary + 1-line excerpt from the call that
//     booked this appointment (joined via source_call_id)
//   - upsells_flagged: the last call's flagged upsells, surfaced as a
//     "Upsells to surface" chip when present
//
// Source: MOCK_APPOINTMENTS until Phase 6 puts a real `appointments` query
// in here. Spec lets us run on mock data throughout.

export const dynamic = 'force-dynamic';

export interface TodaysAppointmentRow {
    id: string;
    date: string;
    time: string;
    service_type: string;
    advisor_name: string;
    duration_est_hours: number;
    confirmation_number: string;
    notes: string | null;
    customer: {
        id: string;
        name: string;
        loyalty_tier: string;
    };
    vehicle: {
        id: string;
        year: number;
        make: string;
        model: string;
        trim?: string;
    } | null;
    aria_context: {
        call_id: string;
        booked_at: string;
        excerpt: string;
        outcome: CallSummary['outcome'] | null;
    } | null;
    upsells_to_surface: UpsellFlag[];
}

interface ResponseShape {
    label: 'today' | 'tomorrow' | 'upcoming';
    appointments: TodaysAppointmentRow[];
    persistence: 'mock';
}

function buildExcerpt(summary: CallSummary | null | undefined): string {
    if (!summary?.summary_text) return '';
    // First sentence (or up to 140 chars) — the panel shows this as
    // "Aria booked this on [date] — [excerpt]".
    const trimmed = summary.summary_text.trim();
    const firstSentence = trimmed.split(/(?<=[.!?])\s+/)[0] ?? trimmed;
    return firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}…` : firstSentence;
}

function shape(appt: MockAppointment): TodaysAppointmentRow {
    const customer = findMockCustomer(appt.customer_id);
    const vehicle = MOCK_VEHICLES.find((v) => v.id === appt.vehicle_id) ?? null;

    const sourceCall = appt.source_call_id
        ? MOCK_CALLS.find((c) => c.id === appt.source_call_id) ?? null
        : null;

    // "Upsells to surface" — most-recent call for this customer that
    // flagged upsells, regardless of whether it's the source call.
    const recentUpsellCall = MOCK_CALLS
        .filter((c) => c.customer_id === appt.customer_id && (c.summary?.upsells_flagged?.length ?? 0) > 0)
        .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0];

    return {
        id: appt.id,
        date: appt.date,
        time: appt.time,
        service_type: appt.service_type,
        advisor_name: appt.advisor_name,
        duration_est_hours: appt.duration_est_hours,
        confirmation_number: appt.confirmation_number,
        notes: appt.notes ?? null,
        customer: {
            id: appt.customer_id,
            name: customer ? `${customer.firstName} ${customer.lastName}` : appt.customer_id,
            loyalty_tier: customer?.loyaltyTier ?? 'Bronze',
        },
        vehicle: vehicle
            ? {
                  id: vehicle.id,
                  year: vehicle.year,
                  make: vehicle.make,
                  model: vehicle.model,
                  trim: vehicle.trim,
              }
            : null,
        aria_context: sourceCall
            ? {
                  call_id: sourceCall.id,
                  booked_at: sourceCall.started_at,
                  excerpt: buildExcerpt(sourceCall.summary),
                  outcome: sourceCall.summary?.outcome ?? null,
              }
            : null,
        upsells_to_surface: recentUpsellCall?.summary?.upsells_flagged ?? [],
    };
}

export async function GET(): Promise<NextResponse<ResponseShape>> {
    const { appointments, label } = getTodaysAppointments();
    return NextResponse.json({
        label,
        appointments: appointments.slice(0, 5).map(shape),
        persistence: 'mock',
    });
}
