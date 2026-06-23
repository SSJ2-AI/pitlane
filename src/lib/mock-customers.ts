// ─── PitLane mock customer dataset (dashboard side) ─────────────────────────
//
// Canonical customer dataset for the dashboard /customers + /customers/[id]
// pages. Aligned with voice/src/mock/customers.ts (the voice-side
// MOCK_CUSTOMERS) and src/lib/mock-vehicles.ts so cust_001 → James Whitfield
// in every surface: voice tools, vehicle detail pages, calls timeline,
// customer directory.
//
// When Phase 6 (hourly CDK pull) lands this gets replaced by Supabase reads
// against a `customers` table. Until then this is the demo + meeting-walkthrough
// dataset.

import { MOCK_REPAIR_ORDERS, MOCK_VEHICLES, type MockVehicle } from './mock-vehicles';
import { predictNextServiceForVehicle } from './next-service';

export type LoyaltyTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

export interface MockCustomer {
    id: string;
    firstName: string;
    lastName: string;
    phone: string; // E.164
    altPhone?: string;
    email: string;
    address?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    preferredLanguage: 'en' | 'fr';
    customerSinceYear: number;
    lifetimeVisits: number;
    lifetimeSpend: number;
    loyaltyTier: LoyaltyTier;
    notes?: string;
}

export const MOCK_CUSTOMERS: MockCustomer[] = [
    {
        id: 'cust_001',
        firstName: 'James',
        lastName: 'Whitfield',
        phone: '+16475550101',
        email: 'james.whitfield@gmail.com',
        address: '142 Rosedale Valley Rd',
        city: 'Toronto',
        province: 'ON',
        postalCode: 'M4W 1P9',
        preferredLanguage: 'en',
        customerSinceYear: 2018,
        lifetimeVisits: 14,
        lifetimeSpend: 48200,
        loyaltyTier: 'Gold',
        notes:
            'Prefers loaner vehicle for any service over 4 hours. Long-term client since 2018.',
    },
    {
        id: 'cust_002',
        firstName: 'Priya',
        lastName: 'Mehta',
        phone: '+14165550202',
        altPhone: '+14165550203',
        email: 'priya.mehta@nexuslaw.ca',
        address: '55 Bloor St W, Suite 1200',
        city: 'Toronto',
        province: 'ON',
        postalCode: 'M4W 1A5',
        preferredLanguage: 'en',
        customerSinceYear: 2021,
        lifetimeVisits: 11,
        lifetimeSpend: 62500,
        loyaltyTier: 'Platinum',
        notes:
            'Platinum client. Always requests Sarah K. as advisor. Interested in 2026 Taycan Turbo GT when available.',
    },
    {
        id: 'cust_003',
        firstName: 'David',
        lastName: 'Okafor',
        phone: '+14375550303',
        email: 'd.okafor@capitalgroupca.com',
        address: '98 Prince Arthur Ave',
        city: 'Toronto',
        province: 'ON',
        postalCode: 'M5R 1B4',
        preferredLanguage: 'en',
        customerSinceYear: 2020,
        lifetimeVisits: 9,
        lifetimeSpend: 29800,
        loyaltyTier: 'Silver',
        notes: 'Vehicle currently in shop today.',
    },
    {
        id: 'cust_004',
        firstName: 'Sophie',
        lastName: 'Tremblay',
        phone: '+15145550404',
        email: 'sophie.tremblay@outlook.com',
        address: '3200 Rue de la Montagne',
        city: 'Montreal',
        province: 'QC',
        postalCode: 'H3G 2A4',
        preferredLanguage: 'fr',
        customerSinceYear: 2022,
        lifetimeVisits: 4,
        lifetimeSpend: 18500,
        loyaltyTier: 'Bronze',
        notes: 'Bilingual — français preferred. Track day enthusiast.',
    },
    {
        id: 'cust_005',
        firstName: 'Sulaim',
        lastName: 'Siddiqi',
        phone: '+16475457709',
        email: 'sulaim91@googlemail.com',
        address: '15 Murray Drive',
        city: 'Aurora',
        province: 'ON',
        postalCode: 'L4G 2C2',
        preferredLanguage: 'en',
        customerSinceYear: 2023,
        lifetimeVisits: 6,
        lifetimeSpend: 94500,
        loyaltyTier: 'Platinum',
        notes:
            'Platinum client. Frequent track use — Mosport CTMP. Prefer early morning appointments.',
    },
];

// ─── Lookups ────────────────────────────────────────────────────────────────

export function findMockCustomer(idOrPhone: string): MockCustomer | null {
    if (!idOrPhone) return null;
    const lookup = idOrPhone.trim();
    const byId = MOCK_CUSTOMERS.find((c) => c.id === lookup);
    if (byId) return byId;
    const normalized = normalizePhone(lookup);
    return (
        MOCK_CUSTOMERS.find((c) => normalizePhone(c.phone) === normalized) ??
        MOCK_CUSTOMERS.find((c) => c.altPhone && normalizePhone(c.altPhone) === normalized) ??
        null
    );
}

function normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    return digits.startsWith('+') ? phone : `+${digits}`;
}

export function getCustomerName(customerId: string | null | undefined): string | null {
    if (!customerId) return null;
    const c = MOCK_CUSTOMERS.find((m) => m.id === customerId);
    return c ? `${c.firstName} ${c.lastName}` : null;
}

// ─── Joins ──────────────────────────────────────────────────────────────────

export function getVehiclesForCustomer(customerId: string): MockVehicle[] {
    return MOCK_VEHICLES.filter((v) => v.customer_id === customerId);
}

export function countOpenROsForCustomer(customerId: string): number {
    const vehicleIds = new Set(
        MOCK_VEHICLES.filter((v) => v.customer_id === customerId).map((v) => v.id),
    );
    return MOCK_REPAIR_ORDERS.filter(
        (ro) => vehicleIds.has(ro.vehicle_id) && ro.status !== 'completed',
    ).length;
}

/**
 * Latest non-completed (or most recent overall) service date across all
 * vehicles owned by this customer. Used by the directory table's
 * "Last service" column.
 */
export function getLastServiceForCustomer(customerId: string): string | null {
    const vehicleIds = new Set(
        MOCK_VEHICLES.filter((v) => v.customer_id === customerId).map((v) => v.id),
    );
    const dates = MOCK_REPAIR_ORDERS.filter((ro) => vehicleIds.has(ro.vehicle_id))
        .map((ro) => ro.date)
        .sort((a, b) => (a < b ? 1 : -1));
    return dates[0] ?? null;
}

// ─── Overdue-for-service derivation ─────────────────────────────────────────
//
// A customer counts as overdue when EITHER:
//   (a) the most recent service across all their vehicles is older than the
//       6-month threshold (a soft proxy for "we haven't seen them in a
//       while" — the spec calls this out explicitly), OR
//   (b) any one of their vehicles passes its predictNextServiceForVehicle()
//       due-date — i.e. mileage or calendar interval has lapsed.
//
// Both branches respect the 6-month / 8,000-km rule in next-service.ts so
// the badge and the /vehicles/[id] progress bar agree on what "overdue"
// means.

export const OVERDUE_SERVICE_THRESHOLD_DAYS = 182;

function daysSinceIso(iso: string | null, today: Date): number | null {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return null;
    return Math.floor((today.getTime() - t) / 86_400_000);
}

export function isCustomerServiceOverdue(customerId: string, today: Date = new Date()): boolean {
    const lastServiceDays = daysSinceIso(getLastServiceForCustomer(customerId), today);
    if (lastServiceDays !== null && lastServiceDays > OVERDUE_SERVICE_THRESHOLD_DAYS) return true;

    const vehicles = MOCK_VEHICLES.filter((v) => v.customer_id === customerId);
    for (const v of vehicles) {
        const orders = MOCK_REPAIR_ORDERS.filter((ro) => ro.vehicle_id === v.id);

        // If a vehicle has an active RO today (in_progress / awaiting_parts)
        // it's literally in the shop right now — surfacing "service overdue"
        // on the customer card would be noise and would conflict with what
        // /service-desk already shows. Treat that vehicle as covered.
        const hasActiveRO = orders.some((ro) => ro.status === 'in_progress' || ro.status === 'awaiting_parts');
        if (hasActiveRO) continue;

        const prediction = predictNextServiceForVehicle(v, orders, today);
        if (prediction.days_remaining !== null && prediction.days_remaining < 0) return true;
        if (prediction.km_remaining !== null && prediction.km_remaining < 0) return true;
    }
    return false;
}

// ─── Today's appointments (dashboard morning briefing) ──────────────────────
//
// MOCK_APPOINTMENTS feeds the /dashboard 'Today's appointments' panel. We
// generate dates relative to "now" so the panel always has something
// recent regardless of when the demo runs. The Aria-context snippet on
// each appointment points back to the call in MOCK_CALLS by call_id so
// "Aria booked this on [date] — [summary excerpt]" can be derived without
// re-storing summary text.

export interface MockAppointment {
    id: string;
    customer_id: string;
    vehicle_id: string;
    /** ISO YYYY-MM-DD — relative to today so the panel keeps refreshing. */
    date: string;
    /** 'HH:MM' local. */
    time: string;
    service_type: string;
    advisor_name: string;
    duration_est_hours: number;
    confirmation_number: string;
    /** Which Aria call booked this appointment (joins to MOCK_CALLS.id). */
    source_call_id: string | null;
    notes?: string;
}

function isoOffsetDays(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

export const MOCK_APPOINTMENTS: MockAppointment[] = [
    {
        id: 'appt_001',
        customer_id: 'cust_001',
        vehicle_id: 'veh_001a',
        date: isoOffsetDays(0),
        time: '08:30',
        service_type: 'Annual Service B',
        advisor_name: 'Michael Chen',
        duration_est_hours: 3,
        confirmation_number: 'CNF-2026-4471',
        source_call_id: 'call_001',
        notes: 'Customer prefers loaner if service runs past 4h.',
    },
    {
        id: 'appt_002',
        customer_id: 'cust_002',
        vehicle_id: 'veh_002a',
        date: isoOffsetDays(0),
        time: '10:30',
        service_type: 'Oil Change + Cabin Air Filter',
        advisor_name: 'Sarah Kowalski',
        duration_est_hours: 1.5,
        confirmation_number: 'CNF-2026-4490',
        source_call_id: 'call_002',
    },
    {
        id: 'appt_003',
        customer_id: 'cust_005',
        vehicle_id: 'veh_005a',
        date: isoOffsetDays(0),
        time: '14:00',
        service_type: 'Diagnostic — intermittent warning light',
        advisor_name: 'Michael Chen',
        duration_est_hours: 2,
        confirmation_number: 'CNF-2026-5008',
        source_call_id: 'call_005',
        notes: 'Post-track diagnostic. Customer driving GT3 RS.',
    },
    {
        id: 'appt_004',
        customer_id: 'cust_003',
        vehicle_id: 'veh_003a',
        date: isoOffsetDays(1),
        time: '09:00',
        service_type: 'RO completion + loaner return',
        advisor_name: 'Tom Reeves',
        duration_est_hours: 0.5,
        confirmation_number: 'CNF-2026-4491',
        source_call_id: 'call_003',
        notes: 'Cayenne loaner out — return on RO completion.',
    },
    {
        id: 'appt_005',
        customer_id: 'cust_002',
        vehicle_id: 'veh_002a',
        date: isoOffsetDays(2),
        time: '11:00',
        service_type: 'BMS software update + recall NHTSA-2025-0188',
        advisor_name: 'Sarah Kowalski',
        duration_est_hours: 2,
        confirmation_number: 'CNF-2026-5101',
        source_call_id: 'call_007',
        notes: 'Loaner Taycan requested.',
    },
];

/**
 * Appointments scheduled today (ISO YYYY-MM-DD match in local time).
 * If empty, falls back to "next non-empty day".
 */
// `today` kept for future deterministic-test seam.
export function getTodaysAppointments(today?: Date): {
    appointments: MockAppointment[];
    label: 'today' | 'tomorrow' | 'upcoming';
} {
    void today;
    const todayIso = isoOffsetDays(0);
    const todays = MOCK_APPOINTMENTS.filter((a) => a.date === todayIso);
    if (todays.length > 0) return { appointments: todays, label: 'today' };

    const tomorrowIso = isoOffsetDays(1);
    const tomorrows = MOCK_APPOINTMENTS.filter((a) => a.date === tomorrowIso);
    if (tomorrows.length > 0) return { appointments: tomorrows, label: 'tomorrow' };

    const upcoming = MOCK_APPOINTMENTS
        .filter((a) => a.date >= todayIso)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .slice(0, 5);
    return { appointments: upcoming, label: 'upcoming' };
}

