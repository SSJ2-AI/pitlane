import { NextResponse } from 'next/server';

const customers = [{
    customer: {
        name: 'James Whitfield',
        phone: '647-555-0192',
        email: 'j.whitfield@gmail.com',
        customerSinceYear: 2018,
        loyaltyTier: 'Gold',
        lifetimeVisits: 14,
        lifetimeSpend: 32850,
        advisorNote: 'Previously declined rear brake replacement - re-offer during write-up.',
    },
    vehicles: [
        {
            id: 'cayenne-s',
            year: 2021,
            make: 'Porsche',
            model: 'Cayenne S',
            vin: 'WP1AA2AY4MDA12345',
            color: 'Jet Black Metallic',
            mileageKm: 42800,
            serviceHistory: [
                {
                    id: 'svc-cayenne-2025-11',
                    date: 'Nov 2025',
                    services: ['Oil Change', 'Cabin Air Filter'],
                    techName: 'Marco Alvarez',
                    cost: 785,
                    declined: [
                        {
                            service: 'Rear Brake Replacement',
                            cost: 875,
                            note: 'Previously declined - re-offer',
                        },
                    ],
                },
            ],
            recalls: [
                {
                    campaign: '24V-271',
                    component: 'Fuel Injector Sealing Defect',
                    summary: 'Fuel injector seals may not maintain proper pressure under high load conditions.',
                    remedy: 'Remedy available - schedule now',
                },
            ],
        },
        {
            id: 'carrera-s',
            year: 2020,
            make: 'Porsche',
            model: '911 Carrera S',
            vin: 'WP0AA2A71LS200123',
            color: 'Guards Red',
            mileageKm: 18200,
            serviceHistory: [
                {
                    id: 'svc-911-2025-06',
                    date: 'June 2025',
                    services: ['Annual Service B'],
                    techName: 'Nina Patel',
                    cost: 960,
                    declined: [],
                },
            ],
            recalls: [],
        },
    ],
    shopStatus: {
        capacityPercent: 72,
        estimatedWaitMinutes: 45,
        technicians: 4,
        openRepairOrders: 6,
    },
    nextAppointment: {
        date: 'May 28, 2026',
        time: '9:00 AM',
        services: ['Annual Service B', 'Brake Fluid Replacement'],
        advisorName: 'Service Advisor',
    },
    openRepairOrders: [
        {
            id: 'ro-cayenne-brakes',
            number: 'RO-10482',
            status: 'Estimate',
            service: 'Rear Brake Replacement',
            advisorName: 'Service Advisor',
        },
    ],
}, {
    customer: {
        name: 'Sulaim Siddiqi',
        phone: '+16475457709',
        email: 'sulaim91@googlemail.com',
        customerSinceYear: 2023,
        loyaltyTier: 'Platinum',
        lifetimeVisits: 8,
        lifetimeSpend: 94500,
        advisorNote: 'Platinum client. Frequent track use — Mosport CTMP. Prefer early morning appointments.',
    },
    vehicles: [
        {
            id: 'gt3-rs',
            year: 2023,
            make: 'Porsche',
            model: '911 GT3 RS',
            vin: 'WP0AA2A98NS820011',
            color: 'Shark Blue',
            mileageKm: 8200,
            serviceHistory: [],
            recalls: [],
        },
    ],
    shopStatus: {
        capacityPercent: 72,
        estimatedWaitMinutes: 45,
        technicians: 4,
        openRepairOrders: 0,
    },
    nextAppointment: {
        date: 'June 20, 2026',
        time: '09:00',
        services: ['Track Preparation Service + PCCB Inspection'],
        advisorName: 'Michael Chen',
    },
    openRepairOrders: [],
}];

function normalizePhone(phone: string) {
    return phone.replace(/\D/g, '');
}

function phoneMatches(inputPhone: string, customerPhone: string) {
    const inputDigits = normalizePhone(inputPhone);
    const customerDigits = normalizePhone(customerPhone);

    if (inputDigits.length < 10) return false;

    return inputDigits === customerDigits || inputDigits.slice(-10) === customerDigits.slice(-10);
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
    if (digitsOnly.length < 10) {
        return NextResponse.json(
            { customer: null, message: 'No customer found for this number - this may be a new customer.' },
            { status: 404 },
        );
    }

    const customer = customers.find((record) => phoneMatches(phone, record.customer.phone));

    if (!customer) {
        return NextResponse.json(
            { customer: null, message: 'No customer found for this number - this may be a new customer.' },
            { status: 404 },
        );
    }

    return NextResponse.json(customer);
}
