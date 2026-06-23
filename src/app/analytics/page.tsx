'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import type { CallLogRow, CallOutcome, CallSentiment } from '@/lib/supabase';

// /analytics — Phase 9 task 3
//
// Reads from /api/calls?limit=1000 and aggregates client-side. Spec says
// the page must work against Supabase data when configured and fall back
// to the demo MOCK_CALLS otherwise — /api/calls already implements that
// fallback so this page does NOT need to know which source it's reading.

const KPI_FETCH_LIMIT = 1000;
const WEEK_MS = 1000 * 60 * 60 * 24 * 7;

type CallRowWithName = CallLogRow & { customer_name?: string | null };

interface CallListResponse {
    calls: CallRowWithName[];
    total: number;
    persistence: 'supabase' | 'mock' | 'none';
}

interface Kpis {
    totalCalls: number;
    callsThisWeek: number;
    appointmentBooked: number;
    appointmentConversionPct: number;
    upsellPipelineCad: number;
    upsellCallsCount: number;
    upsellAvgPerCallCad: number;
    sentiment: Record<CallSentiment | 'unknown', number>;
    loanerRequests: number;
    topTopics: Array<{ topic: string; count: number }>;
}

function emptyKpis(): Kpis {
    return {
        totalCalls: 0,
        callsThisWeek: 0,
        appointmentBooked: 0,
        appointmentConversionPct: 0,
        upsellPipelineCad: 0,
        upsellCallsCount: 0,
        upsellAvgPerCallCad: 0,
        sentiment: { positive: 0, neutral: 0, negative: 0, unknown: 0 },
        loanerRequests: 0,
        topTopics: [],
    };
}

function aggregate(calls: CallRowWithName[]): Kpis {
    const out = emptyKpis();
    out.totalCalls = calls.length;
    const oneWeekAgo = Date.now() - WEEK_MS;
    const topicCounts = new Map<string, number>();

    for (const call of calls) {
        if (call.started_at) {
            const ts = new Date(call.started_at).getTime();
            if (!Number.isNaN(ts) && ts >= oneWeekAgo) out.callsThisWeek += 1;
        }

        const outcome = call.summary?.outcome as CallOutcome | undefined;
        if (outcome === 'appointment_booked') out.appointmentBooked += 1;

        const sentiment = (call.summary?.sentiment as CallSentiment | undefined) ?? null;
        if (sentiment === 'positive' || sentiment === 'neutral' || sentiment === 'negative') {
            out.sentiment[sentiment] += 1;
        } else if (call.summary) {
            out.sentiment.unknown += 1;
        }

        if (call.summary?.loaner_needed === true) out.loanerRequests += 1;

        const upsells = call.summary?.upsells_flagged ?? [];
        if (upsells.length > 0) {
            out.upsellCallsCount += 1;
            for (const u of upsells) out.upsellPipelineCad += u.value_est ?? 0;
        }

        // Topic frequency — normalised lowercase so 'Brake service' /
        // 'brake service' collapse to one bucket. Display uses the
        // original-case version of the first occurrence.
        for (const raw of call.summary?.topics ?? []) {
            const key = raw.trim().toLowerCase();
            if (!key) continue;
            topicCounts.set(key, (topicCounts.get(key) ?? 0) + 1);
        }
    }

    out.appointmentConversionPct = out.totalCalls > 0 ? (out.appointmentBooked / out.totalCalls) * 100 : 0;
    out.upsellAvgPerCallCad = out.upsellCallsCount > 0 ? out.upsellPipelineCad / out.upsellCallsCount : 0;

    // Re-derive original-cased label by looking at the first occurrence.
    const originalCase = new Map<string, string>();
    for (const call of calls) {
        for (const raw of call.summary?.topics ?? []) {
            const k = raw.trim().toLowerCase();
            if (k && !originalCase.has(k)) originalCase.set(k, raw.trim());
        }
    }
    out.topTopics = Array.from(topicCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([key, count]) => ({ topic: originalCase.get(key) ?? key, count }));

    return out;
}

function formatCurrency(value: number) {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
}

export default function AnalyticsPage() {
    const [resp, setResp] = useState<CallListResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await fetch(`/api/calls?limit=${KPI_FETCH_LIMIT}`, { cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const payload = (await r.json()) as CallListResponse;
            setResp(payload);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load analytics');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const kpis = useMemo<Kpis>(() => (resp ? aggregate(resp.calls) : emptyKpis()), [resp]);

    const persistenceBadge =
        resp?.persistence === 'supabase'
            ? { label: 'Powered by Supabase', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' }
            : resp?.persistence === 'mock'
            ? { label: 'Demo data', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-200' }
            : { label: 'Persistence not configured', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-200' };

    const sentimentTotal =
        kpis.sentiment.positive + kpis.sentiment.neutral + kpis.sentiment.negative + kpis.sentiment.unknown;

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100 shadow-lg shadow-red-950/30">PL</div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Aria analytics</p>
                        </div>
                    </Link>
                    <nav className="flex flex-wrap items-center gap-3">
                        <VoiceStatusDot />
                        <Link href="/dashboard" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Dashboard</Link>
                        <Link href="/calls" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Calls</Link>
                        <Link href="/customers" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Customers</Link>
                        <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200">Analytics</span>
                        <Link href="/service-desk" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Service desk</Link>
                    </nav>
                </div>
            </header>

            <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
                <div className="mb-6 flex flex-col gap-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.4em] text-red-400">Aria KPIs</p>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">How Aria is performing.</h2>
                        <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${persistenceBadge.cls}`}>
                            {persistenceBadge.label}
                        </span>
                    </div>
                    <p className="max-w-3xl text-base leading-7 text-zinc-400">
                        Conversion, upsell pipeline, sentiment, and topic trends across every Aria conversation. Numbers
                        recompute on every page load — refresh after a call to see it land.
                    </p>
                </div>

                {error && (
                    <div className="mb-6 rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-100">{error}</div>
                )}

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <KpiCard
                        label="Total Aria calls"
                        value={loading ? '—' : kpis.totalCalls.toLocaleString('en-CA')}
                        hint={`${kpis.callsThisWeek} this week`}
                    />
                    <KpiCard
                        label="Appointment conversion"
                        value={loading ? '—' : `${kpis.appointmentConversionPct.toFixed(1)}%`}
                        hint={`${kpis.appointmentBooked} booked / ${kpis.totalCalls} total`}
                        accent="emerald"
                    />
                    <KpiCard
                        label="Upsell pipeline"
                        value={loading ? '—' : formatCurrency(kpis.upsellPipelineCad)}
                        hint={
                            kpis.upsellCallsCount > 0
                                ? `${formatCurrency(kpis.upsellAvgPerCallCad)} avg per upsell call (${kpis.upsellCallsCount} calls)`
                                : 'No upsells flagged yet'
                        }
                        accent="amber"
                    />
                    <KpiCard
                        label="Loaner requests"
                        value={loading ? '—' : kpis.loanerRequests.toLocaleString('en-CA')}
                        hint={
                            kpis.loanerRequests > 0
                                ? `${((kpis.loanerRequests / Math.max(kpis.totalCalls, 1)) * 100).toFixed(0)}% of calls`
                                : 'No loaner asks'
                        }
                        accent="red"
                    />

                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Sentiment</p>
                        <div className="mt-4 grid grid-cols-3 gap-3">
                            <SentimentPill label="Positive" count={kpis.sentiment.positive} total={sentimentTotal} accent="emerald" />
                            <SentimentPill label="Neutral" count={kpis.sentiment.neutral} total={sentimentTotal} accent="zinc" />
                            <SentimentPill label="Negative" count={kpis.sentiment.negative} total={sentimentTotal} accent="red" />
                        </div>
                        {kpis.sentiment.unknown > 0 && (
                            <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                                {kpis.sentiment.unknown} call{kpis.sentiment.unknown === 1 ? '' : 's'} without sentiment yet
                            </p>
                        )}
                    </div>

                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Top call topics</p>
                        {kpis.topTopics.length === 0 ? (
                            <p className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-500">
                                No topics tagged yet.
                            </p>
                        ) : (
                            <ol className="mt-4 space-y-2">
                                {kpis.topTopics.map((t, idx) => (
                                    <li
                                        key={t.topic}
                                        className="flex items-center justify-between gap-3 rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5"
                                    >
                                        <span className="flex min-w-0 items-center gap-2">
                                            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600/15 text-[10px] font-black text-red-200">
                                                {idx + 1}
                                            </span>
                                            <span className="truncate text-sm text-zinc-100">{t.topic}</span>
                                        </span>
                                        <span className="text-xs font-bold text-zinc-300">{t.count}</span>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>
                </div>

                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                    <BarBlock
                        title="Outcome split"
                        rows={[
                            { label: 'Appointment booked', value: kpis.appointmentBooked, accent: 'emerald' },
                            { label: 'Upsell calls', value: kpis.upsellCallsCount, accent: 'amber' },
                            { label: 'Loaner requests', value: kpis.loanerRequests, accent: 'red' },
                        ]}
                        max={Math.max(1, kpis.totalCalls)}
                    />
                    <BarBlock
                        title="Sentiment split"
                        rows={[
                            { label: 'Positive', value: kpis.sentiment.positive, accent: 'emerald' },
                            { label: 'Neutral', value: kpis.sentiment.neutral, accent: 'zinc' },
                            { label: 'Negative', value: kpis.sentiment.negative, accent: 'red' },
                        ]}
                        max={Math.max(1, sentimentTotal)}
                    />
                </div>
            </section>
        </main>
    );
}

function KpiCard({
    label,
    value,
    hint,
    accent,
}: {
    label: string;
    value: string;
    hint?: string;
    accent?: 'emerald' | 'amber' | 'red';
}) {
    const valueColor =
        accent === 'emerald'
            ? 'text-emerald-300'
            : accent === 'amber'
            ? 'text-amber-300'
            : accent === 'red'
            ? 'text-red-300'
            : 'text-white';
    return (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">{label}</p>
            <p className={`mt-3 text-4xl font-black ${valueColor}`}>{value}</p>
            {hint && <p className="mt-2 text-xs text-zinc-400">{hint}</p>}
        </div>
    );
}

function SentimentPill({
    label,
    count,
    total,
    accent,
}: {
    label: string;
    count: number;
    total: number;
    accent: 'emerald' | 'zinc' | 'red';
}) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const cls =
        accent === 'emerald'
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
            : accent === 'red'
            ? 'border-red-500/40 bg-red-500/10 text-red-200'
            : 'border-zinc-700 bg-zinc-950 text-zinc-200';
    return (
        <div className={`rounded-2xl border px-3 py-3 text-center ${cls}`}>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">{label}</p>
            <p className="mt-1 text-2xl font-black">{count}</p>
            <p className="text-[10px] opacity-70">{pct}%</p>
        </div>
    );
}

function BarBlock({
    title,
    rows,
    max,
}: {
    title: string;
    rows: Array<{ label: string; value: number; accent: 'emerald' | 'amber' | 'red' | 'zinc' }>;
    max: number;
}) {
    const barColor = (accent: string) =>
        accent === 'emerald'
            ? 'bg-emerald-500'
            : accent === 'amber'
            ? 'bg-amber-500'
            : accent === 'red'
            ? 'bg-red-500'
            : 'bg-zinc-500';
    return (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">{title}</p>
            <div className="mt-4 space-y-3">
                {rows.map((r) => (
                    <div key={r.label}>
                        <div className="flex items-center justify-between text-xs text-zinc-300">
                            <span>{r.label}</span>
                            <span className="font-black text-white">{r.value}</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-950">
                            <div
                                className={`h-full rounded-full ${barColor(r.accent)}`}
                                style={{ width: `${max > 0 ? (r.value / max) * 100 : 0}%` }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
