// ─── PitLane mock vehicle dataset (dashboard side) ───────────────────────────
//
// Single source of mock vehicle / RO / recall data for the dashboard's
// /vehicles/[id] page. Aligned with the voice service's MOCK_CUSTOMERS
// (voice/src/mock/customers.ts) so a vehicle_id Aria writes (e.g. veh_005a)
// can be deep-linked from /calls to /vehicles/veh_005a and resolve.
//
// When Phase 6 (hourly CDK pull) lands, this gets replaced by Supabase reads.
// Until then this is the demo + IT-walkthrough dataset.

export type VehicleSource = 'mock' | 'fortellis' | 'supabase'

export interface MockVehicle {
    id: string
    vin: string
    year: number
    make: string
    model: string
    trim?: string
    color?: string
    /** Current mileage in km. */
    mileage: number
    license_plate?: string
    customer_id: string
    customer_name: string
    in_service_date: string // ISO date — used as the basis for warranty calcs
    /** Phase 10 — explicit warranty expiry. NULL falls back to a 4-year
     *  derivation from in_service_date (Porsche factory warranty term). */
    warranty_expiry?: string | null
}

export type WarrantyStatus = 'active' | 'expiring_soon' | 'expired' | 'unknown'

export interface WarrantyInfo {
    expiry: string | null
    status: WarrantyStatus
    days_remaining: number | null
}

/**
 * Phase 10 — compute a vehicle's warranty status. Source of truth is
 * CDK's warrantyExpiration field; until the Phase 6 CDK pull lands we
 * derive it from in_service_date + 4 years (Porsche factory term) when
 * the vehicle row doesn't have an explicit expiry.
 *
 * Thresholds per spec:
 *   > 365 days       -> active        (green)
 *   91-365 days      -> active        (green)
 *   90-1   days      -> expiring_soon (yellow)
 *   <= 0  days       -> expired       (red)
 *
 * The 3-12 month yellow band in the spec collapses to "expiring soon"
 * once it's within 90 days — the dashboard uses one yellow pill rather
 * than two separate ones.
 */
export function getVehicleWarrantyInfo(
    vehicle: MockVehicle,
    today: Date = new Date(),
): WarrantyInfo {
    const expiryIso = vehicle.warranty_expiry ?? deriveDefaultWarrantyExpiry(vehicle.in_service_date)
    if (!expiryIso) {
        return { expiry: null, status: 'unknown', days_remaining: null }
    }
    const expiry = new Date(expiryIso)
    if (Number.isNaN(expiry.getTime())) {
        return { expiry: null, status: 'unknown', days_remaining: null }
    }
    const days = Math.floor((expiry.getTime() - today.getTime()) / 86_400_000)
    let status: WarrantyStatus
    if (days < 0) status = 'expired'
    else if (days <= 365) {
        // < 12 months remaining starts surfacing as "expiring soon".
        // < 3 months (90 days) flips to red — handled by the UI styling,
        // not by a separate status value.
        status = 'expiring_soon'
    } else status = 'active'
    return { expiry: expiryIso, status, days_remaining: days }
}

function deriveDefaultWarrantyExpiry(inServiceDate: string | null | undefined): string | null {
    if (!inServiceDate) return null
    const d = new Date(inServiceDate)
    if (Number.isNaN(d.getTime())) return null
    d.setFullYear(d.getFullYear() + 4)
    return d.toISOString().slice(0, 10)
}

export type RoStatus = 'open' | 'in_progress' | 'awaiting_parts' | 'completed'

export interface MockRepairOrder {
    ro_number: string
    vehicle_id: string
    date: string // ISO YYYY-MM-DD
    service_type: string
    advisor_name: string
    status: RoStatus
    summary: string
    mileage_at_service?: number
    total_cost?: number
    /**
     * When this RO touched the engine-oil service, the mileage at which it
     * was changed. Used by predictNextService().
     */
    oil_change_mileage?: number
}

export interface MockRecall {
    nhtsa_id: string
    campaign: string
    component: string
    consequence: string
    remedy: string
    remedy_available: boolean
    issued: string // ISO date
}

// ─── Vehicles ────────────────────────────────────────────────────────────────

export const MOCK_VEHICLES: MockVehicle[] = [
    {
        id: 'veh_001a',
        vin: 'WP1AB2A2XMLA12345',
        year: 2021,
        make: 'Porsche',
        model: 'Cayenne',
        trim: 'S AWD',
        color: 'Mahogany Metallic',
        mileage: 42800,
        license_plate: 'JTXW 812',
        customer_id: 'cust_001',
        customer_name: 'James Whitfield',
        in_service_date: '2021-03-12',
    },
    {
        id: 'veh_001b',
        vin: 'WP0AB2A97MS220876',
        year: 2020,
        make: 'Porsche',
        model: '911',
        trim: 'Carrera S Cabriolet',
        color: 'GT Silver Metallic',
        mileage: 18300,
        license_plate: 'KPRS 002',
        customer_id: 'cust_001',
        customer_name: 'James Whitfield',
        in_service_date: '2020-07-18',
    },
    {
        id: 'veh_002a',
        vin: 'WP0ZZZ97ZNS140022',
        year: 2022,
        make: 'Porsche',
        model: 'Taycan',
        trim: '4S Cross Turismo',
        color: 'Frozen Blue Metallic',
        mileage: 31200,
        license_plate: 'CHRG 922',
        customer_id: 'cust_002',
        customer_name: 'Priya Mehta',
        in_service_date: '2022-05-22',
    },
    {
        id: 'veh_003a',
        vin: 'WP0AA2A74NS810034',
        year: 2022,
        make: 'Porsche',
        model: 'Macan',
        trim: 'GTS',
        color: 'Carmine Red',
        mileage: 55600,
        license_plate: 'MCGTS 7',
        customer_id: 'cust_003',
        customer_name: 'David Okafor',
        in_service_date: '2022-04-08',
    },
    {
        id: 'veh_004a',
        vin: 'WP0CA2985NS610087',
        year: 2022,
        make: 'Porsche',
        model: '718 Cayman',
        trim: 'GTS 4.0',
        color: 'Shark Blue',
        mileage: 22100,
        license_plate: 'JWZ 6412',
        customer_id: 'cust_004',
        customer_name: 'Sophie Tremblay',
        in_service_date: '2022-08-15',
    },
    {
        id: 'veh_005a',
        vin: 'WP0AA2A98NS820011',
        year: 2023,
        make: 'Porsche',
        model: '911',
        trim: 'GT3 RS',
        color: 'Shark Blue',
        mileage: 8200,
        license_plate: 'GT3 RSS',
        customer_id: 'cust_005',
        customer_name: 'Sulaim Siddiqi',
        in_service_date: '2023-09-10',
    },
]

// ─── Repair orders (rolling history; newest first per vehicle) ──────────────

export const MOCK_REPAIR_ORDERS: MockRepairOrder[] = [
    // Cayenne S — James Whitfield (active awaiting-parts + last 4 visits)
    {
        ro_number: 'RO-2026-4471',
        vehicle_id: 'veh_001a',
        date: '2026-06-01',
        service_type: 'Air Suspension Compressor Replacement',
        advisor_name: 'Michael Chen',
        status: 'awaiting_parts',
        summary: 'Customer reported intermittent suspension warning. Diagnosed compressor failure. Part ordered from Germany, ETA June 14.',
        mileage_at_service: 42800,
        total_cost: 3850,
    },
    {
        ro_number: 'RO-2025-9912',
        vehicle_id: 'veh_001a',
        date: '2025-11-04',
        service_type: 'Oil Change + Cabin Air Filter',
        advisor_name: 'Marco Alvarez',
        status: 'completed',
        summary: 'Routine oil + filter. Cabin air filter replaced. Rear brake pads at 4mm — quoted at $875, customer declined for now.',
        mileage_at_service: 38900,
        total_cost: 785,
        oil_change_mileage: 38900,
    },
    {
        ro_number: 'RO-2025-7233',
        vehicle_id: 'veh_001a',
        date: '2025-04-12',
        service_type: 'Annual Service A',
        advisor_name: 'Michael Chen',
        status: 'completed',
        summary: 'Annual A service. All fluids inspected. Tires rotated.',
        mileage_at_service: 31100,
        total_cost: 595,
    },
    {
        ro_number: 'RO-2024-6128',
        vehicle_id: 'veh_001a',
        date: '2024-10-22',
        service_type: 'Oil Change',
        advisor_name: 'Marco Alvarez',
        status: 'completed',
        summary: 'Routine oil + filter.',
        mileage_at_service: 25600,
        total_cost: 295,
        oil_change_mileage: 25600,
    },
    {
        ro_number: 'RO-2024-2845',
        vehicle_id: 'veh_001a',
        date: '2024-03-15',
        service_type: 'Annual Service B + Brake Fluid',
        advisor_name: 'Michael Chen',
        status: 'completed',
        summary: 'Annual B service. Brake fluid exchange. PCM software update applied.',
        mileage_at_service: 18200,
        total_cost: 1295,
    },

    // 911 Carrera S — James Whitfield (low mileage, sparse history)
    {
        ro_number: 'RO-2025-6402',
        vehicle_id: 'veh_001b',
        date: '2025-06-18',
        service_type: 'Annual Service B + Brake Fluid Exchange',
        advisor_name: 'Nina Patel',
        status: 'completed',
        summary: 'Annual B + brake fluid. No issues.',
        mileage_at_service: 16800,
        total_cost: 1395,
    },
    {
        ro_number: 'RO-2024-4189',
        vehicle_id: 'veh_001b',
        date: '2024-08-04',
        service_type: 'Oil Change',
        advisor_name: 'Nina Patel',
        status: 'completed',
        summary: 'Routine oil + filter.',
        mileage_at_service: 12400,
        total_cost: 295,
        oil_change_mileage: 12400,
    },

    // Taycan 4S — Priya Mehta (EV — no oil change but software updates)
    {
        ro_number: 'RO-2026-3201',
        vehicle_id: 'veh_002a',
        date: '2026-06-11',
        service_type: 'Taycan Annual Inspection + Software Update',
        advisor_name: 'Sarah Kowalski',
        status: 'in_progress',
        summary: 'Annual inspection in progress. BMS software update applied (recall NHTSA-2025-0188 remediated).',
        mileage_at_service: 31200,
        total_cost: 0,
    },
    {
        ro_number: 'RO-2025-8920',
        vehicle_id: 'veh_002a',
        date: '2025-05-03',
        service_type: 'Tire Rotation + Brake Inspection',
        advisor_name: 'Sarah Kowalski',
        status: 'completed',
        summary: 'Routine tire rotation. Brakes at 75% remaining.',
        mileage_at_service: 22400,
        total_cost: 295,
    },

    // Macan GTS — David Okafor (currently in shop)
    {
        ro_number: 'RO-2026-4490',
        vehicle_id: 'veh_003a',
        date: '2026-06-09',
        service_type: 'PDK Transmission Service + Rear Differential Fluid',
        advisor_name: 'Tom Reeves',
        status: 'in_progress',
        summary: 'PDK fluid + filter. Rear diff fluid. Customer driving aggressively per service interval recommendation.',
        mileage_at_service: 55600,
        total_cost: 1240,
    },
    {
        ro_number: 'RO-2025-7811',
        vehicle_id: 'veh_003a',
        date: '2025-09-12',
        service_type: 'Oil Change + 4-Wheel Alignment',
        advisor_name: 'Tom Reeves',
        status: 'completed',
        summary: 'Oil + filter. Alignment after track day at CTMP.',
        mileage_at_service: 48200,
        total_cost: 825,
        oil_change_mileage: 48200,
    },

    // 718 Cayman GTS — Sophie Tremblay (track-day enthusiast)
    {
        ro_number: 'RO-2026-1450',
        vehicle_id: 'veh_004a',
        date: '2026-02-14',
        service_type: 'Track Preparation Service',
        advisor_name: 'Marco Alvarez',
        status: 'completed',
        summary: 'Track prep. Brake pads inspected (60% remaining). Brake fluid exchanged. Coolant topped up.',
        mileage_at_service: 21800,
        total_cost: 895,
    },
    {
        ro_number: 'RO-2025-9032',
        vehicle_id: 'veh_004a',
        date: '2025-09-22',
        service_type: 'Oil Change + Spark Plug Replacement',
        advisor_name: 'Marco Alvarez',
        status: 'completed',
        summary: 'Routine oil. 4 spark plugs replaced at recommended interval.',
        mileage_at_service: 17900,
        total_cost: 695,
        oil_change_mileage: 17900,
    },

    // GT3 RS — Sulaim Siddiqi (low mileage, recent customer)
    {
        ro_number: 'RO-2026-2901',
        vehicle_id: 'veh_005a',
        date: '2026-06-01',
        service_type: 'Annual Service A',
        advisor_name: 'Michael Chen',
        status: 'completed',
        summary: 'Annual A. PCCB inspection passed. No track use since last visit.',
        mileage_at_service: 8200,
        total_cost: 595,
    },
    {
        ro_number: 'RO-2025-4470',
        vehicle_id: 'veh_005a',
        date: '2025-04-18',
        service_type: 'Oil Change + Track Inspection',
        advisor_name: 'Michael Chen',
        status: 'completed',
        summary: 'Oil + filter. PCCB pads at 80% remaining. Customer ran 6 Mosport sessions.',
        mileage_at_service: 4200,
        total_cost: 695,
        oil_change_mileage: 4200,
    },
]

// ─── Recalls (keyed by VIN — mirrors voice service mocks) ────────────────────

export const MOCK_RECALLS_BY_VIN: Record<string, MockRecall[]> = {
    // James's Cayenne — fuel injector recall
    WP1AB2A2XMLA12345: [
        {
            nhtsa_id: '24V-271',
            campaign: '24V-271',
            component: 'Fuel System: Injectors',
            consequence: 'Fuel injector seals may not maintain proper pressure under high-load conditions, increasing the risk of a fuel leak and fire.',
            remedy: 'Authorized dealers will replace the affected fuel injector sealing assembly free of charge.',
            remedy_available: true,
            issued: '2024-05-08',
        },
    ],
    // Priya's Taycan — BMS recall (in-progress at the active RO)
    WP0ZZZ97ZNS140022: [
        {
            nhtsa_id: 'NHTSA-2025-0188',
            campaign: '25V-188',
            component: 'Electrical System: Battery Management',
            consequence: 'Under rare conditions the battery management system software may permit a high-voltage overcharge state, increasing risk of thermal incident.',
            remedy: 'Authorized dealers will apply a battery management system software update free of charge. Approximately 45 minutes.',
            remedy_available: true,
            issued: '2025-03-22',
        },
    ],
    // Sophie's Cayman — early-issued, remedy still pending
    WP0CA2985NS610087: [
        {
            nhtsa_id: '26V-014',
            campaign: '26V-014',
            component: 'Steering: Electric Power Steering',
            consequence: 'A software calibration error may cause the EPS to temporarily reduce assist at low speeds, increasing steering effort.',
            remedy: 'Remedy not yet available. Dealers will be notified when the corrective software is released. Vehicle remains safe to drive.',
            remedy_available: false,
            issued: '2026-01-30',
        },
    ],
}

// ─── Lookups ─────────────────────────────────────────────────────────────────

/**
 * Resolve a vehicle by either its mock id (veh_001a, …) or its VIN. The
 * /vehicles/[id] route accepts either form.
 */
export function findMockVehicle(idOrVin: string): MockVehicle | null {
    if (!idOrVin) return null
    return (
        MOCK_VEHICLES.find((v) => v.id === idOrVin) ??
        MOCK_VEHICLES.find((v) => v.vin === idOrVin) ??
        null
    )
}

export function findMockRepairOrders(vehicleId: string, limit = 10): MockRepairOrder[] {
    return MOCK_REPAIR_ORDERS.filter((ro) => ro.vehicle_id === vehicleId)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, limit)
}

/**
 * Mock recall lookup by VIN. In production this will call NHTSA's
 * /api.nhtsa.gov/recalls/recallsByVehicle endpoint (or its VIN-search
 * equivalent). The function shape is set up so swapping in a real fetch is
 * a one-function change; the dashboard surface won't notice.
 */
export async function fetchOpenRecallsByVin(vin: string): Promise<MockRecall[]> {
    // TODO(phase-6+): replace with NHTSA fetch. For now: synchronous mock.
    return MOCK_RECALLS_BY_VIN[vin] ?? []
}
