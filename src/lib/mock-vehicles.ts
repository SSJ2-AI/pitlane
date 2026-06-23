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

// ─── NHTSA recall lookup ─────────────────────────────────────────────────────
//
// `fetchOpenRecallsByVin` resolves open recalls for a VIN by:
//   1. Resolving make/model/year — from MOCK_VEHICLES for known demo VINs
//      (fast path; no extra request), or via NHTSA's free vPIC VIN decoder
//      otherwise.
//   2. Calling NHTSA's recallsByVehicle endpoint with the resolved metadata.
//   3. Mapping each result to the dashboard's MockRecall shape.
//
// Falls back to MOCK_RECALLS_BY_VIN on any network error, non-2xx, or
// empty live result — so the Vercel demo still renders Sophie's EPS recall
// and James's fuel-injector recall even when NHTSA is unreachable or has
// no record for the (fictional) demo VINs.
//
// The fetch uses Next.js' `next.revalidate: 86_400` so subsequent hits
// within a 24h window are served from the framework cache.

const NHTSA_DECODE_VIN_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/decodevin'
const NHTSA_RECALLS_URL = 'https://api.nhtsa.gov/recalls/recallsByVehicle'
const NHTSA_FETCH_REVALIDATE_SECS = 86_400

interface VehicleMeta {
    make: string
    model: string
    year: number
}

interface NhtsaRecallResponseItem {
    NHTSACampaignNumber?: string
    Component?: string
    Summary?: string
    Consequence?: string
    Remedy?: string
    RemedyStatus?: string
    ReportReceivedDate?: string
}

function vehicleMetaFromMock(vin: string): VehicleMeta | null {
    const v = MOCK_VEHICLES.find((mv) => mv.vin === vin)
    if (!v) return null
    return { make: v.make, model: v.model, year: v.year }
}

async function decodeVinViaNhtsa(vin: string): Promise<VehicleMeta | null> {
    try {
        const res = await fetch(`${NHTSA_DECODE_VIN_URL}/${encodeURIComponent(vin)}?format=json`, {
            next: { revalidate: NHTSA_FETCH_REVALIDATE_SECS },
        })
        if (!res.ok) return null
        const payload = (await res.json()) as {
            Results?: Array<{ Variable?: string; Value?: string | null }>
        }
        const lookup = (variable: string): string | null => {
            const row = (payload.Results ?? []).find((r) => r.Variable === variable)
            const value = row?.Value
            return value && value !== 'null' ? value : null
        }
        const make = lookup('Make')
        const model = lookup('Model')
        const yearStr = lookup('Model Year')
        const year = yearStr ? Number.parseInt(yearStr, 10) : NaN
        if (!make || !model || Number.isNaN(year)) return null
        return { make, model, year }
    } catch {
        return null
    }
}

function parseIssuedDate(raw: string | undefined): string {
    if (!raw) return ''
    // NHTSA returns dates like "12/15/2021". Convert to ISO YYYY-MM-DD so
    // the dashboard sort + display formatters don't have to special-case.
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (m) {
        const [, mm, dd, yyyy] = m
        return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
    }
    const parsed = new Date(raw)
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function toMockRecall(item: NhtsaRecallResponseItem): MockRecall {
    const remedy = (item.Remedy ?? '').trim()
    return {
        nhtsa_id: item.NHTSACampaignNumber ?? '',
        campaign: item.NHTSACampaignNumber ?? '',
        component: item.Component ?? '',
        consequence: item.Consequence ?? item.Summary ?? '',
        remedy: remedy || item.RemedyStatus || '',
        remedy_available: remedy.length > 0,
        issued: parseIssuedDate(item.ReportReceivedDate),
    }
}

export function getMockRecalls(vin: string): MockRecall[] {
    return MOCK_RECALLS_BY_VIN[vin] ?? []
}

export async function fetchOpenRecallsByVin(vin: string): Promise<MockRecall[]> {
    if (!vin) return getMockRecalls(vin)

    try {
        const meta = vehicleMetaFromMock(vin) ?? (await decodeVinViaNhtsa(vin))
        if (!meta) return getMockRecalls(vin)

        const params = new URLSearchParams({
            make: meta.make,
            model: meta.model,
            modelYear: String(meta.year),
        })
        const res = await fetch(`${NHTSA_RECALLS_URL}?${params.toString()}`, {
            next: { revalidate: NHTSA_FETCH_REVALIDATE_SECS },
        })
        if (!res.ok) return getMockRecalls(vin)
        const data = (await res.json()) as { results?: NhtsaRecallResponseItem[] }
        const live = (data.results ?? []).map(toMockRecall).filter((r) => r.nhtsa_id || r.component)

        // Empty live response → fall back to scripted demo so the recall
        // card on /vehicles/[id] stays populated for known mock VINs.
        if (live.length === 0) return getMockRecalls(vin)
        return live
    } catch {
        return getMockRecalls(vin)
    }
}
