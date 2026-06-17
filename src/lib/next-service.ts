import type { MockRepairOrder, MockVehicle } from './mock-vehicles'

// ─── Next-service prediction ─────────────────────────────────────────────────
//
// Simple rule per spec: oil change every 8,000 km OR 6 months, whichever
// comes first. The math is intentionally transparent (no ML, no per-model
// service intervals) so a service advisor can sanity-check the number at a
// glance.
//
// Inputs:
//   - currentMileage     — most recent odometer reading we have for the car
//   - lastOilChangeDate  — when the last engine-oil service happened
//   - lastOilChangeMiles — odometer reading at that visit
//
// We pick whichever threshold (mileage OR date) is closer to "due" and
// surface progress through that interval as a 0–100 % bar.

export const OIL_CHANGE_INTERVAL_KM = 8_000
export const OIL_CHANGE_INTERVAL_DAYS = 182 // ≈ 6 months

export type NextServiceTrigger = 'mileage' | 'date' | 'unknown'

export interface NextServicePrediction {
    next_service_type: string
    /** Odometer reading at which the next service is due. */
    due_at_km: number | null
    /** Date by which the next service is due (ISO YYYY-MM-DD). */
    due_at_date: string | null
    /** Positive = still in the future. Negative = overdue. */
    km_remaining: number | null
    /** Positive = still in the future. Negative = overdue. */
    days_remaining: number | null
    /** 0 = just serviced, 100 = at-due, >100 = overdue. */
    progress_pct: number
    /** Which threshold is the binding one (closer to due). */
    trigger: NextServiceTrigger
    /** Why the prediction is what it is — surfaced in the UI as a tooltip. */
    explanation: string
}

interface PredictInput {
    currentMileage: number
    lastOilChangeDate: string | null
    lastOilChangeMileage: number | null
    /** Override "today" for unit tests / deterministic snapshots. */
    today?: Date
}

function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
    const next = new Date(date)
    next.setDate(next.getDate() + days)
    return next
}

function clampPct(value: number): number {
    if (Number.isNaN(value)) return 0
    if (value < 0) return 0
    if (value > 150) return 150 // cap "overdue by miles" runaway
    return Math.round(value)
}

export function predictNextOilChange(input: PredictInput): NextServicePrediction {
    const today = startOfDay(input.today ?? new Date())

    // Unknown-history path: we don't know when the last oil change was.
    // Recommend conservatively that it's due "now" so the advisor takes a
    // look. Better than silently hiding the card.
    if (!input.lastOilChangeDate || input.lastOilChangeMileage == null) {
        return {
            next_service_type: 'Engine Oil + Filter',
            due_at_km: null,
            due_at_date: null,
            km_remaining: null,
            days_remaining: null,
            progress_pct: 100,
            trigger: 'unknown',
            explanation:
                'No oil-change history on file for this vehicle. Recommend a customer-confirmation call before the next visit.',
        }
    }

    const lastDate = startOfDay(new Date(input.lastOilChangeDate))
    const dueAtDate = addDays(lastDate, OIL_CHANGE_INTERVAL_DAYS)
    const dueAtKm = input.lastOilChangeMileage + OIL_CHANGE_INTERVAL_KM

    const daysSince = Math.floor((today.getTime() - lastDate.getTime()) / 86_400_000)
    const kmSince = Math.max(0, input.currentMileage - input.lastOilChangeMileage)

    const daysRemaining = OIL_CHANGE_INTERVAL_DAYS - daysSince
    const kmRemaining = OIL_CHANGE_INTERVAL_KM - kmSince

    const dateProgressPct = (daysSince / OIL_CHANGE_INTERVAL_DAYS) * 100
    const mileageProgressPct = (kmSince / OIL_CHANGE_INTERVAL_KM) * 100

    // "Closer to due" = whichever interval has higher progress through it.
    const trigger: NextServiceTrigger = mileageProgressPct >= dateProgressPct ? 'mileage' : 'date'

    const bindingPct = Math.max(mileageProgressPct, dateProgressPct)
    const progress_pct = clampPct(bindingPct)

    const explanation =
        trigger === 'mileage'
            ? `Last oil change at ${input.lastOilChangeMileage.toLocaleString('en-CA')} km on ${input.lastOilChangeDate}. ${OIL_CHANGE_INTERVAL_KM.toLocaleString('en-CA')} km / 6 mo interval — mileage is the binding factor.`
            : `Last oil change ${daysSince} days ago at ${input.lastOilChangeMileage.toLocaleString('en-CA')} km. Calendar 6-month interval is the binding factor.`

    return {
        next_service_type: 'Engine Oil + Filter',
        due_at_km: dueAtKm,
        due_at_date: isoDate(dueAtDate),
        km_remaining: kmRemaining,
        days_remaining: daysRemaining,
        progress_pct,
        trigger,
        explanation,
    }
}

/**
 * Convenience wrapper that pulls the inputs from a vehicle + its RO history.
 * Finds the most recent oil_change_mileage in the RO list; if none exists
 * (e.g. EVs that don't take oil), falls back to the unknown-history path.
 */
export function predictNextServiceForVehicle(
    vehicle: MockVehicle,
    repairOrders: MockRepairOrder[],
    today?: Date,
): NextServicePrediction {
    // EVs don't take engine oil — predict an inspection-interval check
    // instead. Heuristic: model name contains 'Taycan' or 'e-tron' →
    // electric. (Phase 6 will get this from CDK powertrain code.)
    const isEv = /taycan|e-tron|macan electric/i.test(vehicle.model)

    const oilRO = repairOrders
        .filter((ro) => typeof ro.oil_change_mileage === 'number')
        .sort((a, b) => (a.date < b.date ? 1 : -1))[0]

    if (isEv) {
        const lastService = repairOrders
            .filter((ro) => ro.status === 'completed')
            .sort((a, b) => (a.date < b.date ? 1 : -1))[0]
        const prediction = predictNextOilChange({
            currentMileage: vehicle.mileage,
            lastOilChangeDate: lastService?.date ?? null,
            lastOilChangeMileage: lastService?.mileage_at_service ?? null,
            today,
        })
        return {
            ...prediction,
            next_service_type: 'Annual Inspection',
            explanation:
                `${vehicle.year} ${vehicle.make} ${vehicle.model} is electric — no engine oil service required. ` +
                `Displaying the annual-inspection interval instead.`,
        }
    }

    return predictNextOilChange({
        currentMileage: vehicle.mileage,
        lastOilChangeDate: oilRO?.date ?? null,
        lastOilChangeMileage: oilRO?.oil_change_mileage ?? null,
        today,
    })
}
