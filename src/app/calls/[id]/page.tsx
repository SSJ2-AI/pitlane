'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import type {
    AppointmentRow,
    CallLogRow,
    CallOutcome,
    CallSentiment,
    LoanerRequestRow,
    UpsellRow,
} from '@/lib/supabase';

// /calls/[id] — Phase 8b standalone call detail page. Deep-linkable from
// the customer profile, callback queue, etc. Renders the same surface as
// the /calls side panel (summary text, topics, action items, upsells,
// sentiment, transcript) but as a full page with its own header.

interface CallDetailPayload {
    call: (CallLogRow & { customer_name?: string | null }) | null;
    appointments: AppointmentRow[];
    upsells: UpsellRow[];
    loaner_requests: LoanerRequestRow[];
    persistence?: string;
    error?: string;
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

function formatDuration(seconds: number | null | undefined) {
    if (seconds === null || seconds === undefined) return '—';
    if (seconds < 60) return `${seconds}s`;
    const min = Math.floor(seconds / 60);
    const rem = seconds % 60;
    return `${min}m ${rem.toString().padStart(2, '0')}s`;
}

function formatTime(iso: string | null) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        return d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
        return iso;
    }
}

function formatCurrency(value: number | null | undefined) {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
}

export default function CallDetailPage() {
    const params = useParams<{ id: string }>();
    const id = params?.id;

    const [data, setData] = useState<CallDetailPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [transcriptOpen, setTranscriptOpen] = useState(true);

    const load = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        setError(null);
        try {
            const r = await fetch(`/api/calls/${encodeURIComponent(id)}`, { cache: 'no-store' });
            const payload = (await r.json()) as CallDetailPayload;
            if (!r.ok || !payload?.call) {
                setError(payload?.error ?? `HTTP ${r.status}`);
                setData(null);
                return;
            }
            setData(payload);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load call');
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        void load();
    }, [load]);

    const call = data?.call;
    const summary = call?.summary;
    const transcript = call?.transcript ?? [];
    // Phase 8b — callback_requested isn't a column on call_logs yet (Phase 9a
    // tracks callbacks as a separate table). We surface it here if the
    // summary action_items mention "callback" so the badge has an anchor
    // until the schema column lands.
    const callbackRequested = useMemo(() => {
        if (!summary) return false;
        return summary.action_items.some((item) => /callback|call ?back|return call/i.test(item));
    }, [summary]);

    const callerName =
        call?.customer_name ?? (call?.caller_phone ? `Caller ${call.caller_phone}` : 'Unknown caller');

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100 shadow-lg shadow-red-950/30">PL</div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Call detail</p>
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
                        <p className="text-sm font-semibold uppercase tracking-[0.4em] text-red-400">Aria call</p>
                        <h2 className="mt-2 text-4xl font-black tracking-tight text-white">{callerName}</h2>
                        <p className="mt-2 text-sm text-zinc-400">
                            {call?.caller_phone ?? '—'} · {formatTime(call?.started_at ?? null)} · {formatDuration(call?.duration_secs ?? null)} · <span className="capitalize">{call?.direction ?? '—'}</span>
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {summary?.outcome && (
                            <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${OUTCOME_STYLES[summary.outcome]}`}>
                                {summary.outcome.replace(/_/g, ' ')}
                            </span>
                        )}
                        {summary?.sentiment && (
                            <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${SENTIMENT_STYLES[summary.sentiment]}`}>
                                {summary.sentiment}
                            </span>
                        )}
                        {callbackRequested && (
                            <span className="rounded-full border border-yellow-500/50 bg-yellow-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-yellow-100">
                                Callback requested
                            </span>
                        )}
                    </div>
                </div>

                {loading && !data && (
                    <div className="h-24 animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900" />
                )}
                {error && (
                    <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-100">{error}</div>
                )}

                {call && (
                    <div className="space-y-5">
                        {/* What the call was about */}
                        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">What the call was about</p>
                            {summary?.summary_text ? (
                                <>
                                    <p className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm leading-6 text-zinc-200">
                                        {summary.summary_text}
                                    </p>
                                    {summary.generated_by && (
                                        <p className="mt-2 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                                            Summary by {summary.generated_by}
                                        </p>
                                    )}
                                </>
                            ) : (
                                <p className="mt-3 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm italic text-zinc-500">
                                    No summary yet — {call.status === 'in_progress' ? 'call is still in progress.' : 'Aria didn\u2019t generate one (post-call webhook may not have fired).'}
                                </p>
                            )}
                        </section>

                        {summary && summary.topics.length > 0 && (
                            <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Topics</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {summary.topics.map((topic) => (
                                        <span key={topic} className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs text-zinc-200">
                                            {topic}
                                        </span>
                                    ))}
                                </div>
                            </section>
                        )}

                        {summary && summary.action_items.length > 0 && (
                            <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Action items</p>
                                <ul className="mt-3 space-y-2">
                                    {summary.action_items.map((item) => (
                                        <li key={item} className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
                                            <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/50 bg-emerald-500/10 text-xs font-black text-emerald-300">
                                                ✓
                                            </span>
                                            <span className="leading-6">{item}</span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {(summary?.upsells_flagged?.length ?? 0) > 0 && (
                            <section className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-5">
                                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">Flagged upsells</p>
                                <ul className="mt-3 space-y-2">
                                    {summary?.upsells_flagged?.map((u, idx) => (
                                        <li key={`${u.type}-${idx}`} className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-100">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="font-bold">{u.type.replace(/_/g, ' ')}</span>
                                                <span className="font-black text-amber-200">{formatCurrency(u.value_est)}</span>
                                            </div>
                                            {u.description && <p className="mt-1 text-xs text-amber-100/80">{u.description}</p>}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {transcript.length > 0 && (
                            <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                                <button
                                    type="button"
                                    onClick={() => setTranscriptOpen((v) => !v)}
                                    className="flex w-full items-center justify-between text-left"
                                >
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Transcript</p>
                                        <p className="mt-1 text-sm font-black text-white">{transcript.length} turn{transcript.length === 1 ? '' : 's'}</p>
                                    </div>
                                    <span className="text-xs uppercase tracking-[0.22em] text-zinc-400">{transcriptOpen ? 'Collapse' : 'Expand'}</span>
                                </button>
                                {transcriptOpen && (
                                    <ol className="mt-3 space-y-2">
                                        {transcript.map((turn, idx) => (
                                            <li
                                                key={idx}
                                                className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${
                                                    turn.role === 'agent'
                                                        ? 'ml-12 border-red-500/30 bg-red-500/5 text-red-100'
                                                        : 'mr-12 border-zinc-800 bg-zinc-950 text-zinc-200'
                                                }`}
                                            >
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                                                    {turn.role === 'agent' ? 'Aria' : turn.role}
                                                </p>
                                                <p className="mt-1">{turn.message}</p>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </section>
                        )}

                        {data && (data.appointments.length > 0 || data.upsells.length > 0 || data.loaner_requests.length > 0) && (
                            <section className="grid gap-3 sm:grid-cols-3">
                                <SideStat label="Appointments" value={String(data.appointments.length)} accent="emerald" />
                                <SideStat label="Upsells logged" value={String(data.upsells.length)} accent="amber" />
                                <SideStat label="Loaner requests" value={String(data.loaner_requests.length)} accent="red" />
                            </section>
                        )}

                        {call.customer_id && (
                            <Link
                                href={`/customers/${encodeURIComponent(call.customer_id)}`}
                                className="inline-block rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-zinc-300 transition hover:border-red-500 hover:text-white"
                            >
                                ← View customer profile
                            </Link>
                        )}
                    </div>
                )}
            </section>
        </main>
    );
}

function SideStat({ label, value, accent }: { label: string; value: string; accent: 'emerald' | 'amber' | 'red' }) {
    const color =
        accent === 'emerald' ? 'text-emerald-300' : accent === 'amber' ? 'text-amber-300' : 'text-red-300';
    return (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">{label}</p>
            <p className={`mt-2 text-3xl font-black ${color}`}>{value}</p>
        </div>
    );
}
