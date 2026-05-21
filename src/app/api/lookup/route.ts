import { NextResponse } from 'next/server';

const pitLaneCustomer = {
    customer: {
        name: 'James Whitfield',
        phone: '647-555-0192',
        email: 'j.whitfield@gmail.com',
        customerSinceYear: 2018,
        lifetimeVisits: 14,
        lifetimeSpend: 32850,
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
    },
};

export async function POST(request: Request) {
    let phone = '';
    try {
        const body = await request.json();
        phone = typeof body?.phone === 'string' ? body.phone : '';
    } catch {
        phone = '';
    }
    const digitsOnly = phone.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
        return NextResponse.json(
            { customer: null, message: 'No customer found for this number - this may be a new customer.' },
            { status: 404 },
        );
    }
    return NextResponse.json(pitLaneCustomer);
}
