import { NextResponse } from 'next/server';

// GET /api/employees?type=technician
//
// Phase 9b — thin proxy for the dashboard's tech-assignment dropdown.
// Mirrors voice/src/cdk/fortellis.ts getEmployees(): mock list in
// USE_MOCK_DATA mode (which we always are on Vercel/demo), live CDK
// fetch when USE_FORTELLIS_LIVE=true (out of scope on the dashboard
// side — that env var lives on the voice service).

const MOCK_TECHNICIANS = [
    { employeeId: 'tech_001', name: 'Marco Rossi', specialty: 'Engine/Transmission', source: 'mock' as const },
    { employeeId: 'tech_002', name: 'Lena Park', specialty: 'Electrical/Software', source: 'mock' as const },
    { employeeId: 'tech_003', name: 'Dave Chen', specialty: 'PDI/Routine Service', source: 'mock' as const },
];

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    void searchParams.get('type');
    return NextResponse.json({ employees: MOCK_TECHNICIANS });
}
