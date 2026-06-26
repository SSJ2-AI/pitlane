import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { readSessionFromRequest } from '@/lib/role';
import { getSupabase, type LoanerVehicleRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type VehicleInput = {
    make?: string;
    model?: string;
    year?: number;
    license_plate?: string;
    color?: string | null;
    notes?: string | null;
};

function isIsoDate(value: string | null): value is string {
    return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function mockVehicles(dealerId: string): LoanerVehicleRow[] {
    const now = new Date().toISOString();
    return [
        {
            id: 'loaner_mock_macan',
            dealer_id: dealerId,
            make: 'Porsche',
            model: 'Macan',
            year: 2024,
            license_plate: 'DEMO-013',
            color: 'White',
            is_available: true,
            notes: 'Demo fleet vehicle',
            created_at: now,
            updated_at: now,
        },
    ];
}

export async function GET(request: Request) {
    const session = readSessionFromRequest(request);
    if (!session.userId && process.env.NEXT_PUBLIC_USE_MOCK_DATA !== 'true') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const dealerId = session.dealerId || null;
    if (!dealerId) {
        return NextResponse.json({ error: 'x-pitlane-dealer header is required' }, { status: 400 });
    }

    const url = new URL(request.url);
    const availableFrom = url.searchParams.get('available_from');
    const availableTo = url.searchParams.get('available_to');
    const hasDateRange = isIsoDate(availableFrom) && isIsoDate(availableTo);
    if ((availableFrom || availableTo) && !hasDateRange) {
        return NextResponse.json({ error: 'available_from and available_to must both be YYYY-MM-DD.' }, { status: 400 });
    }

    const supabase = getSupabase();
    if (!supabase || process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ vehicles: mockVehicles(dealerId), persistence: 'mock' });
    }

    let vehicleQuery = supabase
        .from('loaner_vehicles')
        .select('*')
        .eq('dealer_id', dealerId)
        .order('make', { ascending: true })
        .order('model', { ascending: true })
        .order('year', { ascending: false });

    if (hasDateRange) {
        vehicleQuery = vehicleQuery.eq('is_available', true);
    }

    const { data: vehicles, error: vehiclesError } = await vehicleQuery;
    if (vehiclesError) {
        const code = (vehiclesError as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ vehicles: [], persistence: 'supabase_pending_migration' });
        }
        return NextResponse.json({ error: vehiclesError.message }, { status: 500 });
    }

    let rows = (vehicles ?? []) as LoanerVehicleRow[];
    if (hasDateRange) {
        const { data: busyRequests, error: busyError } = await supabase
            .from('loaner_requests')
            .select('loaner_vehicle_id')
            .eq('dealer_id', dealerId)
            .neq('status', 'declined')
            .not('loaner_vehicle_id', 'is', null)
            .lte('start_date', availableTo)
            .gte('end_date', availableFrom);

        if (busyError) {
            return NextResponse.json({ error: busyError.message }, { status: 500 });
        }
        const busyIds = new Set((busyRequests ?? []).map((row) => (row as { loaner_vehicle_id: string | null }).loaner_vehicle_id).filter(Boolean));
        rows = rows.filter((vehicle) => !busyIds.has(vehicle.id));
    }

    return NextResponse.json({ vehicles: rows, persistence: 'supabase' });
}

export async function POST(request: Request) {
    const session = readSessionFromRequest(request);
    if (session.role !== 'service_manager') {
        return NextResponse.json({ error: 'Forbidden — service managers only.' }, { status: 403 });
    }
    const dealerId = session.dealerId || null;
    if (!dealerId) {
        return NextResponse.json({ error: 'x-pitlane-dealer header is required' }, { status: 400 });
    }

    let body: VehicleInput;
    try {
        body = (await request.json()) as VehicleInput;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const make = body.make?.trim();
    const model = body.model?.trim();
    const licensePlate = body.license_plate?.trim().toUpperCase();
    const year = Number(body.year);
    if (!make || !model || !licensePlate || !Number.isInteger(year) || year < 1990 || year > 2100) {
        return NextResponse.json({ error: 'make, model, valid year, and license_plate are required.' }, { status: 400 });
    }

    const insert = {
        dealer_id: dealerId,
        make,
        model,
        year,
        license_plate: licensePlate,
        color: body.color?.trim() || null,
        notes: body.notes?.trim() || null,
    };

    const supabase = getSupabase();
    if (!supabase || process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        const now = new Date().toISOString();
        return NextResponse.json({
            vehicle: { id: `loaner_mock_${Date.now().toString(36)}`, ...insert, is_available: true, created_at: now, updated_at: now },
            persistence: 'mock',
        });
    }

    const { data, error } = await supabase
        .from('loaner_vehicles')
        .insert(insert)
        .select('*')
        .single();

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ error: 'loaner_vehicles table missing — apply migration 0014' }, { status: 503 });
        }
        if (code === '23505') {
            return NextResponse.json({ error: 'A loaner with that plate already exists for this dealer.' }, { status: 409 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'create_loaner_vehicle',
        resourceType: 'loaner_vehicle',
        resourceId: (data as LoanerVehicleRow | null)?.id ?? null,
    });

    return NextResponse.json({ vehicle: data as LoanerVehicleRow, persistence: 'supabase' });
}
