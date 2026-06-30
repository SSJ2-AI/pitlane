// ─── PitLane Phase 14: upsell ➜ customer-context enrichment helper ──────────
//
// Aria flags upsells per-call and persists them to `public.upsells` with a
// dealer_id + customer_id + vehicle_id. The /service-desk, /group, and
// /calls dashboards list pending upsells across customers — and historically
// rendered nothing but the upsell description + estimated value. Advisors
// and managers had no idea WHO the upsell was for without clicking through
// to /customers/[id].
//
// This module bolts a compact customer-context bar onto every UpsellRow we
// surface in a list view. The enrichment is intentionally one-way:
//
//   UpsellRow  ──▶  UpsellWithContext  (UpsellRow + customer_phone,
//                                       customer_tier, vehicle_summary,
//                                       customer_name)
//
// PII boundary: customer_phone is technically PII but is already exposed
// on /service-desk's callback queue and is necessary for advisors to
// recognise the caller. We do NOT include email or address. Tier comes
// from MOCK_CUSTOMERS today (the public.customers table dropped name /
// tier in migration 0012's PIPEDA minimisation); when CDK pull lands we
// will rehydrate tier from the CDK loyalty payload at request time.
//
// The Supabase path joins `customers` for phone only (the column that
// survives 0012's minimisation) and falls back to the mock dataset by
// customer_id for tier + vehicle. Vehicle summary prefers the most
// recent appointment's vehicle_id ➜ MOCK_VEHICLES lookup, then falls
// back to the upsell row's own vehicle_id.
//
// The /customers/[customerId] CustomerUpsellsPanel deliberately does NOT
// consume this helper — that surface is already scoped to one customer
// and showing the same bar there would be redundant noise.

import type { UpsellRow, AppointmentRow } from './supabase';
import { MOCK_CUSTOMERS, type LoyaltyTier } from './mock-customers';
import { MOCK_VEHICLES, type MockVehicle } from './mock-vehicles';

/**
 * Narrow shim around the supabase-js client surface we actually call here.
 * Kept loose on purpose — the rest of the codebase uses `@ts-nocheck` to
 * dodge supabase-js's chainable-query type-depth issue and we follow the
 * same convention without falling back to `any`.
 */
// supabase-js chainable surface is intentionally untyped here — see the
// @ts-nocheck rationale in src/app/api/calls/route.ts and friends. We
// only call .from / .select / .in / .eq, none of which are type-checked
// at this seam.
interface SupabaseLike {
    from: (table: string) => unknown;
}

export interface UpsellWithContext extends UpsellRow {
    customer_phone: string | null;
    customer_tier: LoyaltyTier | null;
    customer_name: string | null;
    vehicle_summary: string | null;
}

function vehicleSummaryFromMock(vehicleId: string | null | undefined): string | null {
    if (!vehicleId) return null;
    const v = MOCK_VEHICLES.find((x) => x.id === vehicleId);
    return vehicleSummaryFromVehicle(v ?? null);
}

function vehicleSummaryFromVehicle(v: MockVehicle | null): string | null {
    if (!v) return null;
    const trim = v.trim ? ` ${v.trim}` : '';
    return `${v.year} ${v.make} ${v.model}${trim}`.trim();
}

/**
 * Pull the most recent vehicle the customer has on the books — preference
 * order:
 *   1. The vehicle_id stamped on the upsell itself (Aria knows what she
 *      was talking about), looked up in MOCK_VEHICLES.
 *   2. The vehicle_id on the customer's most recent appointment in the
 *      provided appointments slice (used by the Supabase enrich path).
 *   3. The first MOCK_VEHICLES row owned by the customer.
 */
function bestVehicleSummary(
    upsell: UpsellRow,
    recentAppts?: AppointmentRow[],
): string | null {
    const fromUpsell = vehicleSummaryFromMock(upsell.vehicle_id);
    if (fromUpsell) return fromUpsell;

    if (recentAppts && recentAppts.length > 0) {
        const mostRecent = [...recentAppts]
            .filter((a) => a.customer_id === upsell.customer_id && a.vehicle_id)
            .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
        if (mostRecent) {
            const fromAppt = vehicleSummaryFromMock(mostRecent.vehicle_id);
            if (fromAppt) return fromAppt;
        }
    }

    const owned = MOCK_VEHICLES.find((v) => v.customer_id === upsell.customer_id);
    return vehicleSummaryFromVehicle(owned ?? null);
}

/**
 * Mock-data enrichment — used by the service-desk + group summary endpoints
 * when NEXT_PUBLIC_USE_MOCK_DATA is set or Supabase isn't configured.
 */
export function enrichUpsellsFromMocks(upsells: UpsellRow[]): UpsellWithContext[] {
    return upsells.map((u) => {
        const customer = MOCK_CUSTOMERS.find((c) => c.id === u.customer_id) ?? null;
        return {
            ...u,
            customer_phone: customer?.phone ?? null,
            customer_tier: customer?.loyaltyTier ?? null,
            customer_name: customer ? `${customer.firstName} ${customer.lastName}` : null,
            vehicle_summary: bestVehicleSummary(u),
        };
    });
}

/**
 * Supabase enrichment — fetches phone from public.customers for each
 * distinct customer_id on the upsell list, then merges. Tier + vehicle
 * summary fall back to the mock dataset by customer_id since neither
 * column survives PIPEDA minimisation and we don't have a vehicles table
 * yet. When the optional `appointments` slice is provided we use it to
 * pick the most recent vehicle per customer; otherwise we fall back to
 * MOCK_VEHICLES.
 *
 * `supabase` is intentionally untyped (`any`) to dodge the chainable
 * select type-depth issue that already forces @ts-nocheck on several
 * /api routes in this codebase.
 */
export async function enrichUpsellsFromSupabase(
    supabase: SupabaseLike,
    upsells: UpsellRow[],
    options: { appointments?: AppointmentRow[] } = {},
): Promise<UpsellWithContext[]> {
    if (upsells.length === 0) return [];

    const customerIds = Array.from(
        new Set(upsells.map((u) => u.customer_id).filter((id): id is string => !!id)),
    );

    // The supabase-js chainable returns `any` once we leave the typed
    // helpers — cast through `unknown` here so the rest of the function
    // can stay typed without enabling no-explicit-any.
    const db = supabase as unknown as {
        from: (table: string) => {
            select: (cols: string) => {
                in: (col: string, vals: string[]) => Promise<{ data: unknown; error: { message: string } | null }>;
                order: (col: string, opts: { ascending: boolean }) => {
                    limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }>;
                };
            };
        };
    };

    const phoneById = new Map<string, string>();
    if (customerIds.length > 0) {
        try {
            const { data, error } = await db
                .from('customers')
                .select('id,phone')
                .in('id', customerIds);
            if (error) {
                console.error('[upsell-context] customers join failed:', error.message);
            } else {
                for (const row of (data ?? []) as Array<{ id: string; phone: string | null }>) {
                    if (row?.id && row.phone) phoneById.set(row.id, row.phone);
                }
            }
        } catch (err) {
            console.error('[upsell-context] customers join threw:',
                err instanceof Error ? err.message : err);
        }
    }

    // If the caller did not provide an appointments slice, try to pull
    // the latest appointment per customer ourselves — best-effort, and
    // safe to fail silently (we fall back to MOCK_VEHICLES below).
    let appts = options.appointments;
    if (!appts && customerIds.length > 0) {
        try {
            const { data, error } = await db
                .from('appointments')
                .select('*')
                .in('customer_id', customerIds);
            if (error) {
                console.error('[upsell-context] appointments join failed:', error.message);
            } else {
                appts = (data ?? []) as AppointmentRow[];
            }
        } catch (err) {
            console.error('[upsell-context] appointments join threw:',
                err instanceof Error ? err.message : err);
        }
    }

    return upsells.map((u) => {
        const mock = MOCK_CUSTOMERS.find((c) => c.id === u.customer_id) ?? null;
        const phone = phoneById.get(u.customer_id) ?? mock?.phone ?? null;
        return {
            ...u,
            customer_phone: phone,
            customer_tier: mock?.loyaltyTier ?? null,
            customer_name: mock ? `${mock.firstName} ${mock.lastName}` : null,
            vehicle_summary: bestVehicleSummary(u, appts),
        };
    });
}
