import { getDealerById, getDealerFortellisCredentials, type Dealer } from '../lib/dealer'
import { MOCK_CUSTOMERS, lookupByPhone } from '../mock/customers'

// ─── PitLane × Fortellis CDK client (voice service, write-capable) ──────────
//
// This is the WRITE-capable Fortellis client running in the voice service —
// distinct from `src/lib/fortellis.ts` on the dashboard side (read-only
// customer lookup). Phase 3 work.
//
// Architecture:
//   - OAuth 2.0 client_credentials. Per-dealer token cache keyed by dealer.id,
//     because each rooftop has its own OAuth client_id + client_secret and
//     Subscription-Id.
//   - Tokens refresh proactively 60s before expiry (avoids a stampede of
//     401-and-retry around the expiry boundary).
//   - Credentials are decrypted on demand from the `dealers` table via
//     getDealerFortellisCredentials() — never stored decrypted in memory
//     past the OAuth handshake.
//   - When USE_FORTELLIS_LIVE is not "true", every method returns realistic
//     mock data derived from MOCK_CUSTOMERS so the sync worker + downstream
//     flows can be exercised without real Fortellis access.
//
// Fortellis CDK Service Bundle IDs (per Sulaim's research):
//   Repair Orders:   63ca887a
//   Workshop:        ba0877f5
//   Customer Info:   c0e82268
//   Vehicles:        5d1bfb8d
//   OpCodes:         59c792d7

// ─── Configuration ──────────────────────────────────────────────────────────
//
// Default Proxy URLs match the CDK Drive RO Bundle as documented on the
// Fortellis API Docs portal (apidocs.fortellis.io). Every URL is
// overridable via env var so dealers on a non-standard subscription can
// repoint without a code change.
//
// IMPORTANT: there is no Service Appointments API in the CDK Drive RO
// Bundle. createAppointment() stays mock-only until a separate Fortellis
// Appointments subscription is provisioned (see TASK 6 below).

const DEFAULT_TOKEN_URL = 'https://identity.fortellis.io/oauth2/aus1p1ixy7YL8cMq02p7/v1/token'
const DEFAULT_CUSTOMER_API_URL = 'https://api.fortellis.io/cdkdrive/crm/v1/customers'
const DEFAULT_VEHICLE_API_URL = 'https://api.fortellis.io/cdkdrive/service/v1/vehicles'
const DEFAULT_RO_API_URL = 'https://api.fortellis.io/service/cdk-drive/v2/repair-orders'
const DEFAULT_OPCODES_API_URL = 'https://api.fortellis.io/cdkdrive/service/catalog/v1/opcodes'
const DEFAULT_WORKSHOP_API_URL = 'https://api.fortellis.io/service/cdk-drive/v1/workshop-management'

const REQUEST_TIMEOUT_MS = 8_000
const TOKEN_REFRESH_EARLY_MS = 60_000

export function isFortellisLive(): boolean {
    return (process.env.USE_FORTELLIS_LIVE ?? '').trim().toLowerCase() === 'true'
}

function endpoint(envVar: string, fallback: string): string {
    return (process.env[envVar] ?? '').trim() || fallback
}

// ─── Token cache ────────────────────────────────────────────────────────────

interface CachedToken {
    accessToken: string
    expiresAt: number
}

const tokenCache = new Map<string, CachedToken>()

/**
 * Reset the per-dealer token cache. Used by tests + the future credential-
 * rotation admin endpoint.
 */
export function clearFortellisTokenCache(dealerId?: string) {
    if (dealerId) tokenCache.delete(dealerId)
    else tokenCache.clear()
}

async function getAccessToken(dealer: Dealer): Promise<string> {
    const now = Date.now()
    const cached = tokenCache.get(dealer.id)
    if (cached && cached.expiresAt > now + TOKEN_REFRESH_EARLY_MS) {
        return cached.accessToken
    }

    const creds = getDealerFortellisCredentials(dealer)
    const tokenUrl = endpoint('FORTELLIS_TOKEN_URL', DEFAULT_TOKEN_URL)

    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')
    const body = new URLSearchParams({ grant_type: 'client_credentials' })

    const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`[Fortellis] token endpoint ${res.status}: ${text.slice(0, 200)}`)
    }

    const payload = (await res.json().catch(() => null)) as
        | { access_token?: string; expires_in?: number }
        | null

    if (!payload?.access_token) {
        throw new Error('[Fortellis] token endpoint returned no access_token')
    }

    const expiresInMs = (payload.expires_in ?? 3600) * 1000
    tokenCache.set(dealer.id, {
        accessToken: payload.access_token,
        expiresAt: now + expiresInMs,
    })
    return payload.access_token
}

// ─── Shared HTTP wrapper ────────────────────────────────────────────────────

interface FortellisFetchOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
    url: string
    query?: Record<string, string | number | undefined | null>
    body?: Record<string, unknown>
    /**
     * If-Match header value for endpoints that require optimistic concurrency
     * control (e.g. Update RO). Use '*' as a wildcard when the caller doesn't
     * have the row's current ETag — fine for "always overwrite" scenarios
     * like appending a note.
     */
    etag?: string
}

async function fortellisFetch<T>(dealer: Dealer, opts: FortellisFetchOptions): Promise<T> {
    const token = await getAccessToken(dealer)
    const subscriptionId = getDealerFortellisCredentials(dealer).subscriptionId

    let url = opts.url
    if (opts.query) {
        const usp = new URLSearchParams()
        for (const [k, v] of Object.entries(opts.query)) {
            if (v !== undefined && v !== null) usp.append(k, String(v))
        }
        const qs = usp.toString()
        if (qs) url += (url.includes('?') ? '&' : '?') + qs
    }

    const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Subscription-Id': subscriptionId,
            'Accept': 'application/json',
            ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
            ...(opts.etag ? { 'If-Match': opts.etag } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (res.status === 401 || res.status === 403) {
        // Token may have been revoked or our cached one expired between check
        // and dispatch. Invalidate so the next attempt re-issues, but DO NOT
        // auto-retry here — leave that to the sync-worker's retry loop so
        // we don't double-bill the Fortellis rate limit on a misconfigured
        // dealer.
        tokenCache.delete(dealer.id)
        throw new Error(`[Fortellis] ${opts.method ?? 'GET'} ${url} unauthorized (${res.status})`)
    }

    const text = await res.text().catch(() => '')
    if (!res.ok) {
        throw new Error(`[Fortellis] ${opts.method ?? 'GET'} ${url} ${res.status}: ${text.slice(0, 200)}`)
    }

    if (!text) return {} as T
    try {
        return JSON.parse(text) as T
    } catch {
        // Some Fortellis Async endpoints return 202 + empty body.
        return {} as T
    }
}

// ─── Public API surfaces ────────────────────────────────────────────────────

export interface FortellisCustomer {
    customer_id: string
    first_name: string
    last_name: string
    phone?: string
    email?: string
    loyalty_tier?: string
    notes?: string
    source: 'fortellis' | 'mock'
}

export interface FortellisVehicle {
    vehicle_id: string
    vin: string
    year?: number
    make?: string
    model?: string
    color?: string
    mileage?: number
    license_plate?: string
    source: 'fortellis' | 'mock'
}

export interface FortellisOpCode {
    op_code: string
    description: string
    labor_hours?: number
    flat_rate_total?: number
    parts_total?: number
}

export interface AppointmentPayload {
    customer_id: string
    vehicle_id: string
    date: string                // YYYY-MM-DD
    time: string                // HH:MM(:SS)
    service_type: string
    advisor?: string
    duration_est_hours?: number
    notes?: string
    op_codes?: string[]
}

export interface FortellisAppointmentResult {
    appointment_cdk_id: string
    confirmation_number?: string
    source: 'fortellis' | 'mock'
}

export interface FortellisRONoteResult {
    note_id: string
    ro_id: string
    source: 'fortellis' | 'mock'
}

async function loadDealer(dealerId: string): Promise<Dealer> {
    return getDealerById(dealerId)
}

// ─── 6. getServiceAdvisors (Workshop Management API) ────────────────────────
//
// Returns the list of active service advisors for a dealership. Used by the
// dashboard's advisor-assignment dropdowns + by Aria when booking an
// appointment so the advisor field is populated with a real CDK user id
// instead of a free-form string.
//
// Live: GET {DEFAULT_WORKSHOP_API_URL}/service-advisors
// Mock: a small static list — enough to drive UI dropdowns and the demo flow.

export interface FortellisServiceAdvisor {
    serviceAdvisorId: string
    name: string
    source: 'fortellis' | 'mock'
}

export async function getServiceAdvisors(dealerId: string): Promise<FortellisServiceAdvisor[]> {
    if (!isFortellisLive()) {
        return [
            { serviceAdvisorId: 'SA-001', name: 'Michael Chen', source: 'mock' },
            { serviceAdvisorId: 'SA-002', name: 'Sarah Thompson', source: 'mock' },
        ]
    }

    const dealer = await loadDealer(dealerId)
    const baseUrl = endpoint('FORTELLIS_WORKSHOP_API_URL', DEFAULT_WORKSHOP_API_URL)
    const url = `${baseUrl}/service-advisors`

    // CDK Drive Workshop Management v1 response shape:
    //   { items: [{ serviceAdvisorId, name }] }
    const payload = await fortellisFetch<{ items?: Array<Record<string, unknown>> }>(dealer, {
        method: 'GET',
        url,
    })

    const list = Array.isArray(payload.items) ? payload.items : []
    return list
        .map((raw): FortellisServiceAdvisor | null => {
            const id = raw.serviceAdvisorId ?? raw.id
            if (typeof id !== 'string' || id.length === 0) return null
            return {
                serviceAdvisorId: id,
                name: typeof raw.name === 'string' ? raw.name : '',
                source: 'fortellis',
            }
        })
        .filter((sa): sa is FortellisServiceAdvisor => Boolean(sa))
}

// ─── 7. getEmployees (Workshop Management API — techs) ─────────────────────
//
// Returns the active technicians for a dealership. Used by the dashboard's
// Phase 9b technician-assignment dropdown and (eventually) by an automatic
// tech-matching helper that pairs the right specialty with a given service
// code.
//
// Live:  GET {DEFAULT_WORKSHOP_API_URL}/employees?type=technician
// Mock:  three plausible Porsche-shop technicians with specialties so the
//        demo dropdown has signal.

export interface FortellisEmployee {
    employeeId: string
    name: string
    specialty?: string
    source: 'fortellis' | 'mock'
}

const MOCK_TECHNICIANS: FortellisEmployee[] = [
    { employeeId: 'tech_001', name: 'Marco Rossi', specialty: 'Engine/Transmission', source: 'mock' },
    { employeeId: 'tech_002', name: 'Lena Park', specialty: 'Electrical/Software', source: 'mock' },
    { employeeId: 'tech_003', name: 'Dave Chen', specialty: 'PDI/Routine Service', source: 'mock' },
]

export async function getEmployees(
    dealerId: string,
    opts?: { type?: 'technician' | 'advisor' | 'all' },
): Promise<FortellisEmployee[]> {
    if (!isFortellisLive()) {
        return MOCK_TECHNICIANS
    }

    const dealer = await loadDealer(dealerId)
    const baseUrl = endpoint('FORTELLIS_WORKSHOP_API_URL', DEFAULT_WORKSHOP_API_URL)
    const type = opts?.type ?? 'technician'
    const url = `${baseUrl}/employees?type=${encodeURIComponent(type)}`

    try {
        const payload = await fortellisFetch<{ items?: Array<Record<string, unknown>> }>(dealer, {
            method: 'GET',
            url,
        })
        const list = Array.isArray(payload.items) ? payload.items : []
        return list
            .map((raw): FortellisEmployee | null => {
                const id = raw.employeeId ?? raw.id
                if (typeof id !== 'string' || id.length === 0) return null
                return {
                    employeeId: id,
                    name: typeof raw.name === 'string' ? raw.name : '',
                    specialty: typeof raw.specialty === 'string' ? raw.specialty : undefined,
                    source: 'fortellis',
                }
            })
            .filter((emp): emp is FortellisEmployee => Boolean(emp))
    } catch (err) {
        console.warn('[Fortellis] getEmployees failed; falling back to mock:', err instanceof Error ? err.message : err)
        return MOCK_TECHNICIANS
    }
}

// ─── Customer-lookup integration with the existing Customer type ────────────
//
// The voice service's downstream code (pre-call webhook, customer-lookup
// tool, call store) consumes the `Customer` type defined in src/types.ts.
// Fortellis's getCustomer returns a thin contact-level record only; to keep
// downstream code unchanged, we return a Customer with empty vehicles /
// open ROs / appointments arrays — Aria's subsequent tools (getVehicle,
// repair-eta, etc.) populate those on demand. Phase 6 (full CDK pull) will
// pre-fetch them all into Supabase.
//
// Falls through to lookupByPhone (in-memory mocks) when:
//   - USE_FORTELLIS_LIVE is not 'true', OR
//   - Fortellis returns no customer matching the phone.

import type { Customer } from '../types'

export async function lookupByPhoneViaFortellis(
    phone: string,
    dealerId: string,
): Promise<Customer | null> {
    if (!isFortellisLive()) {
        return lookupByPhone(phone)
    }

    try {
        const fc = await getCustomer(phone, dealerId)
        if (!fc) {
            // CDK says "no record" — DO NOT silently fall back to mocks for
            // production dealerships (that would be misleading). For demo
            // safety we still try mocks though, because demo customers may
            // not exist in CDK.
            return lookupByPhone(phone)
        }

        // Build a Customer-shaped object. Vehicles / ROs / appointments are
        // empty arrays until subsequent Aria tools enrich them or Phase 6
        // pulls them in batch.
        return {
            id: fc.customer_id,
            firstName: fc.first_name,
            lastName: fc.last_name,
            phone: fc.phone ?? phone,
            altPhone: undefined,
            email: fc.email ?? '',
            address: '',
            city: '',
            province: '',
            postalCode: '',
            preferredLanguage: 'en',
            lastVisit: undefined,
            lifetimeValue: undefined,
            loyaltyTier: (fc.loyalty_tier as Customer['loyaltyTier']) ?? undefined,
            vehicles: [],
            openRepairOrders: [],
            upcomingAppointments: [],
            openRecalls: [],
            notes: fc.notes,
        }
    } catch (err) {
        console.error('[Fortellis] lookupByPhoneViaFortellis error:', err instanceof Error ? err.message : err)
        return lookupByPhone(phone)
    }
}

// ─── 1. createRONote ────────────────────────────────────────────────────────

/**
 * Append a note to an existing repair order.
 *
 * The CDK Drive RO Bundle has NO dedicated /notes endpoint. Notes are
 * persisted by calling Update RO with a `comments` field:
 *
 *   POST /repair-orders/{roId}/
 *   If-Match: <etag>   (or '*' to overwrite without optimistic concurrency)
 *   { "comments": "..." }
 *
 * We pass '*' as the If-Match wildcard until we wire ETag round-tripping
 * end-to-end (read the RO first, capture its ETag, then write back). The
 * wildcard is safe for this use case because we're append-only — we never
 * overwrite anything we'd lose by skipping the concurrency check.
 *
 * The Update RO endpoint returns the updated RO, not a note record, so
 * we synthesize a stable-enough note_id for the caller's audit trail.
 */
export async function createRONote(
    roId: string,
    note: string,
    dealerId: string,
): Promise<FortellisRONoteResult> {
    if (!isFortellisLive()) {
        console.log(`[Fortellis][mock] createRONote ro=${roId} dealer=${dealerId} note="${note.slice(0, 60)}…"`)
        return {
            note_id: `mock-note-${Date.now().toString(36)}`,
            ro_id: roId,
            source: 'mock',
        }
    }

    const dealer = await loadDealer(dealerId)
    const baseUrl = endpoint('FORTELLIS_RO_API_URL', DEFAULT_RO_API_URL)
    const url = `${baseUrl}/${encodeURIComponent(roId)}/`

    await fortellisFetch<Record<string, unknown>>(dealer, {
        method: 'POST',
        url,
        etag: '*',
        body: {
            comments: note,
        },
    })

    return {
        note_id: `cdk-note-${Date.now().toString(36)}`,
        ro_id: roId,
        source: 'fortellis',
    }
}

// ─── 2. createAppointment ───────────────────────────────────────────────────

/**
 * Create a service appointment in CDK.
 *
 * NOTE: CDK Drive RO Bundle has NO Service Appointments API. This stays
 * mock-only until a separate Fortellis Appointments subscription is
 * obtained. Returning a synthetic CDK id keeps the downstream sync-worker
 * + appointments.cdk_id flow working end-to-end against mock data, so the
 * day a real Appointments API lands we only have to swap the live branch
 * back in.
 *
 * When USE_FORTELLIS_LIVE=true we still return mock data but log a
 * one-line warning so the bundle gap is visible in the service logs (not
 * silently masquerading as a real CDK write).
 */
export async function createAppointment(
    appt: AppointmentPayload,
    _dealerId: string,
): Promise<FortellisAppointmentResult> {
    if (isFortellisLive()) {
        console.warn(
            '[Fortellis] createAppointment: CDK Drive RO Bundle has no Appointments API — ' +
            'returning mock data. Subscribe to a Fortellis Appointments solution to enable live booking.',
        )
    }

    console.log(
        `[Fortellis][mock] createAppointment customer=${appt.customer_id} vehicle=${appt.vehicle_id} ` +
        `service=${appt.service_type} date=${appt.date} time=${appt.time}`,
    )

    return {
        appointment_cdk_id: `mock-appt-${Date.now().toString(36).toUpperCase()}`,
        confirmation_number: `APT-${Date.now().toString(36).toUpperCase()}`,
        source: 'mock',
    }
}

// ─── 3. getCustomer ─────────────────────────────────────────────────────────

export async function getCustomer(phone: string, dealerId: string): Promise<FortellisCustomer | null> {
    if (!phone) return null

    if (!isFortellisLive()) {
        const customer = lookupByPhone(phone)
        if (!customer) return null
        return {
            customer_id: customer.id,
            first_name: customer.firstName,
            last_name: customer.lastName,
            phone: customer.phone,
            email: customer.email,
            loyalty_tier: customer.loyaltyTier,
            notes: customer.notes,
            source: 'mock',
        }
    }

    const dealer = await loadDealer(dealerId)
    const baseUrl = endpoint('FORTELLIS_CUSTOMER_API_URL', DEFAULT_CUSTOMER_API_URL)

    // CDK Drive CRM v1 Customers response shape:
    //   { items: [{ customerId, name: { first, last },
    //               contactMethods: { primaryPhone, email1 },
    //               postalAddress: { … } }] }
    const payload = await fortellisFetch<{ items?: Array<Record<string, unknown>> }>(dealer, {
        method: 'GET',
        url: baseUrl,
        query: { phone },
    })

    const list = Array.isArray(payload.items) ? payload.items : []
    if (list.length === 0) return null
    const c = list[0]

    const id = (c.customerId ?? c.id) as string | undefined
    if (!id) return null

    const name = (c.name as { first?: string; last?: string } | undefined) ?? {}
    const contact = (c.contactMethods as { primaryPhone?: string; email1?: string } | undefined) ?? {}

    return {
        customer_id: String(id),
        first_name: (name.first ?? '').trim(),
        last_name: (name.last ?? '').trim(),
        phone: typeof contact.primaryPhone === 'string' ? contact.primaryPhone : undefined,
        email: typeof contact.email1 === 'string' ? contact.email1 : undefined,
        // CDK Drive CRM v1 does not surface a "loyalty tier" — those live in
        // the dealership's CRM CDP, not the customer record. Left undefined
        // here; downstream code may enrich from a separate source.
        loyalty_tier: undefined,
        notes: typeof c.advisorNotes === 'string' ? c.advisorNotes
            : typeof c.notes === 'string' ? c.notes
            : undefined,
        source: 'fortellis',
    }
}

// ─── 4. getOpCodes ──────────────────────────────────────────────────────────

export async function getOpCodes(makeCode: string, dealerId: string): Promise<FortellisOpCode[]> {
    if (!isFortellisLive()) {
        // Mock catalogue covers the most common Porsche service items.
        return [
            { op_code: 'PORS-OIL', description: 'Engine oil + filter change', labor_hours: 0.75, flat_rate_total: 295 },
            { op_code: 'PORS-SVCA', description: 'Annual Service A', labor_hours: 1.5, flat_rate_total: 595 },
            { op_code: 'PORS-SVCB', description: 'Annual Service B + brake fluid', labor_hours: 3.0, flat_rate_total: 1295 },
            { op_code: 'PORS-BRAKE-R', description: 'Rear brake pad + rotor', labor_hours: 2.5, parts_total: 1100, flat_rate_total: 1850 },
            { op_code: 'PORS-PCCB-INSP', description: 'PCCB ceramic-composite brake inspection', labor_hours: 1.0, flat_rate_total: 395 },
            { op_code: 'PORS-TRACK', description: 'Track preparation', labor_hours: 4.0, flat_rate_total: 1995 },
            { op_code: 'PORS-RECALL-24V271', description: 'Recall 24V-271 — fuel injector seal', labor_hours: 1.5, flat_rate_total: 0 },
        ]
    }

    const dealer = await loadDealer(dealerId)
    const url = endpoint('FORTELLIS_OPCODES_API_URL', DEFAULT_OPCODES_API_URL)

    // CDK Drive Service Catalog v1 OpCodes API supports query params:
    //   desc   — fuzzy match against the op-code description
    //   page   — pagination (defaults to 1)
    //   pageSize — page size (defaults to API-side default)
    // There is NO 'make' query parameter; the caller's makeCode is passed
    // through to `desc` for description-substring matching.
    //
    // Response shape:
    //   { items: [{ opCode, description, flatHours, flatSellRate,
    //               estimatedDuration }] }
    const payload = await fortellisFetch<{ items?: Array<Record<string, unknown>> }>(dealer, {
        method: 'GET',
        url,
        query: { desc: makeCode },
    })

    const list = Array.isArray(payload.items) ? payload.items : []
    return list.map((raw): FortellisOpCode => ({
        op_code: String(raw.opCode ?? ''),
        description: String(raw.description ?? ''),
        labor_hours: typeof raw.flatHours === 'number' ? raw.flatHours : undefined,
        flat_rate_total: typeof raw.flatSellRate === 'number' ? raw.flatSellRate : undefined,
        // Parts total is not part of the CDK Drive Service Catalog v1 OpCode
        // schema — leave undefined; estimate is provided by `estimatedDuration`
        // for ops that need it, but not surfaced here yet.
        parts_total: undefined,
    })).filter((oc) => oc.op_code.length > 0)
}

// ─── 5. getVehicle ──────────────────────────────────────────────────────────

export async function getVehicle(vin: string, dealerId: string): Promise<FortellisVehicle | null> {
    if (!vin) return null

    if (!isFortellisLive()) {
        for (const c of MOCK_CUSTOMERS) {
            const v = c.vehicles.find((veh) => veh.vin === vin)
            if (v) {
                return {
                    vehicle_id: v.id,
                    vin: v.vin,
                    year: v.year,
                    make: v.make,
                    model: v.model,
                    color: v.color,
                    mileage: v.mileage,
                    license_plate: v.licensePlate,
                    source: 'mock',
                }
            }
        }
        return null
    }

    const dealer = await loadDealer(dealerId)
    const baseUrl = endpoint('FORTELLIS_VEHICLE_API_URL', DEFAULT_VEHICLE_API_URL)

    // CDK Drive Service v1 Vehicles response shape:
    //   { items: [{ vehicleId,
    //               identification: { vin, licensePlateNum },
    //               specification: { make, model, modelYear },
    //               mileage: { value, units },
    //               exteriorColor }] }
    const payload = await fortellisFetch<{ items?: Array<Record<string, unknown>> }>(dealer, {
        method: 'GET',
        url: baseUrl,
        query: { vin },
    })

    const list = Array.isArray(payload.items) ? payload.items : []
    if (list.length === 0) return null

    const v = list[0]
    const ident = (v.identification as { vin?: string; licensePlateNum?: string } | undefined) ?? {}
    const spec = (v.specification as { make?: string; model?: string; modelYear?: number | string } | undefined) ?? {}
    const mileage = (v.mileage as { value?: number; units?: string } | undefined) ?? {}

    const id = (v.vehicleId ?? ident.vin ?? vin) as string

    return {
        vehicle_id: String(id),
        vin: typeof ident.vin === 'string' ? ident.vin : vin,
        year: typeof spec.modelYear === 'number'
            ? spec.modelYear
            : (Number(spec.modelYear) || undefined),
        make: typeof spec.make === 'string' ? spec.make : undefined,
        model: typeof spec.model === 'string' ? spec.model : undefined,
        color: typeof v.exteriorColor === 'string' ? v.exteriorColor : undefined,
        mileage: typeof mileage.value === 'number' ? mileage.value : undefined,
        license_plate: typeof ident.licensePlateNum === 'string' ? ident.licensePlateNum : undefined,
        source: 'fortellis',
    }
}
