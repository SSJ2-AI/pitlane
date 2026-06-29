import { NextResponse } from 'next/server';
import { getSupabase, type LoanerVehicleRow } from '@/lib/supabase';
import { resolveScopeForRequest } from '@/lib/dealer';
import { readSessionFromRequest } from '@/lib/role';
import { recordAudit } from '@/lib/audit';

// /api/manager/loaners/vehicles
//
// Phase 13 — loaner-fleet inventory.
//
// GET   — list loaner vehicles for the dealer. Optional date filter:
//         ?available_from=YYYY-MM-DD&available_to=YYYY-MM-DD. When set,
//         we exclude vehicles already assigned to a non-declined
//         loaner_requests row whose date range overlaps.
// POST  — service_manager only. Creates a new loaner vehicle.
//
// license_plate is quasi-PII (see migration 0014 header). Reads stay
// within staff-only surfaces; the dealer filter + the RLS policy ensure
// no cross-dealer leakage.

export const dynamic = 'force-dynamic';

interface VehicleInsert {
    make: string;
    model: string;
    year: number;
    license_plate: string;
    color?: string | null;
    notes?: string | null;
}

function overlap(
    aStart: string | null,
    aEnd: string | null,
    bStart: string,
    bEnd: string,
): boolean {
    if (!aStart || !aEnd) return false;
    return aStart <= bEnd && aEnd >= bStart;
}

export async function GET(request: Request) {
    const scope = await resolveScopeForRequest(request);
    const dealerId = scope.dealerId ?? scope.dealer.id;
    const url = new URL(request.url);
    const availableFrom = url.searchParams.get('available_from');
    const availableTo = url.searchParams.get('available_to');

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({ vehicles: [] as LoanerVehicleRow[], persistence: 'mock' });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ vehicles: [] as LoanerVehicleRow[], persistence: 'mock' });
    }

    const { data, error } = await supabase
        .from('loaner_vehicles')
        .select('*')
        .eq('dealer_id', dealerId)
        .order('make', { ascending: true })
        .order('model', { ascending: true });

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json({ vehicles: [] as LoanerVehicleRow[], persistence: 'mock' });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let vehicles = (data ?? []) as LoanerVehicleRow[];

    if (availableFrom && availableTo) {
        // Filter out vehicles already booked in the requested window.
        const { data: reqs, error: reqErr } = await supabase
            .from('loaner_requests')
            .select('loaner_vehicle_id,start_date,end_date,status')
            .eq('dealer_id', dealerId)
            .not('loaner_vehicle_id', 'is', null)
            .neq('status', 'declined');
        if (reqErr) {
            const code = (reqErr as { code?: string }).code;
            if (code !== '42P01' && code !== '42703') {
                console.warn('[/api/manager/loaners/vehicles] overlap check failed:', reqErr.message);
            }
        } else {
            const busy = new Set<string>();
            for (const r of (reqs ?? []) as Array<{
                loaner_vehicle_id: string | null;
                start_date: string | null;
                end_date: string | null;
            }>) {
                if (!r.loaner_vehicle_id) continue;
                if (overlap(r.start_date, r.end_date, availableFrom, availableTo)) {
                    busy.add(r.loaner_vehicle_id);
                }
            }
            vehicles = vehicles.filter((v) => v.is_available && !busy.has(v.id));
        }
    }

    return NextResponse.json({ vehicles, persistence: 'supabase' });
}

export async function POST(request: Request) {
    const session = readSessionFromRequest(request);
    if (session.role !== 'service_manager') {
        return NextResponse.json(
            { error: 'Forbidden — only service managers can add loaner vehicles.' },
            { status: 403 },
        );
    }

    let body: VehicleInsert;
    try {
        body = (await request.json()) as VehicleInsert;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const make = body.make?.trim();
    const model = body.model?.trim();
    const year = Number(body.year);
    const plate = body.license_plate?.trim();
    if (!make || !model || !year || !plate) {
        return NextResponse.json(
            { error: 'make, model, year, license_plate are required' },
            { status: 400 },
        );
    }

    const scope = await resolveScopeForRequest(request);
    const dealerId = scope.dealerId ?? scope.dealer.id;
    if (!dealerId) {
        return NextResponse.json({ error: 'Manager has no dealer scope.' }, { status: 400 });
    }

    const row = {
        dealer_id: dealerId,
        make,
        model,
        year,
        license_plate: plate,
        color: body.color?.trim() || null,
        notes: body.notes?.trim() || null,
        is_available: true,
    };

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        const now = new Date().toISOString();
        return NextResponse.json({
            vehicle: {
                ...row,
                id: `loaner_mock_${Date.now().toString(36)}`,
                created_at: now,
                updated_at: now,
            } satisfies LoanerVehicleRow,
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

    const { data, error } = await supabase
        .from('loaner_vehicles')
        .insert(row)
        .select('*')
        .single();

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P01') {
            return NextResponse.json(
                { error: 'loaner_vehicles table missing — apply migration 0014' },
                { status: 503 },
            );
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const created = data as LoanerVehicleRow;
    void recordAudit(request, session, {
        action: 'create_loaner_vehicle',
        resourceType: 'loaner_vehicle',
        resourceId: created.id,
    });

    return NextResponse.json({ vehicle: created, persistence: 'supabase' });
}
