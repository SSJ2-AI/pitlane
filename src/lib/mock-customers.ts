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
