import type { SupabaseClient } from '@supabase/supabase-js';
import type { UpsellRow } from './supabase';

export interface UpsellCustomerContext {
    customer_phone: string | null;
    customer_tier: string | null;
    vehicle_summary: string | null;
}

export type UpsellWithCustomerContext = UpsellRow & UpsellCustomerContext;

interface CustomerContextRow {
    id: string;
    phone: string | null;
    tier?: string | null;
}

interface AppointmentVehicleRow {
    customer_id: string;
    vehicle_year?: number | string | null;
    vehicle_make?: string | null;
    vehicle_model?: string | null;
    date?: string | null;
    time?: string | null;
    created_at?: string | null;
}

function uniqueCustomerIds(upsells: UpsellRow[]): string[] {
    return Array.from(new Set(upsells.map((u) => u.customer_id).filter(Boolean)));
}

function formatVehicleSummary(row: AppointmentVehicleRow | undefined): string | null {
    if (!row) return null;
    const parts = [row.vehicle_year, row.vehicle_make, row.vehicle_model]
        .map((value) => (value === null || value === undefined ? '' : String(value).trim()))
        .filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : null;
}

export async function enrichUpsellsWithCustomerContext(
    supabase: SupabaseClient,
    upsells: UpsellRow[],
    logPrefix: string,
): Promise<UpsellWithCustomerContext[]> {
    if (upsells.length === 0) return [];

    const customerIds = uniqueCustomerIds(upsells);
    if (customerIds.length === 0) {
        return upsells.map((u) => ({ ...u, customer_phone: null, customer_tier: null, vehicle_summary: null }));
    }

    const [customersRes, appointmentsRes] = await Promise.all([
        supabase
            .from('customers')
            .select('id,phone,tier')
            .in('id', customerIds),
        supabase
            .from('appointments')
            .select('customer_id,vehicle_year,vehicle_make,vehicle_model,date,time,created_at')
            .in('customer_id', customerIds)
            .order('date', { ascending: false, nullsFirst: false })
            .order('time', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false, nullsFirst: false })
            .limit(500),
    ]);

    if (customersRes.error) console.error(`${logPrefix} customers:`, customersRes.error.message);
    if (appointmentsRes.error) console.error(`${logPrefix} appointments:`, appointmentsRes.error.message);

    const customersById = new Map<string, CustomerContextRow>();
    for (const customer of (customersRes.data ?? []) as CustomerContextRow[]) {
        customersById.set(customer.id, customer);
    }

    const latestAppointmentByCustomer = new Map<string, AppointmentVehicleRow>();
    for (const appointment of (appointmentsRes.data ?? []) as AppointmentVehicleRow[]) {
        if (!latestAppointmentByCustomer.has(appointment.customer_id)) {
            latestAppointmentByCustomer.set(appointment.customer_id, appointment);
        }
    }

    return upsells.map((u) => {
        const customer = customersById.get(u.customer_id);
        return {
            ...u,
            customer_phone: customer?.phone ?? null,
            customer_tier: customer?.tier ?? null,
            vehicle_summary: formatVehicleSummary(latestAppointmentByCustomer.get(u.customer_id)),
        };
    });
}
