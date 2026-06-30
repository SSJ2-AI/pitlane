'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { AppointmentRow, CallbackRequestRow, LoanerRequestRow } from '@/lib/supabase';
import type { UpsellWithCustomerContext } from '@/lib/upsell-context';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import { UpsellCustomerContextBar } from '@/components/UpsellCustomerContextBar';

const CALLBACK_SENTIMENT_STYLES: Record<string, string> = {
    positive: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    neutral: 'border-zinc-700 bg-zinc-950 text-zinc-300',
    negative: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    frustrated: 'border-red-500/50 bg-red-500/15 text-red-200',
};

const CALLBACK_STATUS_STYLES: Record<string, string> = {
    pending: 'border-red-500/40 bg-red-500/10 text-red-200',
    acknowledged: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    completed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    cancelled: 'border-zinc-700 bg-zinc-950 text-zinc-300',
};

const UPSELL_STATUS_STYLES: Record<string, string> = {
    pending: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    accepted: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    declined: 'border-zinc-700 bg-zinc-950 text-zinc-300',
    expired: 'border-red-500/40 bg-red-500/10 text-red-200',
};

interface SummaryResponse {
    persistence: 'supabase' | 'none';
    today: string;
    arrivals: AppointmentRow[];
    loaner_queue: LoanerRequestRow[];
    upsells: UpsellWithCustomerContext[];
    stats: {
        arrivals_count: number;
        loaner_pending: number;
        upsell_count: number;
        upsell_value: number;
    };
}

const REFRESH_INTERVAL_MS = 15_000;

function formatCurrency(value: number | null | undefined) {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
}

function formatRelative(iso: string) {
    try {
        const diff = (Date.now() - new Date(iso).getTime()) / 1000;
        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
        return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    } catch {
        return iso;
    }
}

const APPT_STATUS_STYLES: Record<string, string> = {
    confirmed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    scheduled: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    cancelled: 'border-zinc-700 bg-zinc-950 text-zinc-300',
    completed: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
};

export default function ServiceDeskPage() {
    const [data, setData] = useState<SummaryResponse | null>(null);
    const [callbacks, setCallbacks] = useState<CallbackRequestRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionFor, setActionFor] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const [summaryRes, callbackRes] = await Promise.all([
                fetch('/api/service-desk/summary', { cache: 'no-store' }),
                fetch('/api/callbacks?status=pending,acknowledged', { cache: 'no-store' }),
            ]);
            if (!summaryRes.ok) {
                setError(`HTTP ${summaryRes.status}`);
                return;
            }
            const payload = (await summaryRes.json()) as SummaryResponse;
            setData(payload);
            if (callbackRes.ok) {
                const cbPayload = (await callbackRes.json()) as { callbacks?: CallbackRequestRow[] };
                setCallbacks(cbPayload.callbacks ?? []);
            }
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load service desk');
        } finally {
            setLoading(false);
        }
    }, []);

    async function patchCallback(id: string, status: 'acknowledged' | 'completed') {
        setActionFor(id);
        try {
            const r = await fetch(`/api/callbacks/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, assigned_advisor_id: 'service_desk' }),
            });
            if (!r.ok) {
                const b = await r.json().catch(() => ({}));
                throw new Error(typeof b?.error === 'string' ? b.error : `HTTP ${r.status}`);
            }
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update callback');
        } finally {
            setActionFor(null);
        }
    }

    function formatElapsed(iso: string): string {
        try {
            const diffSecs = (Date.now() - new Date(iso).getTime()) / 1000;
            if (diffSecs < 60) return 'just now';
            if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
            if (diffSecs < 86_400) return `${Math.floor(diffSecs / 3600)}h ago`;
            return `${Math.floor(diffSecs / 86_400)}d ago`;
        } catch {
            return iso;
        }
    }

    useEffect(() => {
        void load();
        const interval = setInterval(load, REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [load]);

    async function patchLoaner(id: string, status: 'approved' | 'declined') {
        setActionFor(id);
        try {
            const response = await fetch(`/api/loaner-requests/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, resolved_by: 'service_desk' }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`);
            }
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update loaner request');
        } finally {
            setActionFor(null);
        }
    }

    async function patchUpsell(id: string, status: 'accepted' | 'declined') {
        setActionFor(id);
        try {
            const response = await fetch(`/api/upsells/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`);
            }
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update upsell');
        } finally {
            setActionFor(null);
        }
    }

    const stats = data?.stats;

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100 shadow-lg shadow-red-950/30">PL</div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Service desk</p>
                        </div>
                    </Link>
                    <nav className="flex flex-wrap items-center gap-3">
                        <VoiceStatusDot />
                        <Link href="/dashboard" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Dashboard</Link>
                        <Link href="/calls" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Calls</Link>
                        <Link href="/customers" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Customers</Link>
                        <Link href="/analytics" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Analytics</Link>
                        <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200">Service desk</span>
                    </nav>
                </div>
            </header>

            <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
                <div className="mb-6 flex flex-col gap-2">
                    <p className="text-sm font-semibold uppercase tracking-[0.4em] text-red-400">Live operations queue</p>
                    <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Today on the floor.</h2>
                    <p className="max-w-3xl text-base leading-7 text-zinc-400">
                        Everything Aria booked, flagged, or queued for the team. Refreshes every {Math.round(REFRESH_INTERVAL_MS / 1000)}s.
                        Loaner approvals and upsell closures write straight back to Supabase.
                    </p>
                </div>

                <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard label="Today" value={data ? data.today : '—'} />
                    <StatCard label="Arrivals today" value={stats ? String(stats.arrivals_count) : '—'} />
                    <StatCard label="Loaner queue" value={stats ? String(stats.loaner_pending) : '—'} accent={stats && stats.loaner_pending > 0 ? 'red' : undefined} />
                    <StatCard label="Upsell pipeline" value={stats ? formatCurrency(stats.upsell_value) : '—'} accent="emerald" />
                </div>

                {data?.persistence === 'none' && (
                    <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-100">
                        Supabase is not configured — the service desk panels will populate once <code className="rounded bg-amber-500/20 px-1.5">SUPABASE_URL</code> + <code className="rounded bg-amber-500/20 px-1.5">SUPABASE_SERVICE_ROLE_KEY</code> are set and the migration is applied.
                    </div>
                )}
                {error && <div className="mb-6 rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-100">{error}</div>}

                {callbacks.length > 0 && (
                    <section className="mb-6 rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                        <header className="mb-4 flex items-end justify-between">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Callback queue</p>
                                <h3 className="mt-2 text-xl font-black text-white">Caller asks for a human</h3>
                                <p className="mt-1 text-xs text-zinc-500">Sorted by sentiment — frustrated first, then oldest.</p>
                            </div>
                            <span className="rounded-full border border-red-500/40 bg-red-600/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-red-200">
                                {callbacks.filter((c) => c.status === 'pending').length} pending
                            </span>
                        </header>
                        <ul className="grid gap-3 lg:grid-cols-2">
                            {callbacks.map((cb) => {
                                const sentimentCls = CALLBACK_SENTIMENT_STYLES[cb.sentiment ?? 'neutral'] ?? CALLBACK_SENTIMENT_STYLES.neutral;
                                const statusCls = CALLBACK_STATUS_STYLES[cb.status] ?? CALLBACK_STATUS_STYLES.pending;
                                return (
                                    <li key={cb.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-sm font-black text-white">{cb.customer_name ?? cb.customer_phone}</p>
                                                <p className="text-xs text-zinc-400">{cb.customer_phone}</p>
                                                {cb.reason && <p className="mt-2 text-xs leading-5 text-zinc-300">{cb.reason}</p>}
                                            </div>
                                            <div className="flex flex-col items-end gap-1">
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${sentimentCls}`}>
                                                    {cb.sentiment ?? 'neutral'}
                                                </span>
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${statusCls}`}>
                                                    {cb.status}
                                                </span>
                                                <span className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">{formatElapsed(cb.created_at)}</span>
                                            </div>
                                        </div>
                                        <div className="mt-3 flex gap-2">
                                            {cb.status === 'pending' && (
                                                <button
                                                    type="button"
                                                    disabled={actionFor === cb.id}
                                                    onClick={() => void patchCallback(cb.id, 'acknowledged')}
                                                    className="flex-1 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-amber-200 transition hover:border-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                                                >
                                                    Acknowledge
                                                </button>
                                            )}
                                            {cb.status !== 'completed' && (
                                                <button
                                                    type="button"
                                                    disabled={actionFor === cb.id}
                                                    onClick={() => void patchCallback(cb.id, 'completed')}
                                                    className="flex-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                                                >
                                                    Mark complete
                                                </button>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                )}

                <div className="grid gap-6 lg:grid-cols-2">
                    <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                        <header className="mb-4 flex items-end justify-between">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Arrivals · {data?.today ?? '...'}</p>
                                <h3 className="mt-2 text-xl font-black text-white">Today&apos;s appointments</h3>
                            </div>
                            <button type="button" onClick={() => void load()} className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white">
                                Refresh
                            </button>
                        </header>
                        {loading && !data && <EmptyState label="Loading arrivals…" />}
                        {!loading && (data?.arrivals.length ?? 0) === 0 && <EmptyState label="No arrivals on the board for today." />}
                        <ul className="space-y-3">
                            {data?.arrivals.map((appt) => (
                                <li key={appt.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-white">{appt.service_type}</p>
                                            <p className="text-xs text-zinc-400">
                                                {appt.time}
                                                {appt.advisor ? ` · ${appt.advisor}` : ''}
                                                {appt.duration_est_hours ? ` · ${appt.duration_est_hours}h` : ''}
                                            </p>
                                        </div>
                                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${APPT_STATUS_STYLES[appt.status] ?? APPT_STATUS_STYLES.confirmed}`}>
                                            {appt.status}
                                        </span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                                        <span>Customer {appt.customer_id}</span>
                                        <span>Vehicle {appt.vehicle_id}</span>
                                        {appt.confirmation_number && <span>{appt.confirmation_number}</span>}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>

                    <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                        <header className="mb-4 flex items-end justify-between">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Loaner queue</p>
                                <h3 className="mt-2 text-xl font-black text-white">Awaiting confirmation</h3>
                            </div>
                            <span className="rounded-full border border-red-500/40 bg-red-600/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-red-200">
                                {data?.loaner_queue.length ?? 0} pending
                            </span>
                        </header>
                        {loading && !data && <EmptyState label="Loading loaner requests…" />}
                        {!loading && (data?.loaner_queue.length ?? 0) === 0 && <EmptyState label="No loaner requests awaiting confirmation." />}
                        <ul className="space-y-3">
                            {data?.loaner_queue.map((req) => (
                                <li key={req.id} className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-white">{req.loaner_preferred ?? 'Any loaner'}</p>
                                            <p className="text-xs text-red-200">
                                                Customer {req.customer_id}
                                                {req.requested_date ? ` · ${req.requested_date}` : ''}
                                            </p>
                                            {req.notes && <p className="mt-2 text-xs text-zinc-300">{req.notes}</p>}
                                        </div>
                                        <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">{formatRelative(req.created_at)}</p>
                                    </div>
                                    <div className="mt-3 flex gap-2">
                                        <button
                                            type="button"
                                            disabled={actionFor === req.id}
                                            onClick={() => void patchLoaner(req.id, 'approved')}
                                            className="flex-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                                        >
                                            Approve
                                        </button>
                                        <button
                                            type="button"
                                            disabled={actionFor === req.id}
                                            onClick={() => void patchLoaner(req.id, 'declined')}
                                            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-50"
                                        >
                                            Decline
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>

                    <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5 lg:col-span-2">
                        <header className="mb-4 flex items-end justify-between">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Upsell pipeline</p>
                                <h3 className="mt-2 text-xl font-black text-white">Aria-flagged opportunities</h3>
                            </div>
                            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">
                                {formatCurrency(stats?.upsell_value)} potential
                            </span>
                        </header>
                        {loading && !data && <EmptyState label="Loading upsells…" />}
                        {!loading && (data?.upsells.length ?? 0) === 0 && <EmptyState label="No open upsells in the pipeline." />}
                        <ul className="grid gap-3 lg:grid-cols-2">
                            {data?.upsells.map((u) => (
                                <li key={u.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-white">{u.upsell_type}</p>
                                            <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 mt-1">
                                                Created {formatRelative(u.created_at)}
                                            </p>
                                            {u.description && <p className="mt-2 text-xs text-zinc-300">{u.description}</p>}
                                        </div>
                                        <div className="flex shrink-0 flex-col items-end gap-2">
                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${UPSELL_STATUS_STYLES[u.status] ?? UPSELL_STATUS_STYLES.pending}`}>
                                                {u.status}
                                            </span>
                                            <p className="text-lg font-black text-emerald-300">{formatCurrency(u.value_est)}</p>
                                        </div>
                                    </div>
                                    <UpsellCustomerContextBar upsell={u} />
                                    <div className="mt-3 flex gap-2">
                                        <button
                                            type="button"
                                            disabled={actionFor === u.id}
                                            onClick={() => void patchUpsell(u.id, 'accepted')}
                                            className="flex-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                                        >
                                            Accept
                                        </button>
                                        <button
                                            type="button"
                                            disabled={actionFor === u.id}
                                            onClick={() => void patchUpsell(u.id, 'declined')}
                                            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-50"
                                        >
                                            Decline
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>
                </div>
            </section>
        </main>
    );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'red' | 'emerald' }) {
    const accentClass =
        accent === 'red'
            ? 'text-red-300'
            : accent === 'emerald'
            ? 'text-emerald-300'
            : 'text-white';
    return (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">{label}</p>
            <p className={`mt-2 text-3xl font-black ${accentClass}`}>{value}</p>
        </div>
    );
}

function EmptyState({ label }: { label: string }) {
    return (
        <p className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-6 text-center text-sm text-zinc-400">
            {label}
        </p>
    );
}
