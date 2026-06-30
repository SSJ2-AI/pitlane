import type { SupabaseClient } from '@supabase/supabase-js';
import type { UpsellRow } from '@/lib/supabase';
import { findMockCustomer, MOCK_APPOINTMENTS } from '@/lib/mock-customers';
import { findMockVehicle, MOCK_VEHICLES } from '@/lib/mock-vehicles';
import { normalizeCustomerTier } from '@/lib/customer-display';

export type UpsellWithCustomerContext = UpsellRow & {
    customer_phone: string | null;
    customer_tier: string | null;
    vehicle_summary: string | null;
};

type CustomerLookupRow = {
    id: string;
    phone: string | null;
    tier?: string | null;
};

type AppointmentLookupRow = {
    customer_id: string | null;
    date?: string | null;
    time?: string | null;
    created_at?: string | null;
    vehicle_id?: string | null;
    vehicle_year?: number | null;
    vehicle_make?: string | null;
    vehicle_model?: string | null;
    vehicle_trim?: string | null;
};

type VehicleLookupRow = {
    id: string;
    year?: number | null;
    make?: string | null;
    model?: string | null;
    trim?: string | null;
};

function nonEmpty(value: string | null | undefined): string | null {
    const trimmed = (value ?? '').trim();
    return trimmed.length > 0 ? trimmed : null;
}

function toVehicleSummary(parts: {
    year?: number | null;
    make?: string | null;
    model?: string | null;
    trim?: string | null;
}): string | null {
    const yearPart = typeof parts.year === 'number' ? String(parts.year) : null;
    const makePart = nonEmpty(parts.make);
    const modelPart = nonEmpty(parts.model);
    const trimPart = nonEmpty(parts.trim);
    const joined = [yearPart, makePart, modelPart, trimPart].filter(Boolean).join(' ').trim();
    return joined.length > 0 ? joined : null;
}

function appointmentRecencyScore(row: AppointmentLookupRow): number {
    if (row.date) {
        const stamp = `${row.date}T${row.time ?? '00:00:00'}`;
        const parsed = Date.parse(stamp);
        if (!Number.isNaN(parsed)) return parsed;
    }
    if (row.created_at) {
        const parsed = Date.parse(row.created_at);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
}

export function enrichMockUpsells(upsells: UpsellRow[]): UpsellWithCustomerContext[] {
    const latestMockApptByCustomer = new Map<string, AppointmentLookupRow>();
    for (const appt of MOCK_APPOINTMENTS) {
        const score = appointmentRecencyScore(appt);
        const current = latestMockApptByCustomer.get(appt.customer_id);
        if (!current || score > appointmentRecencyScore(current)) {
            latestMockApptByCustomer.set(appt.customer_id, appt);
        }
    }

    return upsells.map((upsell) => {
        const mockCustomer = findMockCustomer(upsell.customer_id);
        const latestAppt = latestMockApptByCustomer.get(upsell.customer_id);
        const latestVehicle = latestAppt?.vehicle_id ? findMockVehicle(latestAppt.vehicle_id) : null;
        const directVehicle = findMockVehicle(upsell.vehicle_id);
        const fallbackVehicle = MOCK_VEHICLES.find((v) => v.customer_id === upsell.customer_id) ?? null;
        const vehicleSummary =
            toVehicleSummary(latestVehicle ?? {}) ??
            toVehicleSummary(directVehicle ?? {}) ??
            toVehicleSummary(fallbackVehicle ?? {});

        return {
            ...upsell,
            customer_phone: mockCustomer?.phone ?? null,
            customer_tier: mockCustomer?.loyaltyTier ?? null,
            vehicle_summary: vehicleSummary,
        };
    });
}

export async function enrichSupabaseUpsells(
    supabase: SupabaseClient,
    upsells: UpsellRow[],
): Promise<UpsellWithCustomerContext[]> {
    if (upsells.length === 0) return [];

    const customerIds = Array.from(
        new Set(
            upsells
                .map((u) => u.customer_id)
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
        ),
    );

    const dealerIds = Array.from(
        new Set(
            upsells
                .map((u) => u.dealer_id)
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
        ),
    );

    const customerMap = new Map<string, CustomerLookupRow>();
    if (customerIds.length > 0) {
        let customersRes = await supabase
            .from('customers')
            .select('id, phone, tier')
            .in('id', customerIds);
        if (customersRes.error) {
            customersRes = await supabase
                .from('customers')
                .select('id, phone')
                .in('id', customerIds);
        }
        for (const row of (customersRes.data ?? []) as CustomerLookupRow[]) {
            customerMap.set(row.id, row);
        }
    }

    const latestAppointmentByCustomer = new Map<string, AppointmentLookupRow>();
    if (customerIds.length > 0) {
        let apptQuery = supabase
            .from('appointments')
            .select('customer_id, date, time, created_at, vehicle_id, vehicle_year, vehicle_make, vehicle_model, vehicle_trim')
            .in('customer_id', customerIds)
            .order('date', { ascending: false })
            .order('time', { ascending: false });
        if (dealerIds.length > 0) apptQuery = apptQuery.in('dealer_id', dealerIds);
        let apptRes = await apptQuery;
        if (apptRes.error) {
            let fallbackQuery = supabase
                .from('appointments')
                .select('customer_id, date, time, created_at, vehicle_id')
                .in('customer_id', customerIds)
                .order('date', { ascending: false })
                .order('time', { ascending: false });
            if (dealerIds.length > 0) fallbackQuery = fallbackQuery.in('dealer_id', dealerIds);
            apptRes = await fallbackQuery;
        }
        for (const row of (apptRes.data ?? []) as AppointmentLookupRow[]) {
            const customerId = row.customer_id ?? '';
            if (!customerId) continue;
            const current = latestAppointmentByCustomer.get(customerId);
            if (!current || appointmentRecencyScore(row) > appointmentRecencyScore(current)) {
                latestAppointmentByCustomer.set(customerId, row);
            }
        }
    }

    const vehicleIds = Array.from(
        new Set(
            [
                ...upsells.map((u) => u.vehicle_id),
                ...Array.from(latestAppointmentByCustomer.values()).map((row) => row.vehicle_id ?? ''),
            ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
        ),
    );
    const vehicleMap = new Map<string, VehicleLookupRow>();
    if (vehicleIds.length > 0) {
        const vehiclesRes = await supabase
            .from('vehicles')
            .select('id, year, make, model, trim')
            .in('id', vehicleIds);
        if (!vehiclesRes.error) {
            for (const row of (vehiclesRes.data ?? []) as VehicleLookupRow[]) {
                vehicleMap.set(row.id, row);
            }
        }
    }

    return upsells.map((upsell) => {
        const customer = customerMap.get(upsell.customer_id);
        const latestAppt = latestAppointmentByCustomer.get(upsell.customer_id);
        const tier = normalizeCustomerTier(customer?.tier) ?? null;

        const fromLatestAppt = toVehicleSummary({
            year: latestAppt?.vehicle_year ?? null,
            make: latestAppt?.vehicle_make ?? null,
            model: latestAppt?.vehicle_model ?? null,
            trim: latestAppt?.vehicle_trim ?? null,
        });
        const latestVehicle = latestAppt?.vehicle_id ? vehicleMap.get(latestAppt.vehicle_id) : null;
        const directVehicle = upsell.vehicle_id ? vehicleMap.get(upsell.vehicle_id) : null;
        const vehicleSummary =
            fromLatestAppt ??
            toVehicleSummary(latestVehicle ?? {}) ??
            toVehicleSummary(directVehicle ?? {});

        return {
            ...upsell,
            customer_phone: customer?.phone ?? null,
            customer_tier: tier,
            vehicle_summary: vehicleSummary,
        };
    });
}
