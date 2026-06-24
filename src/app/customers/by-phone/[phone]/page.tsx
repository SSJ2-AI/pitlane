'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import type { CallLogRow, CallOutcome, CallSentiment } from '@/lib/supabase';

// /customers/by-phone/[phone] — Phase 8b call history for a single number.
//
// Reads /api/customers/by-phone/:phone which merges the customers index
// (Supabase migration 0006) with call_logs (or MOCK_CALLS for the demo).
// Linked to from the customers directory's "View calls" affordance when
// the customer doesn't have a cust_xxx id yet.

interface ByPhoneResponse {
    customer: {
        phone: string;
        name: string | null;
        email: string | null;
        is_new_customer: boolean;
        total_calls: number;
        last_call_at: string | null;
        last_sentiment: string | null;
        source: 'supabase' | 'mock';
    } | null;
    calls: Array<CallLogRow & { customer_name: string | null }>;
    persistence: 'supabase' | 'mock' | 'none';
}

const OUTCOME_STYLES: Record<CallOutcome, string> = {
    appointment_booked: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    upsell_flagged: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    issue_reported: 'border-red-500/40 bg-red-500/10 text-red-200',
    inquiry: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
    other: 'border-zinc-700 bg-zinc-950 text-zinc-300',
};

const SENTIMENT_STYLES: Record<CallSentiment, string> = {
    positive: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    neutral: 'border-zinc-700 bg-zinc-950 text-zinc-300',
    negative: 'border-red-500/40 bg-red-500/10 text-red-200',
};

function formatTime(iso: string | null) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
        return iso;
    }
}

function formatDuration(seconds: number | null | undefined) {
    if (seconds === null || seconds === undefined) return '—';
    if (seconds < 60) return `${seconds}s`;
    const min = Math.floor(seconds / 60);
    const rem = seconds % 60;
    return `${min}m ${rem.toString().padStart(2, '0')}s`;
}

export default function CustomerByPhonePage() {
    const params = useParams<{ phone: string }>();
    const phone = params?.phone ? decodeURIComponent(params.phone) : '';

    const [data, setData] = useState<ByPhoneResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!phone) return;
        setLoading(true);
        setError(null);
        try {
            const r = await fetch(`/api/customers/by-phone/${encodeURIComponent(phone)}`, { cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const payload = (await r.json()) as ByPhoneResponse;
            setData(payload);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load customer history');
        } finally {
            setLoading(false);
        }
    }, [phone]);

    useEffect(() => {
        void load();
    }, [load]);

    const customer = data?.customer;

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100 shadow-lg shadow-red-950/30">PL</div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Caller history</p>
                        </div>
                    </Link>
                    <nav className="flex flex-wrap items-center gap-3">
                        <VoiceStatusDot />
                        <Link href="/dashboard" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Dashboard</Link>
                        <Link href="/calls" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Calls</Link>
                        <Link href="/customers" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Customers</Link>
                        <Link href="/analytics" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Analytics</Link>
                        <Link href="/service-desk" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Service desk</Link>
                    </nav>
                </div>
            </header>

            <section className="mx-auto max-w-4xl px-5 py-8 lg:px-8">
                <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.4em] text-red-400">Caller history</p>
                        <h2 className="mt-2 text-4xl font-black tracking-tight text-white">
                            {customer?.name ?? phone}
                        </h2>
                        <p className="mt-2 text-sm text-zinc-400">{phone}</p>
                    </div>
                    {customer?.is_new_customer && (
                        <span className="rounded-full border border-yellow-500/50 bg-yellow-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-yellow-100">
                            Not yet in CDK
                        </span>
                    )}
                </div>

                {loading && !data && <div className="h-24 animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900" />}
                {error && (
                    <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-100">{error}</div>
                )}

                {data && !customer && !loading && (
                    <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900 px-5 py-8 text-center text-sm text-zinc-400">
                        No calls on file for this phone number yet.
                    </div>
                )}

                {customer && (
                    <div className="mb-6 grid gap-3 sm:grid-cols-3">
                        <StatCard label="Total calls" value={String(customer.total_calls)} />
                        <StatCard label="Last call" value={formatTime(customer.last_call_at)} />
                        <StatCard label="Last sentiment" value={customer.last_sentiment ?? '—'} />
                    </div>
                )}

                {data && data.calls.length > 0 && (
                    <ul className="space-y-3">
                        {data.calls.map((call) => {
                            const outcome = call.summary?.outcome;
                            const sentiment = call.summary?.sentiment;
                            return (
                                <li key={call.id}>
                                    <Link
                                        href={`/calls/${encodeURIComponent(call.id)}`}
                                        className="block rounded-3xl border border-zinc-800 bg-zinc-900 p-5 transition hover:border-zinc-600"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-sm font-black text-white">
                                                    {formatTime(call.started_at)}
                                                </p>
                                                <p className="mt-1 text-xs text-zinc-400">
                                                    {formatDuration(call.duration_secs)} · <span className="capitalize">{call.direction}</span>
                                                </p>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                {outcome && (
                                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${OUTCOME_STYLES[outcome]}`}>
                                                        {outcome.replace(/_/g, ' ')}
                                                    </span>
                                                )}
                                                {sentiment && (
                                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${SENTIMENT_STYLES[sentiment]}`}>
                                                        {sentiment}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {call.summary?.summary_text && (
                                            <p className="mt-3 line-clamp-2 text-sm text-zinc-300">{call.summary.summary_text}</p>
                                        )}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
        </main>
    );
}

function StatCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">{label}</p>
            <p className="mt-2 text-lg font-black text-white">{value}</p>
        </div>
    );
}
