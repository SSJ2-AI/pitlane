import { NextResponse } from 'next/server';

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

export async function POST(request: Request) {
    let phone = '';

    try {
        const body = await request.json();
        phone = typeof body?.phone === 'string' ? body.phone : '';
    } catch {
        phone = '';
    }

    const digitsOnly = normalizePhone(phone);
    const customer = [sulaimProfile, jamesProfile].find((profile) => normalizePhone(profile.phone).endsWith(digitsOnly.slice(-10)));

    if (!customer) {
        return NextResponse.json(
            { customer: null, message: 'No customer found for this number - this may be a new customer.' },
            { status: 404 },
        );
    }

    return NextResponse.json({ customer });
}
