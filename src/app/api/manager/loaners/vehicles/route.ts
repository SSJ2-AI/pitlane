import { NextResponse } from 'next/server';
import { DEFAULT_DEALER_ID } from '@/lib/dealer';
import { recordAudit } from '@/lib/audit';
import { readSessionFromRequest } from '@/lib/role';
import { getSupabase, type LoanerVehicleRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface CreateVehicleInput {
    make?: string;
    model?: string;
    year?: number;
    license_plate?: string;
    color?: string | null;
    notes?: string | null;
}

function resolveScopedDealerId(request: Request): string | null {
    const headerDealer = request.headers.get('x-pitlane-dealer');
    if (headerDealer && headerDealer.trim().length > 0) return headerDealer.trim();
    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') return DEFAULT_DEALER_ID;
    return null;
}

function hasRoleHeader(request: Request): boolean {
    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') return true;
    return Boolean(request.headers.get('x-pitlane-role'));
}

function isIsoDate(value: string | null): value is string {
    return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function GET(request: Request) {
    if (!hasRoleHeader(request)) {
        return NextResponse.json({ error: 'Unauthorized — missing x-pitlane-role header' }, { status: 401 });
    }

    const dealerId = resolveScopedDealerId(request);
    if (!dealerId) {
        return NextResponse.json({ error: 'Missing x-pitlane-dealer header' }, { status: 400 });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ vehicles: [] as LoanerVehicleRow[], persistence: 'mock' });
    }

    const { searchParams } = new URL(request.url);
    const availableFrom = searchParams.get('available_from');
    const availableTo = searchParams.get('available_to');

    const { data, error } = await supabase
        .from('loaner_vehicles')
        .select('*')
        .eq('dealer_id', dealerId)
        .order('make', { ascending: true })
        .order('model', { ascending: true })
        .order('year', { ascending: true });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let vehicles = (data ?? []) as LoanerVehicleRow[];
    if (isIsoDate(availableFrom) && isIsoDate(availableTo)) {
        const overlap = await supabase
            .from('loaner_requests')
            .select('loaner_vehicle_id,status,start_date,end_date')
            .eq('dealer_id', dealerId)
            .not('loaner_vehicle_id', 'is', null)
            .neq('status', 'declined')
            .lte('start_date', availableTo)
            .gte('end_date', availableFrom);

        if (overlap.error) {
            return NextResponse.json({ error: overlap.error.message }, { status: 500 });
        }

        const unavailable = new Set(
            ((overlap.data ?? []) as Array<{ loaner_vehicle_id: string | null }>)
                .map((row) => row.loaner_vehicle_id)
                .filter((id): id is string => Boolean(id)),
        );
        vehicles = vehicles.filter((v) => !unavailable.has(v.id));
    }

    return NextResponse.json({ vehicles, persistence: 'supabase' });
}

export async function POST(request: Request) {
    if (!hasRoleHeader(request)) {
        return NextResponse.json({ error: 'Unauthorized — missing x-pitlane-role header' }, { status: 401 });
    }

    const session = readSessionFromRequest(request);
    if (session.role !== 'service_manager') {
        return NextResponse.json({ error: 'Forbidden — service_manager role required' }, { status: 403 });
    }

    const dealerId = resolveScopedDealerId(request);
    if (!dealerId) {
        return NextResponse.json({ error: 'Missing x-pitlane-dealer header' }, { status: 400 });
    }

    let body: CreateVehicleInput;
    try {
        body = await request.json() as CreateVehicleInput;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const make = body.make?.trim();
    const model = body.model?.trim();
    const licensePlate = body.license_plate?.trim();
    if (!make || !model || !licensePlate || !Number.isInteger(body.year)) {
        return NextResponse.json({ error: 'make, model, year, and license_plate are required' }, { status: 400 });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const { data, error } = await supabase
        .from('loaner_vehicles')
        .insert({
            dealer_id: dealerId,
            make,
            model,
            year: body.year,
            license_plate: licensePlate,
            color: body.color ?? null,
            notes: body.notes ?? null,
            is_available: true,
        })
        .select('*')
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'create_loaner_vehicle',
        resourceType: 'loaner_vehicle',
        resourceId: (data as { id?: string } | null)?.id ?? null,
    });

    return NextResponse.json({ vehicle: data as LoanerVehicleRow, persistence: 'supabase' });
}
