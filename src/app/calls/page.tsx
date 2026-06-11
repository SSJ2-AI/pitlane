'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type {
    AppointmentRow,
    CallLogRow,
    CallOutcome,
    CallSentiment,
    LoanerRequestRow,
    UpsellRow,
} from '@/lib/supabase';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';

const OUTCOMES: { value: CallOutcome | ''; label: string }[] = [
    { value: '', label: 'All outcomes' },
    { value: 'appointment_booked', label: 'Appointment booked' },
    { value: 'upsell_flagged', label: 'Upsell flagged' },
    { value: 'issue_reported', label: 'Issue reported' },
    { value: 'inquiry', label: 'Inquiry' },
    { value: 'other', label: 'Other' },
];

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

const STATUS_STYLES: Record<string, string> = {
    in_progress: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    completed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    failed: 'border-red-500/40 bg-red-500/10 text-red-200',
    no_answer: 'border-zinc-700 bg-zinc-950 text-zinc-300',
};

const DEFAULT_LIMIT = 50;

interface CallListResponse {
    calls: CallLogRow[];
    total: number;
    persistence: 'supabase' | 'none';
}

interface CallDetailResponse {
    call: CallLogRow;
    appointments: AppointmentRow[];
    upsells: UpsellRow[];
    loaner_requests: LoanerRequestRow[];
    persistence: 'supabase';
}

function formatTime(iso: string | null) {
    if (!iso) return '—';
    try {
        const date = new Date(iso);
        const isToday = date.toDateString() === new Date().toDateString();
        const time = date.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
        if (isToday) return `Today · ${time}`;
        return `${date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} · ${time}`;
    } catch {
        return iso;
    }
}

function formatDurationSecs(seconds: number | null) {
    if (seconds === null || seconds === undefined) return '—';
    return `${seconds}s`;
}

function formatCurrency(value: number | null) {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
}

function callerLabel(call: CallLogRow) {
    if (call.summary?.summary_text?.startsWith('Heuristic')) {
        return call.customer_id ?? call.caller_phone;
    }
    return call.customer_id ?? call.caller_phone ?? 'Unknown caller';
}

export default function CallsPage() {
    // useSearchParams forces this subtree into a client boundary which
    // Next.js requires to be wrapped in Suspense.
    return (
        <Suspense fallback={<CallsPageFallback />}>
            <CallsPageInner />
        </Suspense>
    );
}

function CallsPageFallback() {
    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <div className="mx-auto max-w-7xl px-5 py-16 text-center text-sm text-zinc-400 lg:px-8">Loading call log…</div>
        </main>
    );
}

function CallsPageInner() {
    const searchParams = useSearchParams();

    const [calls, setCalls] = useState<CallLogRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [persistence, setPersistence] = useState<'supabase' | 'none'>('none');
    const [error, setError] = useState<string | null>(null);

    const [customerFilter, setCustomerFilter] = useState(() => searchParams.get('customer_id') ?? '');
    const [outcomeFilter, setOutcomeFilter] = useState<CallOutcome | ''>(() => (searchParams.get('outcome') as CallOutcome) ?? '');
    const [since, setSince] = useState(() => searchParams.get('since') ?? '');
    const [until, setUntil] = useState(() => searchParams.get('until') ?? '');

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<CallDetailResponse | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const buildQuery = useCallback(() => {
        const params = new URLSearchParams();
        if (customerFilter.trim()) params.set('customer_id', customerFilter.trim());
        if (outcomeFilter) params.set('outcome', outcomeFilter);
        if (since) params.set('since', since);
        if (until) params.set('until', until);
        params.set('limit', String(DEFAULT_LIMIT));
        return params.toString();
    }, [customerFilter, outcomeFilter, since, until]);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/calls?${buildQuery()}`, { cache: 'no-store' });
            const payload = (await response.json()) as CallListResponse & { error?: string };
            if (!response.ok) {
                setError(payload.error ?? `HTTP ${response.status}`);
                setCalls([]);
                setTotal(0);
            } else {
                setCalls(payload.calls ?? []);
                setTotal(payload.total ?? 0);
                setPersistence(payload.persistence ?? 'none');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load call log');
            setCalls([]);
        } finally {
            setLoading(false);
        }
    }, [buildQuery]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!selectedId) {
            setDetail(null);
            return;
        }
        setDetailLoading(true);
        let cancelled = false;
        fetch(`/api/calls/${selectedId}`, { cache: 'no-store' })
            .then((r) => r.json())
            .then((payload: CallDetailResponse) => {
                if (cancelled) return;
                setDetail(payload);
            })
            .catch(() => {
                if (!cancelled) setDetail(null);
            })
            .finally(() => {
                if (!cancelled) setDetailLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [selectedId]);

    const upsellTotal = useMemo(() => {
        return calls.reduce((sum, call) => {
            const upsells = call.summary?.upsells_flagged ?? [];
            return sum + upsells.reduce((s, u) => s + (u.value_est ?? 0), 0);
        }, 0);
    }, [calls]);

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        void load();
    }

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <div className="flex items-center gap-3">
                        <Link href="/dashboard" className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100 shadow-lg shadow-red-950/30">PL</div>
                            <div>
                                <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                                <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Aria call log</p>
                            </div>
                        </Link>
                    </div>
                    <nav className="flex flex-wrap items-center gap-3">
                        <VoiceStatusDot />
                        <Link
                            href="/dashboard"
                            className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white"
                        >
                            Dashboard
                        </Link>
                        <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200">
                            Calls
                        </span>
                    </nav>
                </div>
            </header>

            <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
                <div className="mb-6 flex flex-col gap-2">
                    <p className="text-sm font-semibold uppercase tracking-[0.4em] text-red-400">Aria phone log</p>
                    <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Every call, every outcome.</h2>
                    <p className="max-w-3xl text-base leading-7 text-zinc-400">
                        Aria&apos;s post-call pipeline writes here automatically — outcome, sentiment, action items, flagged
                        upsells, and full transcripts. Click any row to see the full conversation, the appointment Aria booked,
                        and the upsells she surfaced.
                    </p>
                </div>

                <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Calls in view</p>
                        <p className="mt-2 text-3xl font-black text-white">{calls.length}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Total on file</p>
                        <p className="mt-2 text-3xl font-black text-white">{total}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Upsell pipeline</p>
                        <p className="mt-2 text-3xl font-black text-emerald-300">{formatCurrency(upsellTotal)}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Persistence</p>
                        <p className={`mt-2 text-xl font-black ${persistence === 'supabase' ? 'text-emerald-300' : 'text-amber-300'}`}>
                            {persistence === 'supabase' ? 'Supabase' : 'Not configured'}
                        </p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="mb-6 rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Customer ID</span>
                            <input
                                value={customerFilter}
                                onChange={(e) => setCustomerFilter(e.target.value)}
                                placeholder="cust_001"
                                className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Outcome</span>
                            <select
                                value={outcomeFilter}
                                onChange={(e) => setOutcomeFilter(e.target.value as CallOutcome | '')}
                                className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            >
                                {OUTCOMES.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">From</span>
                            <input
                                type="date"
                                value={since}
                                onChange={(e) => setSince(e.target.value)}
                                className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Until</span>
                            <input
                                type="date"
                                value={until}
                                onChange={(e) => setUntil(e.target.value)}
                                className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            />
                        </label>
                        <div className="flex items-end gap-2">
                            <button
                                type="submit"
                                className="flex-1 rounded-2xl bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500"
                            >
                                {loading ? 'Loading…' : 'Apply'}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setCustomerFilter('');
                                    setOutcomeFilter('');
                                    setSince('');
                                    setUntil('');
                                }}
                                className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                </form>

                {persistence === 'none' && (
                    <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-100">
                        Supabase isn&apos;t configured on this deploy yet. Set <code className="rounded bg-amber-500/20 px-1.5">SUPABASE_URL</code> and{' '}
                        <code className="rounded bg-amber-500/20 px-1.5">SUPABASE_SERVICE_ROLE_KEY</code> in the dashboard&apos;s env vars and reload — call logs will start appearing here as soon as Aria&apos;s post-call webhook fires.
                    </div>
                )}
                {error && (
                    <div className="mb-6 rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-100">{error}</div>
                )}

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
                    <ul className="space-y-3">
                        {loading && calls.length === 0 && (
                            <li className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900 px-5 py-8 text-center text-sm text-zinc-400">Loading…</li>
                        )}
                        {!loading && calls.length === 0 && (
                            <li className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900 px-5 py-8 text-center text-sm text-zinc-400">
                                No calls match these filters yet.
                            </li>
                        )}
                        {calls.map((call) => {
                            const outcome = call.summary?.outcome;
                            const sentiment = call.summary?.sentiment;
                            const isActive = selectedId === call.id;
                            return (
                                <li key={call.id}>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedId(call.id)}
                                        className={`w-full rounded-3xl border p-5 text-left transition ${
                                            isActive
                                                ? 'border-red-500/60 bg-red-600/10 shadow-lg shadow-red-950/30'
                                                : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600'
                                        }`}
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-base font-black text-white">{callerLabel(call)}</p>
                                                <p className="mt-0.5 text-xs text-zinc-500">{call.caller_phone}</p>
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
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${STATUS_STYLES[call.status] ?? STATUS_STYLES.completed}`}>
                                                    {call.status.replace('_', ' ')}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-400">
                                            <span>{formatTime(call.started_at)}</span>
                                            <span>·</span>
                                            <span>{formatDurationSecs(call.duration_secs)}</span>
                                            <span>·</span>
                                            <span className="capitalize">{call.direction}</span>
                                        </div>
                                        {call.summary?.summary_text && (
                                            <p className="mt-3 line-clamp-2 text-sm text-zinc-300">{call.summary.summary_text}</p>
                                        )}
                                        {(call.summary?.upsells_flagged?.length ?? 0) > 0 && (
                                            <p className="mt-2 text-xs font-bold text-amber-200">
                                                {call.summary?.upsells_flagged?.length} upsell{call.summary?.upsells_flagged?.length === 1 ? '' : 's'} flagged
                                            </p>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>

                    <aside className="space-y-4">
                        {!selectedId && (
                            <section className="rounded-3xl border border-dashed border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
                                Select a call to see the full transcript, AI summary, and everything Aria did during the conversation.
                            </section>
                        )}
                        {selectedId && detailLoading && (
                            <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">Loading call detail…</section>
                        )}
                        {selectedId && !detailLoading && detail && <CallDetailPanel detail={detail} />}
                    </aside>
                </div>
            </section>
        </main>
    );
}

function CallDetailPanel({ detail }: { detail: CallDetailResponse }) {
    const { call, appointments, upsells, loaner_requests } = detail;
    const summary = call.summary;
    const transcript = call.transcript ?? [];

    return (
        <div className="space-y-4">
            <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Call detail</p>
                <h3 className="mt-2 text-xl font-black text-white">{call.customer_id ?? call.caller_phone}</h3>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
                    <span>{formatTime(call.started_at)}</span>
                    <span>·</span>
                    <span>{formatDurationSecs(call.duration_secs)}</span>
                    <span>·</span>
                    <span className="capitalize">{call.direction}</span>
                </div>
                {summary?.summary_text && (
                    <p className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm leading-6 text-zinc-200">
                        {summary.summary_text}
                    </p>
                )}
                {summary?.generated_by && (
                    <p className="mt-2 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                        Summary by {summary.generated_by}
                    </p>
                )}
            </section>

            {summary && (summary.topics.length > 0 || summary.action_items.length > 0) && (
                <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                    {summary.topics.length > 0 && (
                        <div className="mb-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Topics</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {summary.topics.map((topic) => (
                                    <span key={topic} className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs text-zinc-200">
                                        {topic}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    {summary.action_items.length > 0 && (
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Action items</p>
                            <ul className="mt-2 space-y-2">
                                {summary.action_items.map((item) => (
                                    <li key={item} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </section>
            )}

            {(summary?.upsells_flagged?.length ?? 0) > 0 && (
                <section className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">Upsells flagged</p>
                    <ul className="mt-3 space-y-2">
                        {summary?.upsells_flagged?.map((u, idx) => (
                            <li key={`${u.type}-${idx}`} className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-100">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="font-bold">{u.type}</span>
                                    <span className="font-black text-amber-200">{formatCurrency(u.value_est ?? null)}</span>
                                </div>
                                {u.description && <p className="mt-1 text-xs text-amber-100/80">{u.description}</p>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {appointments.length > 0 && (
                <section className="rounded-3xl border border-emerald-500/40 bg-emerald-500/10 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">Appointments booked</p>
                    <ul className="mt-3 space-y-2">
                        {appointments.map((appt) => (
                            <li key={appt.id} className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100">
                                <p className="font-bold">{appt.service_type}</p>
                                <p className="text-xs text-emerald-200/80">
                                    {appt.date} at {appt.time}
                                    {appt.advisor ? ` · ${appt.advisor}` : ''}
                                    {appt.duration_est_hours ? ` · ${appt.duration_est_hours}h` : ''}
                                </p>
                                {appt.confirmation_number && (
                                    <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-emerald-300">{appt.confirmation_number}</p>
                                )}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {upsells.length > 0 && (
                <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Upsells logged (Supabase)</p>
                    <ul className="mt-3 space-y-2">
                        {upsells.map((u) => (
                            <li key={u.id} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="font-bold">{u.upsell_type}</span>
                                    <span className="font-black text-amber-200">{formatCurrency(u.value_est)}</span>
                                </div>
                                {u.description && <p className="mt-1 text-xs text-zinc-400">{u.description}</p>}
                                <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-zinc-500">{u.status}</p>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {loaner_requests.length > 0 && (
                <section className="rounded-3xl border border-red-500/40 bg-red-600/10 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-200">Loaner requests</p>
                    <ul className="mt-3 space-y-2">
                        {loaner_requests.map((l) => (
                            <li key={l.id} className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-100">
                                <p className="font-bold">
                                    {l.loaner_preferred ?? 'Any loaner'}
                                    {l.requested_date ? ` · ${l.requested_date}` : ''}
                                </p>
                                <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-red-200">{l.status}</p>
                                {l.notes && <p className="mt-1 text-xs text-red-100/80">{l.notes}</p>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {transcript.length > 0 && (
                <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Transcript</p>
                    <ol className="mt-3 space-y-2">
                        {transcript.map((turn, idx) => (
                            <li
                                key={idx}
                                className={`rounded-xl border px-3 py-2 text-sm ${
                                    turn.role === 'agent'
                                        ? 'border-red-500/30 bg-red-500/5 text-red-100'
                                        : 'border-zinc-800 bg-zinc-950 text-zinc-200'
                                }`}
                            >
                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                                    {turn.role === 'agent' ? 'Aria' : turn.role}
                                </p>
                                <p className="mt-1 leading-6">{turn.message}</p>
                            </li>
                        ))}
                    </ol>
                </section>
            )}
        </div>
    );
}
