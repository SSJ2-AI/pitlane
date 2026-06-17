import { NextResponse } from 'next/server';
import { resolveDealerForRequest } from '@/lib/dealer';
import {
    fetchOpenRecallsByVin,
    findMockRepairOrders,
    findMockVehicle,
    type MockRecall,
    type MockRepairOrder,
    type MockVehicle,
    type VehicleSource,
} from '@/lib/mock-vehicles';
import { predictNextServiceForVehicle, type NextServicePrediction } from '@/lib/next-service';
import { getSupabase, type AppointmentRow, type UpsellRow } from '@/lib/supabase';

// GET /api/vehicles/:id
//
// Composite endpoint backing the /vehicles/[id] page. Returns:
//   { vehicle, repair_orders, recalls, next_service, source, dealer }
//
// Repair-order resolution order:
//   1. Supabase appointments + upsells filtered by vehicle_id (real Aria
//      writes from Phase 2B / 3) — merged into a unified timeline.
//   2. Mock RO history from src/lib/mock-vehicles.ts when Supabase has
//      nothing or isn't configured.
//
// Vehicle + recall lookups stay on the mock dataset until Phase 6 lands
// (`hourly CDK pull → Supabase vehicles + recalls tables`). The
// `fetchOpenRecallsByVin` stub is the seam where the NHTSA API will land.

export const dynamic = 'force-dynamic';

interface VehiclePayload {
    vehicle: MockVehicle | null;
    repair_orders: MockRepairOrder[];
    recalls: MockRecall[];
    next_service: NextServicePrediction | null;
    source: VehicleSource;
    dealer: { id: string; name: string };
    persistence: 'supabase' | 'mock';
}

interface RouteContext {
    params: { id: string };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse<VehiclePayload | { error: string }>> {
    const idOrVin = context.params.id;
    if (!idOrVin) {
        return NextResponse.json({ error: 'vehicle id required' }, { status: 400 });
    }

    const dealer = await resolveDealerForRequest(request);
    const vehicle = findMockVehicle(idOrVin);

    if (!vehicle) {
        return NextResponse.json({ error: `vehicle ${idOrVin} not found` }, { status: 404 });
    }

    const supabaseOrders = await tryLoadSupabaseHistory(vehicle.id, dealer.id);
    const repairOrders = supabaseOrders.length > 0 ? supabaseOrders : findMockRepairOrders(vehicle.id, 10);

    const recalls = await fetchOpenRecallsByVin(vehicle.vin);
    const nextService = predictNextServiceForVehicle(vehicle, repairOrders);

    return NextResponse.json({
        vehicle,
        repair_orders: repairOrders,
        recalls,
        next_service: nextService,
        source: 'mock' as VehicleSource,
        dealer: { id: dealer.id, name: dealer.name },
        persistence: supabaseOrders.length > 0 ? 'supabase' : 'mock',
    });
}

// ─── Supabase history ────────────────────────────────────────────────────────
//
// Pulls every appointment + upsell row tagged with this vehicle_id, sorts
// by date desc, and maps them into the same RO-shaped envelope the mock
// timeline uses. Returns [] when Supabase isn't configured OR when the
// vehicle has no Phase 2B / 3 history yet, so the caller falls through to
// the mock fixture cleanly.

async function tryLoadSupabaseHistory(vehicleId: string, dealerId: string): Promise<MockRepairOrder[]> {
    const supabase = getSupabase();
    if (!supabase) return [];

    try {
        const [apptResult, upsellResult] = await Promise.all([
            supabase
                .from('appointments')
                .select('*')
                .eq('dealer_id', dealerId)
                .eq('vehicle_id', vehicleId)
                .order('date', { ascending: false })
                .limit(10),
            supabase
                .from('upsells')
                .select('*')
                .eq('dealer_id', dealerId)
                .eq('vehicle_id', vehicleId)
                .order('created_at', { ascending: false })
                .limit(10),
        ]);

        if (apptResult.error) {
            console.error('[/api/vehicles/:id] appointments select failed:', apptResult.error.message);
        }
        if (upsellResult.error) {
            console.error('[/api/vehicles/:id] upsells select failed:', upsellResult.error.message);
        }

        const fromAppointments: MockRepairOrder[] = (apptResult.data ?? []).map(toRepairOrderFromAppointment);
        const fromUpsells: MockRepairOrder[] = (upsellResult.data ?? []).map(toRepairOrderFromUpsell);

        return [...fromAppointments, ...fromUpsells]
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .slice(0, 10);
    } catch (err) {
        console.error('[/api/vehicles/:id] Supabase history threw:', err instanceof Error ? err.message : err);
        return [];
    }
}

function toRepairOrderFromAppointment(appt: AppointmentRow): MockRepairOrder {
    const status: MockRepairOrder['status'] =
        appt.status === 'completed' ? 'completed' : appt.status === 'cancelled' ? 'completed' : 'open';
    return {
        ro_number: appt.confirmation_number ?? `APPT-${appt.id.slice(0, 8).toUpperCase()}`,
        vehicle_id: appt.vehicle_id,
        date: appt.date,
        service_type: appt.service_type,
        advisor_name: appt.advisor ?? 'Unassigned',
        status,
        summary: `Appointment scheduled${appt.duration_est_hours ? ` (${appt.duration_est_hours}h)` : ''}.${
            appt.cdk_id ? ` CDK id ${appt.cdk_id}.` : ''
        }`,
    };
}

function toRepairOrderFromUpsell(upsell: UpsellRow): MockRepairOrder {
    return {
        ro_number: `UP-${upsell.id.slice(0, 8).toUpperCase()}`,
        vehicle_id: upsell.vehicle_id,
        date: upsell.created_at.slice(0, 10),
        service_type: `Upsell · ${upsell.upsell_type}`,
        advisor_name: 'Aria (auto-flagged)',
        status: upsell.status === 'accepted' ? 'completed' : 'open',
        summary: upsell.description ?? `Flagged opportunity${upsell.value_est ? `, est. $${upsell.value_est}` : ''}.`,
        total_cost: upsell.value_est ?? undefined,
    };
}
