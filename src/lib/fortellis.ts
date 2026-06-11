// ─── Fortellis CDK client ────────────────────────────────────────────────────
//
// This module talks to the CDK Global "Fortellis" platform on behalf of a
// dealership. Fortellis exposes CDK data via OAuth 2.0 (client_credentials)
// plus a per-account Subscription-Id header.
//
// The dashboard uses this in /api/voice/customer-lookup so when Aria asks
// "who is calling +1 647-…?", the dealership's real CDK data answers — real
// vehicles, real repair orders, real upcoming appointments, real recalls.
//
// When the Fortellis env vars are NOT configured, every exported function
// returns null so callers can fall back to the existing hardcoded demo data
// without crashing. This keeps the POC demo flow working even before any
// dealership has wired up real credentials.
//
// ─── Required environment variables ──────────────────────────────────────────
//
//   FORTELLIS_CLIENT_ID            OAuth client id issued by Fortellis
//   FORTELLIS_CLIENT_SECRET        OAuth client secret
//   FORTELLIS_SUBSCRIPTION_ID      Per-dealership subscription / account id
//   FORTELLIS_TOKEN_URL            Override the default identity URL (optional)
//   FORTELLIS_CUSTOMER_API_URL     Override the default customer lookup base
//                                  URL (optional; varies by which CDK service
//                                  the dealership has enabled)
//
// ────────────────────────────────────────────────────────────────────────────

export interface FortellisVehicle {
    id: string;
    vin: string;
    year?: number;
    make?: string;
    model?: string;
    trim?: string;
    color?: string;
    mileage?: number;
    licensePlate?: string;
}

export interface FortellisRepairOrder {
    roNumber: string;
    status: string;
    description?: string;
    advisorName?: string;
    estimatedCompletion?: string;
    totalEstimate?: number;
    vehicleId?: string;
}

export interface FortellisAppointment {
    id?: string;
    date: string;
    time: string;
    serviceType?: string;
    advisorName?: string;
    status?: string;
    vehicleId?: string;
}

export interface FortellisRecall {
    nhtsa_id?: string;
    component?: string;
    description?: string;
    remedy?: string;
    status?: string;
}

export interface FortellisCustomer {
    id: string;
    firstName: string;
    lastName: string;
    phone?: string;
    email?: string;
    preferredLanguage?: string;
    loyaltyTier?: string;
    notes?: string;
    lastVisit?: string;
    vehicles: FortellisVehicle[];
    openRepairOrders: FortellisRepairOrder[];
    upcomingAppointments: FortellisAppointment[];
    openRecalls: FortellisRecall[];
}

const DEFAULT_TOKEN_URL = 'https://identity.fortellis.io/oauth2/aus1p1ixy7YL8cMq02p7/v1/token';
const DEFAULT_CUSTOMER_API_URL = 'https://api.fortellis.io/cdkservices/customer-information/v1/customers';

type FortellisConfig = {
    clientId: string;
    clientSecret: string;
    subscriptionId: string;
    tokenUrl: string;
    customerApiUrl: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

export function isFortellisConfigured(): boolean {
    return Boolean(
        process.env.FORTELLIS_CLIENT_ID
        && process.env.FORTELLIS_CLIENT_SECRET
        && process.env.FORTELLIS_SUBSCRIPTION_ID,
    );
}

function loadConfig(): FortellisConfig | null {
    const clientId = process.env.FORTELLIS_CLIENT_ID;
    const clientSecret = process.env.FORTELLIS_CLIENT_SECRET;
    const subscriptionId = process.env.FORTELLIS_SUBSCRIPTION_ID;
    if (!clientId || !clientSecret || !subscriptionId) return null;
    return {
        clientId,
        clientSecret,
        subscriptionId,
        tokenUrl: process.env.FORTELLIS_TOKEN_URL ?? DEFAULT_TOKEN_URL,
        customerApiUrl: process.env.FORTELLIS_CUSTOMER_API_URL ?? DEFAULT_CUSTOMER_API_URL,
    };
}

async function getAccessToken(config: FortellisConfig): Promise<string | null> {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt > now + 30_000) {
        return cachedToken.value;
    }

    const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const params = new URLSearchParams({ grant_type: 'client_credentials' });

    const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
        console.error(`[Fortellis] token endpoint returned ${response.status}: ${await response.text().catch(() => '')}`);
        return null;
    }

    const payload = (await response.json().catch(() => null)) as {
        access_token?: string;
        expires_in?: number;
    } | null;

    if (!payload?.access_token) {
        console.error('[Fortellis] token endpoint returned no access_token');
        return null;
    }

    cachedToken = {
        value: payload.access_token,
        expiresAt: now + ((payload.expires_in ?? 3600) * 1000),
    };
    return cachedToken.value;
}

function normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    return digits.length === 10 ? `+1${digits}` : digits.startsWith('+') ? phone : `+${digits}`;
}

// Defensive parser — Fortellis CDK responses vary by service variant. This
// pulls the fields we need out of the most common shapes and tolerates
// missing values rather than throwing.
function normalizeCustomerPayload(raw: unknown): FortellisCustomer | null {
    if (!raw || typeof raw !== 'object') return null;
    const root = raw as Record<string, unknown>;

    const customers = Array.isArray(root.customers)
        ? root.customers
        : Array.isArray((root as { items?: unknown }).items)
        ? ((root as { items: unknown[] }).items)
        : root.customerId || root.id || root.firstName
        ? [root]
        : [];

    if (customers.length === 0) return null;
    const c = customers[0] as Record<string, unknown>;

    const idValue = c.customerId ?? c.id ?? c.contactId;
    if (!idValue) return null;

    const vehicles = Array.isArray(c.vehicles)
        ? (c.vehicles as Array<Record<string, unknown>>)
        : [];
    const openROs = Array.isArray(c.openROs)
        ? (c.openROs as Array<Record<string, unknown>>)
        : Array.isArray(c.repairOrders)
        ? (c.repairOrders as Array<Record<string, unknown>>)
        : [];
    const appointments = Array.isArray(c.upcomingAppointments)
        ? (c.upcomingAppointments as Array<Record<string, unknown>>)
        : Array.isArray(c.appointments)
        ? (c.appointments as Array<Record<string, unknown>>)
        : [];
    const recalls = Array.isArray(c.openRecalls)
        ? (c.openRecalls as Array<Record<string, unknown>>)
        : Array.isArray(c.recalls)
        ? (c.recalls as Array<Record<string, unknown>>)
        : [];

    return {
        id: String(idValue),
        firstName: String(c.firstName ?? c.givenName ?? c.firstname ?? '').trim(),
        lastName: String(c.lastName ?? c.familyName ?? c.lastname ?? '').trim(),
        phone: typeof c.phone === 'string' ? c.phone : typeof c.primaryPhone === 'string' ? c.primaryPhone : undefined,
        email: typeof c.email === 'string' ? c.email : undefined,
        preferredLanguage: typeof c.preferredLanguage === 'string' ? c.preferredLanguage : 'en',
        loyaltyTier: typeof c.loyaltyTier === 'string' ? c.loyaltyTier : undefined,
        notes: typeof c.advisorNotes === 'string' ? c.advisorNotes : typeof c.notes === 'string' ? c.notes : undefined,
        lastVisit: typeof c.lastServiceDate === 'string' ? c.lastServiceDate : typeof c.lastVisit === 'string' ? c.lastVisit : undefined,
        vehicles: vehicles
            .map((v) => {
                const vinValue = v.vin ?? v.vehicleVin ?? v.VIN;
                const vehicleId = v.vehicleId ?? v.id ?? vinValue;
                if (!vehicleId) return null;
                return {
                    id: String(vehicleId),
                    vin: typeof vinValue === 'string' ? vinValue : '',
                    year: typeof v.year === 'number' ? v.year : Number(v.year) || undefined,
                    make: typeof v.make === 'string' ? v.make : undefined,
                    model: typeof v.model === 'string' ? v.model : undefined,
                    trim: typeof v.trim === 'string' ? v.trim : undefined,
                    color: typeof v.color === 'string' ? v.color : typeof v.exteriorColor === 'string' ? v.exteriorColor : undefined,
                    mileage: typeof v.currentMileage === 'number' ? v.currentMileage : typeof v.mileage === 'number' ? v.mileage : undefined,
                    licensePlate: typeof v.licensePlate === 'string' ? v.licensePlate : undefined,
                } as FortellisVehicle;
            })
            .filter((v): v is FortellisVehicle => Boolean(v)),
        openRepairOrders: openROs.map((ro): FortellisRepairOrder => ({
            roNumber: String(ro.roNumber ?? ro.number ?? ro.id ?? 'RO'),
            status: String(ro.status ?? 'open'),
            description: typeof ro.concern === 'string' ? ro.concern : typeof ro.description === 'string' ? ro.description : undefined,
            advisorName: typeof ro.advisorName === 'string' ? ro.advisorName : undefined,
            estimatedCompletion: typeof ro.promisedTime === 'string' ? ro.promisedTime : typeof ro.estimatedCompletion === 'string' ? ro.estimatedCompletion : undefined,
            totalEstimate: typeof ro.totalEstimate === 'number' ? ro.totalEstimate : undefined,
            vehicleId: typeof ro.vehicleId === 'string' ? ro.vehicleId : undefined,
        })),
        upcomingAppointments: appointments.map((appt): FortellisAppointment => ({
            id: typeof appt.id === 'string' ? appt.id : undefined,
            date: String(appt.date ?? ''),
            time: String(appt.time ?? ''),
            serviceType: typeof appt.opCode === 'string' ? appt.opCode : typeof appt.serviceType === 'string' ? appt.serviceType : 'Service Appointment',
            advisorName: typeof appt.advisorName === 'string' ? appt.advisorName : undefined,
            status: typeof appt.status === 'string' ? appt.status : 'confirmed',
            vehicleId: typeof appt.vehicleId === 'string' ? appt.vehicleId : undefined,
        })),
        openRecalls: recalls.map((r): FortellisRecall => ({
            nhtsa_id: typeof r.nhtsa_id === 'string' ? r.nhtsa_id : typeof r.campaignId === 'string' ? r.campaignId : undefined,
            component: typeof r.component === 'string' ? r.component : undefined,
            description: typeof r.description === 'string' ? r.description : typeof r.summary === 'string' ? r.summary : undefined,
            remedy: typeof r.remedy === 'string' ? r.remedy : undefined,
            status: typeof r.status === 'string' ? r.status : 'open',
        })),
    };
}

export async function lookupCustomerByPhone(phone: string): Promise<FortellisCustomer | null> {
    const config = loadConfig();
    if (!config) return null;
    const token = await getAccessToken(config);
    if (!token) return null;

    const normalized = normalizePhone(phone);
    const url = `${config.customerApiUrl}?phone=${encodeURIComponent(normalized)}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Subscription-Id': config.subscriptionId,
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(8_000),
        });

        if (response.status === 401 || response.status === 403) {
            // Token might have been revoked — invalidate cache so the next call refreshes.
            cachedToken = null;
            console.error(`[Fortellis] customer-lookup unauthorized (${response.status}); cache invalidated`);
            return null;
        }

        if (!response.ok) {
            console.error(`[Fortellis] customer-lookup ${response.status}: ${await response.text().catch(() => '')}`);
            return null;
        }

        const payload = await response.json().catch(() => null);
        return normalizeCustomerPayload(payload);
    } catch (error) {
        console.error('[Fortellis] customer-lookup network error:', error instanceof Error ? error.message : error);
        return null;
    }
}
