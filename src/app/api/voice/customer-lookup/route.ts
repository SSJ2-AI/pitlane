import { NextResponse } from 'next/server';
import { isFortellisConfigured, lookupCustomerByPhone as lookupFortellisCustomer, type FortellisCustomer } from '@/lib/fortellis';

const sulaimProfile = {
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
    lastVisit: '2026-06-01',
    lifetimeValue: 94500,
    loyaltyTier: 'Platinum',
    vehicles: [
        {
            id: 'veh_005a',
            display: '2023 Porsche 911 GT3 RS',
            vin: 'WP0AA2A98NS820011',
            year: 2023,
            make: 'Porsche',
            model: '911',
            trim: 'GT3 RS',
            color: 'Shark Blue',
            mileage: 8200,
            licensePlate: 'GT3 RSS',
        },
    ],
    openRepairOrders: [],
    upcomingAppointments: [
        {
            id: 'appt_005a',
            customerId: 'cust_005',
            vehicleId: 'veh_005a',
            date: '2026-06-20',
            time: '09:00',
            serviceType: 'Track Preparation Service + PCCB Inspection',
            advisorName: 'Michael Chen',
            status: 'confirmed',
        },
    ],
    openRecalls: [],
    notes: 'Platinum client. Frequent track use - Mosport CTMP. Prefer early morning appointments.',
};

const jamesProfile = {
    id: 'cust_001',
    firstName: 'James',
    lastName: 'Whitfield',
    phone: '+16475550192',
    email: 'j.whitfield@gmail.com',
    preferredLanguage: 'en',
    lastVisit: '2025-11-01',
    lifetimeValue: 32850,
    loyaltyTier: 'Gold',
    vehicles: [
        {
            id: 'veh_001a',
            display: '2021 Porsche Cayenne S',
            vin: 'WP1AA2AY4MDA12345',
            year: 2021,
            make: 'Porsche',
            model: 'Cayenne',
            trim: 'S',
            color: 'Jet Black Metallic',
            mileage: 42800,
        },
    ],
    openRepairOrders: [
        {
            id: 'ro_001a',
            roNumber: 'RO-10482',
            status: 'estimate',
            serviceType: 'Rear Brake Replacement',
            advisorName: 'Service Advisor',
            vehicleId: 'veh_001a',
        },
    ],
    upcomingAppointments: [
        {
            id: 'appt_001a',
            customerId: 'cust_001',
            vehicleId: 'veh_001a',
            date: '2026-05-28',
            time: '09:00',
            serviceType: 'Annual Service B + Brake Fluid Replacement',
            advisorName: 'Service Advisor',
            status: 'confirmed',
        },
    ],
    openRecalls: [
        {
            id: 'recall_001a',
            campaign: '24V-271',
            component: 'Fuel Injector Sealing Defect',
            summary: 'Fuel injector seals may not maintain proper pressure under high load conditions.',
            remedy: 'Remedy available - schedule now',
        },
    ],
    notes: 'Previously declined rear brake replacement - re-offer during write-up.',
};

function normalizePhone(phone: string) {
    return phone.replace(/\D/g, '');
}

function lookupCustomer(phone: string) {
    const digitsOnly = normalizePhone(phone);

    if (digitsOnly.length < 10) return null;

    return [sulaimProfile, jamesProfile].find((profile) => normalizePhone(profile.phone).endsWith(digitsOnly.slice(-10))) ?? null;
}

function hasValidApiKey(request: Request) {
    const expectedApiKey = process.env.PITLANE_VOICE_API_KEY;

    if (!expectedApiKey) return true;

    const authorization = request.headers.get('authorization');
    const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    const apiKey = request.headers.get('x-pitlane-voice-key')
        ?? request.headers.get('x-api-key')
        ?? request.headers.get('x-pitlane-api-key')
        ?? bearerToken;

    return apiKey === expectedApiKey;
}

function unauthorized() {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
}

function formatCustomerPayload(customer: typeof sulaimProfile | typeof jamesProfile) {
    return {
        found: true,
        customer: {
            id: customer.id,
            firstName: customer.firstName,
            lastName: customer.lastName,
            phone: customer.phone,
            email: customer.email,
            loyaltyTier: customer.loyaltyTier,
            notes: customer.notes,
        },
        vehicles: customer.vehicles.map((vehicle) => ({
            id: vehicle.id,
            display: vehicle.display,
            vin: vehicle.vin,
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
            trim: vehicle.trim,
            color: vehicle.color,
            mileage: vehicle.mileage,
            licensePlate: 'licensePlate' in vehicle ? vehicle.licensePlate : undefined,
        })),
        openRepairOrders: customer.openRepairOrders,
        nextAppointment: customer.upcomingAppointments[0] ?? null,
        upcomingAppointments: customer.upcomingAppointments,
        openRecalls: customer.openRecalls,
    };
}

function formatFortellisPayload(customer: FortellisCustomer) {
    const primary = customer.upcomingAppointments[0];
    return {
        found: true,
        source: 'fortellis' as const,
        customer: {
            id: customer.id,
            firstName: customer.firstName,
            lastName: customer.lastName,
            phone: customer.phone,
            email: customer.email,
            loyaltyTier: customer.loyaltyTier,
            preferredLanguage: customer.preferredLanguage ?? 'en',
            notes: customer.notes,
        },
        vehicles: customer.vehicles.map((vehicle) => ({
            id: vehicle.id,
            display: [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ').trim(),
            vin: vehicle.vin,
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
            trim: vehicle.trim,
            color: vehicle.color,
            mileage: vehicle.mileage,
            licensePlate: vehicle.licensePlate,
        })),
        openRepairOrders: customer.openRepairOrders.map((ro) => ({
            id: ro.roNumber,
            roNumber: ro.roNumber,
            status: ro.status,
            serviceType: ro.description,
            description: ro.description,
            advisorName: ro.advisorName,
            estimatedCompletion: ro.estimatedCompletion,
            totalEstimate: ro.totalEstimate,
            vehicleId: ro.vehicleId,
        })),
        nextAppointment: primary
            ? {
                id: primary.id,
                date: primary.date,
                time: primary.time,
                serviceType: primary.serviceType,
                advisorName: primary.advisorName,
                status: primary.status,
                vehicleId: primary.vehicleId,
            }
            : null,
        upcomingAppointments: customer.upcomingAppointments,
        openRecalls: customer.openRecalls.map((recall) => ({
            id: recall.nhtsa_id,
            nhtsa_id: recall.nhtsa_id,
            component: recall.component,
            summary: recall.description,
            description: recall.description,
            remedy: recall.remedy,
            status: recall.status,
        })),
        lastVisit: customer.lastVisit,
    };
}

async function customerResponse(phone: string) {
    // Phase 4 — try real Fortellis CDK first when configured. Falls back to
    // hardcoded demo data so the POC keeps working in dealerships that
    // haven't connected their CDK yet.
    if (isFortellisConfigured()) {
        const fortellisCustomer = await lookupFortellisCustomer(phone);
        if (fortellisCustomer) {
            return NextResponse.json(formatFortellisPayload(fortellisCustomer));
        }
        // Configured but lookup returned nothing — treat as not-found from CDK
        // (do NOT fall through to mocks for real dealerships, that would be
        // misleading; just say no record).
        return NextResponse.json(
            {
                found: false,
                source: 'fortellis' as const,
                customer: null,
                vehicles: [],
                openRepairOrders: [],
                nextAppointment: null,
                openRecalls: [],
                message: 'No customer found for this number - this may be a new customer.',
            },
            { status: 404 },
        );
    }

    // Demo / unconfigured fallback path.
    const customer = lookupCustomer(phone);

    if (!customer) {
        return NextResponse.json(
            { found: false, source: 'mock' as const, customer: null, vehicles: [], openRepairOrders: [], nextAppointment: null, openRecalls: [], message: 'No customer found for this number - this may be a new customer.' },
            { status: 404 },
        );
    }

    return NextResponse.json({ ...formatCustomerPayload(customer), source: 'mock' as const });
}

export async function GET(request: Request) {
    if (!hasValidApiKey(request)) {
        return unauthorized();
    }

    const { searchParams } = new URL(request.url);
    return customerResponse(searchParams.get('phone') ?? '');
}

export async function POST(request: Request) {
    let phone = '';

    if (!hasValidApiKey(request)) {
        return unauthorized();
    }

    try {
        const body = await request.json();
        phone = typeof body?.phone === 'string' ? body.phone : '';
    } catch {
        phone = '';
    }

    return customerResponse(phone);
}
