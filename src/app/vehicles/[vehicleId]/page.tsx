'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { MockRecall, MockRepairOrder, MockVehicle, VehicleSource } from '@/lib/mock-vehicles';
import type { NextServicePrediction } from '@/lib/next-service';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';

interface VehicleResponse {
    vehicle: MockVehicle;
    repair_orders: MockRepairOrder[];
    recalls: MockRecall[];
    next_service: NextServicePrediction | null;
    source: VehicleSource;
    dealer: { id: string; name: string };
    persistence: 'supabase' | 'mock';
}

const RO_STATUS_STYLES: Record<MockRepairOrder['status'], string> = {
    open: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    in_progress: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    awaiting_parts: 'border-red-500/40 bg-red-500/10 text-red-200',
    completed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
};

const RO_STATUS_LABEL: Record<MockRepairOrder['status'], string> = {
    open: 'Open',
    in_progress: 'In progress',
    awaiting_parts: 'Awaiting parts',
    completed: 'Completed',
};

function formatNumber(value: number | null | undefined) {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('en-CA').format(value);
}

function formatCurrency(value: number | null | undefined) {
    if (value === null || value === undefined) return null;
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
}

function formatDate(iso: string) {
    try {
        const date = new Date(iso);
        return date.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return iso;
    }
}

function vinTail(vin: string) {
    return vin.slice(-8);
}

function progressBarColor(pct: number) {
    if (pct >= 100) return 'bg-red-600';
    if (pct >= 75) return 'bg-amber-500';
    return 'bg-emerald-500';
}

function progressBadge(prediction: NextServicePrediction) {
    if (prediction.trigger === 'unknown') {
        return { label: 'Unknown history', className: 'border-zinc-700 bg-zinc-950 text-zinc-300' };
    }
    if (prediction.progress_pct >= 100) {
        return { label: 'Due now', className: 'border-red-500/40 bg-red-500/10 text-red-200' };
    }
    if (prediction.progress_pct >= 75) {
        return { label: 'Due soon', className: 'border-amber-500/40 bg-amber-500/10 text-amber-200' };
    }
    return { label: 'On schedule', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' };
}

export default function VehicleDetailPage() {
    const params = useParams<{ vehicleId: string }>();
    const vehicleId = Array.isArray(params?.vehicleId) ? params.vehicleId[0] : params?.vehicleId ?? '';

    const [data, setData] = useState<VehicleResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!vehicleId) return;
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/vehicles/${encodeURIComponent(vehicleId)}`, { cache: 'no-store' });
            const payload = (await response.json()) as VehicleResponse | { error?: string };
            if (!response.ok) {
                setError((payload as { error?: string }).error ?? `HTTP ${response.status}`);
                setData(null);
                return;
            }
            setData(payload as VehicleResponse);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load vehicle');
        } finally {
            setLoading(false);
        }
    }, [vehicleId]);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100 shadow-lg shadow-red-950/30">PL</div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Vehicle detail</p>
                        </div>
                    </Link>
                    <nav className="flex flex-wrap items-center gap-3">
                        <VoiceStatusDot />
                        <Link href="/dashboard" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Dashboard</Link>
                        <Link href="/calls" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Calls</Link>
                        <Link href="/customers" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Customers</Link>
                        <Link href="/analytics" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Analytics</Link>
                        <Link href="/service-desk" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Service desk</Link>
                        <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200">Vehicle</span>
                    </nav>
                </div>
            </header>

            <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
                {loading && !data && (
                    <div className="rounded-3xl border border-dashed border-zinc-800 bg-zinc-900 px-6 py-12 text-center text-sm text-zinc-400">
                        Loading vehicle…
                    </div>
                )}

                {error && (
                    <div className="rounded-3xl border border-red-500/40 bg-red-500/10 px-6 py-8 text-sm text-red-100">
                        <p className="font-bold">Could not load vehicle {vehicleId}</p>
                        <p className="mt-2">{error}</p>
                        <Link href="/calls" className="mt-4 inline-block text-xs font-bold uppercase tracking-[0.22em] text-red-300 hover:text-red-200">← Back to calls</Link>
                    </div>
                )}

                {data && (
                    <>
                        <VehicleHeaderCard data={data} />

                        <div className="mt-6 grid gap-6 lg:grid-cols-2">
                            <NextServiceCard prediction={data.next_service} mileage={data.vehicle.mileage} />
                            <RecallsCard recalls={data.recalls} />
                        </div>

                        <div className="mt-6">
                            <ServiceHistoryTimeline orders={data.repair_orders} persistence={data.persistence} />
                        </div>
                    </>
                )}
            </section>
        </main>
    );
}

// ─── Vehicle header card ─────────────────────────────────────────────────────

function VehicleHeaderCard({ data }: { data: VehicleResponse }) {
    const v = data.vehicle;
    const title = [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
    const sourceLabel =
        data.source === 'fortellis'
            ? 'Live CDK'
            : data.source === 'supabase'
            ? 'Live Supabase'
            : 'Mock';
    const sourceStyle =
        data.source === 'fortellis'
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
            : 'border-zinc-700 bg-zinc-950 text-zinc-300';

    return (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl shadow-black/25">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Vehicle</p>
                    <h2 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">{title}</h2>
                    <p className="mt-2 text-sm text-zinc-400">
                        Owned by{' '}
                        <Link
                            href={`/calls?customer_id=${encodeURIComponent(v.customer_id)}`}
                            className="font-bold text-red-300 transition hover:text-red-200"
                        >
                            {v.customer_name}
                        </Link>
                    </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${sourceStyle}`}>
                        {sourceLabel}
                    </span>
                    {data.persistence === 'supabase' && (
                        <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-sky-200">
                            History from Supabase
                        </span>
                    )}
                </div>
            </div>

            <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="VIN" value={vinTail(v.vin)} title={v.vin} />
                <Stat label="Mileage" value={`${formatNumber(v.mileage)} km`} />
                <Stat label="Color" value={v.color ?? '—'} />
                <Stat label="License plate" value={v.license_plate ?? '—'} />
            </dl>
        </section>
    );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
    return (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4" title={title}>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">{label}</p>
            <p className="mt-2 break-words text-base font-bold text-zinc-100">{value}</p>
        </div>
    );
}

// ─── Next service prediction card ────────────────────────────────────────────

function NextServiceCard({ prediction, mileage }: { prediction: NextServicePrediction | null; mileage: number }) {
    if (!prediction) return null;

    const badge = progressBadge(prediction);
    const barColor = progressBarColor(prediction.progress_pct);
    const cappedWidth = Math.min(prediction.progress_pct, 100);

    return (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
            <header className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Next service</p>
                    <h3 className="mt-2 text-xl font-black text-white">{prediction.next_service_type}</h3>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${badge.className}`}>
                    {badge.label}
                </span>
            </header>

            <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-zinc-950">
                <div
                    className={`h-full transition-all ${barColor}`}
                    style={{ width: `${cappedWidth}%` }}
                />
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                    <dt className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Due in</dt>
                    <dd className="mt-1 text-lg font-black text-white">
                        {prediction.km_remaining !== null
                            ? prediction.km_remaining >= 0
                                ? `${formatNumber(prediction.km_remaining)} km`
                                : `${formatNumber(Math.abs(prediction.km_remaining))} km overdue`
                            : '—'}
                    </dd>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                    <dt className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">or</dt>
                    <dd className="mt-1 text-lg font-black text-white">
                        {prediction.days_remaining !== null
                            ? prediction.days_remaining >= 0
                                ? `${prediction.days_remaining} days`
                                : `${Math.abs(prediction.days_remaining)} days overdue`
                            : '—'}
                    </dd>
                </div>
                <div className="col-span-2 rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                    <dt className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Current mileage</dt>
                    <dd className="mt-1 text-lg font-black text-white">{formatNumber(mileage)} km</dd>
                </div>
            </dl>

            <p className="mt-4 text-[11px] leading-5 text-zinc-500">{prediction.explanation}</p>
        </section>
    );
}

// ─── Open recalls card ───────────────────────────────────────────────────────

function RecallsCard({ recalls }: { recalls: MockRecall[] }) {
    return (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
            <header className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Open recalls</p>
                    <h3 className="mt-2 text-xl font-black text-white">
                        {recalls.length === 0
                            ? 'None on file'
                            : `${recalls.length} active campaign${recalls.length === 1 ? '' : 's'}`}
                    </h3>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${
                    recalls.length === 0
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                        : 'border-red-500/40 bg-red-500/10 text-red-200'
                }`}>
                    {recalls.length === 0 ? 'Clear' : 'Action needed'}
                </span>
            </header>

            {recalls.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-6 text-center text-sm text-zinc-400">
                    No open recall campaigns for this VIN.
                </p>
            ) : (
                <ul className="mt-4 space-y-3">
                    {recalls.map((recall) => (
                        <li key={recall.nhtsa_id} className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-red-300">{recall.campaign}</p>
                                    <p className="mt-1 text-sm font-black text-white">{recall.component}</p>
                                </div>
                                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${
                                    recall.remedy_available
                                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                                        : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                                }`}>
                                    {recall.remedy_available ? 'Remedy available' : 'Remedy pending'}
                                </span>
                            </div>
                            <p className="mt-3 text-xs leading-5 text-red-100/90">
                                <span className="font-bold text-red-200">Consequence: </span>
                                {recall.consequence}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-zinc-300">
                                <span className="font-bold text-zinc-200">Remedy: </span>
                                {recall.remedy}
                            </p>
                            <p className="mt-2 text-[10px] uppercase tracking-[0.22em] text-zinc-500">Issued {formatDate(recall.issued)}</p>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

// ─── Service history timeline ────────────────────────────────────────────────

function ServiceHistoryTimeline({
    orders,
    persistence,
}: {
    orders: MockRepairOrder[];
    persistence: 'supabase' | 'mock';
}) {
    return (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
            <header className="flex items-end justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Service history</p>
                    <h3 className="mt-2 text-xl font-black text-white">
                        Last {orders.length} repair order{orders.length === 1 ? '' : 's'}
                    </h3>
                </div>
                <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">
                    {persistence === 'supabase' ? 'From Supabase' : 'From mock'}
                </span>
            </header>

            {orders.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-8 text-center text-sm text-zinc-400">
                    No repair orders on file for this vehicle yet.
                </p>
            ) : (
                <ol className="mt-6 relative space-y-6 before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-px before:bg-zinc-800">
                    {orders.map((ro) => (
                        <li key={ro.ro_number} className="relative pl-10">
                            <span className="absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                {ro.status === 'completed' ? '✓' : ro.status === 'awaiting_parts' ? '!' : '•'}
                            </span>

                            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">{formatDate(ro.date)}</p>
                                        <p className="mt-1 text-sm font-black text-white">{ro.service_type}</p>
                                        <p className="mt-1 text-xs text-zinc-400">
                                            {ro.ro_number}
                                            {ro.advisor_name ? ` · ${ro.advisor_name}` : ''}
                                            {typeof ro.mileage_at_service === 'number'
                                                ? ` · ${formatNumber(ro.mileage_at_service)} km`
                                                : ''}
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${RO_STATUS_STYLES[ro.status]}`}>
                                            {RO_STATUS_LABEL[ro.status]}
                                        </span>
                                        {typeof ro.total_cost === 'number' && ro.total_cost > 0 && (
                                            <span className="text-xs font-bold text-emerald-300">{formatCurrency(ro.total_cost)}</span>
                                        )}
                                    </div>
                                </div>
                                <p className="mt-3 text-xs leading-5 text-zinc-300">{ro.summary}</p>
                            </div>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}
