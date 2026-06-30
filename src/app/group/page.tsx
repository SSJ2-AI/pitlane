'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import { UpsellCustomerContextBar } from '@/components/UpsellCustomerContextBar';
import type { UpsellWithCustomerContext } from '@/lib/upsell-context';

// /group — Fixed Operations Manager (group_manager) dashboard.
//
// Read-only consolidation across every rooftop in the group:
//   - Top stat row: dealer count, calls today / this week, callback queue
//     depth, open ROs, loaner utilisation, warranty alerts.
//   - Per-dealer card grid: same metrics scoped to that rooftop, plus the
//     average sentiment score (color-coded) and a 'View calls' link that
//     deep-links into /calls?dealer=<id>.
//   - Warranty alerts widget — count of vehicles in expiring_soon OR
//     expired state grouped by dealer.
//   - Top callback reasons across the group (last 7 days).

interface DealerStats {
    dealer_id: string;
    dealer_name: string;
    brand: string;
    calls_today: number;
    calls_this_week: number;
    callbacks_pending: number;
    callbacks_frustrated: number;
    open_repair_orders: number;
    avg_sentiment_score: number | null;
    loaners_active: number;
    warranty_expiring_soon: number;
    warranty_expired: number;
    top_topics: string[];
}

interface GroupSummary {
    dealers: DealerStats[];
    totals: {
        dealers_count: number;
        calls_today: number;
        calls_this_week: number;
        callbacks_pending: number;
        open_repair_orders: number;
        loaners_active: number;
        warranty_alerts: number;
        pending_upsells: number;
        upsell_value: number;
    };
    top_callback_reasons: Array<{ reason: string; count: number }>;
    upsells: UpsellWithCustomerContext[];
    persistence: 'supabase' | 'mock';
}

const UPSELL_STATUS_STYLES: Record<string, string> = {
    pending: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    accepted: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    declined: 'border-zinc-700 bg-zinc-950 text-zinc-300',
    expired: 'border-red-500/40 bg-red-500/10 text-red-200',
};

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

function sentimentColor(score: number | null): string {
    if (score === null) return 'text-zinc-300';
    if (score >= 0.75) return 'text-emerald-300';
    if (score >= 0.55) return 'text-amber-300';
    return 'text-red-300';
}

export default function GroupDashboard() {
    const [data, setData] = useState<GroupSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await fetch('/api/group/summary', { cache: 'no-store' });
            if (!r.ok) {
                if (r.status === 403) {
                    setError('Forbidden — this console is for group managers.');
                    return;
                }
                throw new Error(`HTTP ${r.status}`);
            }
            const payload = (await r.json()) as GroupSummary;
            setData(payload);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load group summary');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <Link href="/group" className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100">PL</div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Fixed operations</p>
                        </div>
                    </Link>
                    <nav className="flex flex-wrap items-center gap-3">
                        <VoiceStatusDot />
                        <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200">Group</span>
                        <Link href="/calls" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Calls</Link>
                        <Link href="/analytics" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Analytics</Link>
                        <form action="/api/auth/signout" method="post" className="inline">
                            <button type="submit" className="rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-red-500 hover:text-white">
                                Sign out
                            </button>
                        </form>
                    </nav>
                </div>
            </header>

            <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
                <div className="mb-6 flex flex-col gap-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.4em] text-red-400">Fixed-ops console</p>
                    <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">All rooftops, one view</h2>
                    <p className="max-w-3xl text-sm leading-6 text-zinc-400">Read-only roll-up across every dealer. Click a card to drill into that rooftop&apos;s calls.</p>
                </div>

                {error && <div className="mb-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-100">{error}</div>}
                {loading && !data && <div className="h-64 animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900" />}

                {data && (
                    <>
                        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <StatCard label="Dealers" value={String(data.totals.dealers_count)} />
                            <StatCard label="Calls today" value={String(data.totals.calls_today)} accent="emerald" />
                            <StatCard label="Calls this week" value={String(data.totals.calls_this_week)} />
                            <StatCard label="Callbacks pending" value={String(data.totals.callbacks_pending)} accent={data.totals.callbacks_pending > 0 ? 'red' : undefined} />
                            <StatCard label="Open ROs" value={String(data.totals.open_repair_orders)} />
                            <StatCard label="Active loaners" value={String(data.totals.loaners_active)} />
                            <StatCard label="Warranty alerts" value={String(data.totals.warranty_alerts)} accent={data.totals.warranty_alerts > 0 ? 'amber' : undefined} />
                            <StatCard label="Pending upsells" value={String(data.totals.pending_upsells)} accent={data.totals.pending_upsells > 0 ? 'amber' : undefined} />
                            <StatCard label="Upsell pipeline" value={formatCurrency(data.totals.upsell_value)} accent="emerald" />
                            <StatCard label="Persistence" value={data.persistence === 'supabase' ? 'Supabase' : 'Demo data'} accent={data.persistence === 'supabase' ? 'emerald' : 'sky'} />
                        </div>

                        <div className="mb-6 grid gap-3 lg:grid-cols-3">
                            {data.dealers.map((d) => (
                                <article key={d.dealer_id} className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                                    <header className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-xs uppercase tracking-[0.32em] text-zinc-500">{d.brand}</p>
                                            <h3 className="mt-1 text-xl font-black text-white">{d.dealer_name}</h3>
                                        </div>
                                        <Link
                                            href={`/calls?dealer=${encodeURIComponent(d.dealer_id)}`}
                                            className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white"
                                        >
                                            View calls →
                                        </Link>
                                    </header>
                                    <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                                        <Cell label="Today" value={String(d.calls_today)} />
                                        <Cell label="This week" value={String(d.calls_this_week)} />
                                        <Cell label="Pending callbacks" value={String(d.callbacks_pending)} accent={d.callbacks_pending > 0 ? 'red' : undefined} />
                                        <Cell label="Frustrated" value={String(d.callbacks_frustrated)} accent={d.callbacks_frustrated > 0 ? 'red' : undefined} />
                                        <Cell label="Open ROs" value={String(d.open_repair_orders)} />
                                        <Cell label="Loaners active" value={String(d.loaners_active)} />
                                        <Cell
                                            label="Avg sentiment"
                                            value={d.avg_sentiment_score === null ? '—' : d.avg_sentiment_score.toFixed(2)}
                                            valueClass={sentimentColor(d.avg_sentiment_score)}
                                        />
                                        <Cell label="Warranty alerts" value={String(d.warranty_expiring_soon + d.warranty_expired)} accent={d.warranty_expiring_soon + d.warranty_expired > 0 ? 'amber' : undefined} />
                                    </dl>
                                </article>
                            ))}
                        </div>

                        {data.upsells.length > 0 && (
                            <section className="mb-6 rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                                <header className="mb-4 flex items-end justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Upsell pipeline</p>
                                        <h3 className="mt-2 text-xl font-black text-white">Aria-flagged opportunities</h3>
                                    </div>
                                    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">
                                        {formatCurrency(data.totals.upsell_value)} potential
                                    </span>
                                </header>
                                <ul className="grid gap-3 lg:grid-cols-2">
                                    {data.upsells.map((u) => (
                                        <li key={u.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-black text-white">{u.upsell_type}</p>
                                                    <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                                                        Created {formatRelative(u.created_at)}
                                                    </p>
                                                    {u.description && <p className="mt-2 text-xs leading-5 text-zinc-300">{u.description}</p>}
                                                </div>
                                                <div className="flex shrink-0 flex-col items-end gap-2">
                                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${UPSELL_STATUS_STYLES[u.status] ?? UPSELL_STATUS_STYLES.pending}`}>
                                                        {u.status}
                                                    </span>
                                                    <p className="text-lg font-black text-emerald-300">{formatCurrency(u.value_est)}</p>
                                                </div>
                                            </div>
                                            <UpsellCustomerContextBar upsell={u} />
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        <div className="grid gap-3 lg:grid-cols-2">
                            <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Warranty alerts</p>
                                <h3 className="mt-2 text-xl font-black text-white">Vehicles needing attention</h3>
                                <ul className="mt-4 space-y-2">
                                    {data.dealers
                                        .filter((d) => d.warranty_expiring_soon + d.warranty_expired > 0)
                                        .map((d) => (
                                            <li key={d.dealer_id} className="flex items-center justify-between rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-sm">
                                                <span className="text-amber-100">{d.dealer_name}</span>
                                                <span className="text-amber-200">
                                                    {d.warranty_expiring_soon} soon · {d.warranty_expired} expired
                                                </span>
                                            </li>
                                        ))}
                                    {data.dealers.every((d) => d.warranty_expiring_soon + d.warranty_expired === 0) && (
                                        <li className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-3 text-xs italic text-zinc-500">
                                            No warranty alerts across the group right now.
                                        </li>
                                    )}
                                </ul>
                            </section>

                            <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Top callback reasons</p>
                                <h3 className="mt-2 text-xl font-black text-white">Last 7 days, across the group</h3>
                                <ol className="mt-4 space-y-2">
                                    {data.top_callback_reasons.length === 0 ? (
                                        <li className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-3 text-xs italic text-zinc-500">No callback reasons logged in the past week.</li>
                                    ) : (
                                        data.top_callback_reasons.map((row, idx) => (
                                            <li key={row.reason} className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm">
                                                <span className="flex items-center gap-3">
                                                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-600/20 text-[10px] font-black text-red-200">{idx + 1}</span>
                                                    <span className="text-zinc-200">{row.reason}</span>
                                                </span>
                                                <span className="text-xs font-bold text-zinc-400">{row.count}</span>
                                            </li>
                                        ))
                                    )}
                                </ol>
                            </section>
                        </div>
                    </>
                )}
            </section>
        </main>
    );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'red' | 'amber' | 'emerald' | 'sky' }) {
    const cls =
        accent === 'red' ? 'text-red-300' : accent === 'amber' ? 'text-amber-300' : accent === 'emerald' ? 'text-emerald-300' : accent === 'sky' ? 'text-sky-300' : 'text-white';
    return (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">{label}</p>
            <p className={`mt-2 text-3xl font-black ${cls}`}>{value}</p>
        </div>
    );
}

function Cell({ label, value, accent, valueClass }: { label: string; value: string; accent?: 'red' | 'amber'; valueClass?: string }) {
    const accentCls = accent === 'red' ? 'text-red-300' : accent === 'amber' ? 'text-amber-300' : 'text-white';
    return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
            <p className={`mt-1 text-lg font-black ${valueClass ?? accentCls}`}>{value}</p>
        </div>
    );
}
