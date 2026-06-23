'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { TodaysAppointmentRow } from '@/app/api/appointments/today/route';

// Morning-briefing panel for /dashboard (Phase 9 task 4).
//
// Reads /api/appointments/today and renders a grid of appointment cards
// matched to the dark /service-desk visual language. Each card surfaces:
//   - customer name + loyalty tier + open-call link
//   - vehicle + view-vehicle link
//   - appointment time + service type + advisor
//   - 1-line Aria-context snippet ("Aria booked this on [date] — [excerpt]")
//   - "Upsells to surface" chip when the customer's last call had any
//     flagged upsells (high-value moment to mention them at check-in)

interface ResponseShape {
    label: 'today' | 'tomorrow' | 'upcoming';
    appointments: TodaysAppointmentRow[];
    persistence: 'mock';
}

const TIER_PILL: Record<string, string> = {
    Bronze: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
    Silver: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-200',
    Gold: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    Platinum: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200',
};

function formatBookedAt(iso: string): string {
    try {
        const date = new Date(iso);
        const today = new Date();
        const diffDays = Math.floor((today.getTime() - date.getTime()) / 86_400_000);
        if (diffDays === 0) return 'today';
        if (diffDays === 1) return 'yesterday';
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    } catch {
        return iso;
    }
}

function formatCurrency(value: number | undefined): string {
    if (value === undefined || value === null) return '';
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
}

export function TodaysAppointmentsPanel() {
    const [data, setData] = useState<ResponseShape | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            try {
                const r = await fetch('/api/appointments/today', { cache: 'no-store' });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const payload = (await r.json()) as ResponseShape;
                if (!cancelled) setData(payload);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load appointments');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    const labelText =
        data?.label === 'today'
            ? "Today's appointments"
            : data?.label === 'tomorrow'
            ? "Tomorrow's appointments"
            : 'Next appointments';

    return (
        <section className="mt-10">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.32em] text-red-400">Morning briefing</p>
                    <h3 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">{labelText}</h3>
                </div>
                <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-sky-200">
                    Aria-booked
                </span>
            </div>

            {error && (
                <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-100">{error}</div>
            )}

            {loading && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="h-44 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900" />
                    ))}
                </div>
            )}

            {!loading && data && data.appointments.length === 0 && (
                <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900 px-5 py-8 text-center text-sm text-zinc-400">
                    No upcoming appointments scheduled.
                </div>
            )}

            {!loading && data && data.appointments.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {data.appointments.map((appt) => (
                        <article
                            key={appt.id}
                            className="flex h-full flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 transition hover:border-zinc-600"
                        >
                            <header className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <Link
                                        href={`/customers/${encodeURIComponent(appt.customer.id)}`}
                                        className="block min-w-0 text-base font-black text-white transition hover:text-red-200"
                                    >
                                        {appt.customer.name}
                                    </Link>
                                    {appt.vehicle && (
                                        <Link
                                            href={`/vehicles/${encodeURIComponent(appt.vehicle.id)}`}
                                            className="mt-1 block text-xs text-zinc-400 transition hover:text-zinc-200"
                                        >
                                            {appt.vehicle.year} {appt.vehicle.make} {appt.vehicle.model}
                                            {appt.vehicle.trim ? ` · ${appt.vehicle.trim}` : ''}
                                        </Link>
                                    )}
                                </div>
                                <span
                                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] ${
                                        TIER_PILL[appt.customer.loyalty_tier] ?? TIER_PILL.Bronze
                                    }`}
                                >
                                    {appt.customer.loyalty_tier}
                                </span>
                            </header>

                            <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-100">
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-200">
                                    {appt.time} · {appt.duration_est_hours}h
                                </p>
                                <p className="mt-1 text-sm font-bold text-white">{appt.service_type}</p>
                                <p className="mt-0.5 text-[11px] text-red-200/80">with {appt.advisor_name}</p>
                            </div>

                            {appt.aria_context && (
                                <p className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-300">
                                    <span className="font-bold text-zinc-100">Aria booked this {formatBookedAt(appt.aria_context.booked_at)}</span>
                                    {appt.aria_context.excerpt ? ` — ${appt.aria_context.excerpt}` : ''}
                                </p>
                            )}

                            {appt.upsells_to_surface.length > 0 && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">
                                        Upsells to surface
                                    </span>
                                    {appt.upsells_to_surface.slice(0, 2).map((u, idx) => (
                                        <span
                                            key={`${appt.id}-upsell-${idx}`}
                                            className="rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[10px] text-amber-100"
                                            title={u.description ?? u.type}
                                        >
                                            {u.description ?? u.type.replace(/_/g, ' ')}
                                            {u.value_est ? ` · ${formatCurrency(u.value_est)}` : ''}
                                        </span>
                                    ))}
                                    {appt.upsells_to_surface.length > 2 && (
                                        <span className="text-[10px] uppercase tracking-[0.18em] text-amber-200/70">
                                            +{appt.upsells_to_surface.length - 2}
                                        </span>
                                    )}
                                </div>
                            )}

                            {appt.notes && (
                                <p className="mt-auto text-[11px] text-zinc-500">{appt.notes}</p>
                            )}
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
