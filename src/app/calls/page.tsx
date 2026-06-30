'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
    AppointmentRow,
    CallLogRow,
    CallOutcome,
    CallSentiment,
    LoanerRequestRow,
    UpsellRow,
} from '@/lib/supabase';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import { formatCustomerPhone, normalizeCustomerTier, TIER_STYLES } from '@/lib/customer-display';

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

const UPSELL_STATUS_STYLES: Record<string, string> = {
    pending: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    accepted: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    declined: 'border-zinc-700 bg-zinc-900 text-zinc-300',
    expired: 'border-zinc-700 bg-zinc-900 text-zinc-400',
};

const DEFAULT_LIMIT = 50;

type CallRowWithName = CallLogRow & { customer_name?: string | null };
type PendingUpsellRow = UpsellRow & {
    customer_phone?: string | null;
    customer_tier?: string | null;
    vehicle_summary?: string | null;
};

interface CallListResponse {
    calls: CallRowWithName[];
    total: number;
    persistence: 'supabase' | 'mock' | 'none';
}

interface PendingUpsellsResponse {
    upsells: PendingUpsellRow[];
    total: number;
    persistence: 'supabase' | 'mock' | 'none';
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
    if (seconds === null || seconds === undefined || seconds === 0) {
        return 'Duration unavailable';
    }
    return `${seconds}s`;
}

function formatCurrency(value: number | null) {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
}

function formatDate(iso: string | null | undefined) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return iso;
    }
}

// Spec (Phase 9 task 1): show the customer's full name when MOCK_CUSTOMERS
// resolves it; otherwise fall back to the phone number — NOT the raw
// `cust_001` internal id. Fix 4: treat literal 'unknown' the same as a
// missing phone so we render the friendlier "Caller unknown" string.
function callerLabel(call: CallRowWithName) {
    if (call.customer_name) return call.customer_name;
    const phone = (call.caller_phone ?? '').trim();
    if (phone && phone.toLowerCase() !== 'unknown') return phone;
    return 'Caller unknown';
}

// Fix 4: a call_logs row is "data pending" when the post-call webhook
// hasn't filled in the basics yet — no resolved phone, no conversation
// id from ElevenLabs, or no duration. These rows are NOT hidden; they
// render with a yellow "⚠ Data pending" badge so advisors can see them
// and know to wait a few seconds for the webhook to land.
function isDataPending(call: CallRowWithName): boolean {
    const phone = (call.caller_phone ?? '').trim().toLowerCase();
    const noPhone = !phone || phone === 'unknown';
    const noConvId = !call.conversation_id;
    const noDuration = !call.duration_secs;
    return noPhone || noConvId || noDuration;
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

    const [calls, setCalls] = useState<CallRowWithName[]>([]);
    const [pendingUpsells, setPendingUpsells] = useState<PendingUpsellRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [upsellsLoading, setUpsellsLoading] = useState(false);
    const [persistence, setPersistence] = useState<'supabase' | 'mock' | 'none'>('none');
    const [error, setError] = useState<string | null>(null);
    const [upsellError, setUpsellError] = useState<string | null>(null);
    const [upsellActionFor, setUpsellActionFor] = useState<string | null>(null);

    // /calls?customer_id=cust_001 (linked from /customers, /dashboard,
    // /analytics) is honoured by pre-filling the server-side filter so
    // we only fetch that customer's history. The client-side search box
    // (Phase 9 task 1) replaces the older raw-id text input.
    const initialCustomerId = searchParams.get('customer_id') ?? '';
    const dealerFilter = searchParams.get('dealer') ?? '';
    const [customerIdFilter, setCustomerIdFilter] = useState(initialCustomerId);
    const [search, setSearch] = useState('');
    const [outcomeFilter, setOutcomeFilter] = useState<CallOutcome | ''>(() => (searchParams.get('outcome') as CallOutcome) ?? '');
    const [since, setSince] = useState(() => searchParams.get('since') ?? '');
    const [until, setUntil] = useState(() => searchParams.get('until') ?? '');

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<CallDetailResponse | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    // Fix 6: ref + side-effects to make the detail panel closable.
    // - Escape key closes the panel from anywhere on the page.
    // - Click outside both the panel and the row list closes the panel.
    // - Same-row re-click toggles it closed (handled inline on the row).
    const detailRef = useRef<HTMLElement | null>(null);
    const listRef = useRef<HTMLUListElement | null>(null);

    const closeDetail = useCallback(() => setSelectedId(null), []);

    useEffect(() => {
        if (!selectedId) return;
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') closeDetail();
        }
        function onPointerDown(e: PointerEvent) {
            const target = e.target as Node | null;
            if (!target) return;
            const inDetail = detailRef.current?.contains(target);
            const inList = listRef.current?.contains(target);
            if (!inDetail && !inList) closeDetail();
        }
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [selectedId, closeDetail]);

    const buildQuery = useCallback(() => {
        const params = new URLSearchParams();
        if (dealerFilter.trim()) params.set('dealer', dealerFilter.trim());
        if (customerIdFilter.trim()) params.set('customer_id', customerIdFilter.trim());
        if (outcomeFilter) params.set('outcome', outcomeFilter);
        if (since) params.set('since', since);
        if (until) params.set('until', until);
        params.set('limit', String(DEFAULT_LIMIT));
        return params.toString();
    }, [customerIdFilter, dealerFilter, outcomeFilter, since, until]);

    const load = useCallback(async () => {
        setLoading(true);
        setUpsellsLoading(true);
        setError(null);
        setUpsellError(null);
        try {
            const upsellParams = new URLSearchParams();
            if (dealerFilter.trim()) upsellParams.set('dealer', dealerFilter.trim());
            upsellParams.set('limit', '12');

            const [response, upsellsResponse] = await Promise.all([
                fetch(`/api/calls?${buildQuery()}`, { cache: 'no-store' }),
                fetch(`/api/upsells/pending?${upsellParams.toString()}`, { cache: 'no-store' }),
            ]);

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

            const upsellsPayload = (await upsellsResponse.json()) as PendingUpsellsResponse & { error?: string };
            if (!upsellsResponse.ok) {
                setUpsellError(upsellsPayload.error ?? `HTTP ${upsellsResponse.status}`);
                setPendingUpsells([]);
            } else {
                setPendingUpsells(upsellsPayload.upsells ?? []);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load call log');
            setCalls([]);
            setPendingUpsells([]);
        } finally {
            setLoading(false);
            setUpsellsLoading(false);
        }
    }, [buildQuery, dealerFilter]);

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

    // Phase 9 task 1: client-side name / phone / email filter applied on
    // top of the server-side filtered list. We match against the row's
    // customer_name (enriched server-side in /api/calls), caller_phone,
    // and customer_id, plus a digits-only variant of the phone so users
    // can type "6475550101" or "647-555-0101" interchangeably.
    const visibleCalls = useMemo<CallRowWithName[]>(() => {
        const q = search.trim().toLowerCase();
        if (!q) return calls;
        const digits = q.replace(/\D/g, '');
        return calls.filter((call) => {
            if (call.customer_name && call.customer_name.toLowerCase().includes(q)) return true;
            if (call.customer_id && call.customer_id.toLowerCase().includes(q)) return true;
            if (call.caller_phone) {
                if (call.caller_phone.toLowerCase().includes(q)) return true;
                if (digits.length >= 4 && call.caller_phone.replace(/\D/g, '').includes(digits)) return true;
            }
            return false;
        });
    }, [calls, search]);

    const upsellTotal = useMemo(() => {
        return visibleCalls.reduce((sum, call) => {
            const upsells = call.summary?.upsells_flagged ?? [];
            return sum + upsells.reduce((s, u) => s + (u.value_est ?? 0), 0);
        }, 0);
    }, [visibleCalls]);

    const pendingUpsellValue = useMemo(
        () => pendingUpsells.reduce((sum, row) => sum + (row.value_est ?? 0), 0),
        [pendingUpsells],
    );

    async function patchUpsell(id: string, status: 'accepted' | 'declined') {
        setUpsellActionFor(id);
        setUpsellError(null);
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
            setUpsellError(err instanceof Error ? err.message : 'Failed to update upsell');
        } finally {
            setUpsellActionFor(null);
        }
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        void load();
    }

    const linkedCustomerId = customerIdFilter.trim();

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
                        <Link href="/dashboard" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Dashboard</Link>
                        <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200">Calls</span>
                        <Link href="/customers" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Customers</Link>
                        <Link href="/analytics" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Analytics</Link>
                        <Link href="/service-desk" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Service desk</Link>
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
                        <p className="mt-2 text-3xl font-black text-white">{visibleCalls.length}</p>
                        {visibleCalls.length !== calls.length && (
                            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-zinc-500">of {calls.length} loaded</p>
                        )}
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
                        <p className={`mt-2 text-xl font-black ${persistence === 'supabase' ? 'text-emerald-300' : persistence === 'mock' ? 'text-sky-300' : 'text-amber-300'}`}>
                            {persistence === 'supabase' ? 'Supabase' : persistence === 'mock' ? 'Demo data' : 'Not configured'}
                        </p>
                    </div>
                </div>

                {linkedCustomerId && (
                    <div className="mb-4 flex items-center justify-between rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                        <span>
                            Showing calls for customer{' '}
                            <code className="rounded bg-red-500/20 px-1.5">{linkedCustomerId}</code>
                            {' '}only.
                        </span>
                        <button
                            type="button"
                            onClick={() => setCustomerIdFilter('')}
                            className="rounded-full border border-red-300/40 bg-red-500/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-red-100 transition hover:border-red-200 hover:text-white"
                        >
                            Clear customer filter
                        </button>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="mb-6 rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Search</span>
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="James Whitfield · +1 647… · sulaim@…"
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
                                className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500"
                            >
                                {loading ? 'Loading…' : 'Apply'}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setSearch('');
                                    setCustomerIdFilter('');
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

                <section className="mb-6 rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                    <header className="mb-4 flex items-end justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Upsell pipeline</p>
                            <h3 className="mt-2 text-xl font-black text-white">Aria-flagged opportunities</h3>
                        </div>
                        <div className="text-right">
                            <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">{pendingUpsells.length} pending</p>
                            <p className="text-lg font-black text-emerald-300">{formatCurrency(pendingUpsellValue)}</p>
                        </div>
                    </header>

                    {upsellError && (
                        <p className="mb-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{upsellError}</p>
                    )}
                    {upsellsLoading && pendingUpsells.length === 0 && (
                        <p className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-6 text-center text-sm text-zinc-400">
                            Loading pending upsells…
                        </p>
                    )}
                    {!upsellsLoading && pendingUpsells.length === 0 && (
                        <p className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-6 text-center text-sm text-zinc-400">
                            No pending upsells in this scope.
                        </p>
                    )}
                    <ul className="grid gap-3 lg:grid-cols-2">
                        {pendingUpsells.map((upsell) => {
                            const tier = normalizeCustomerTier(upsell.customer_tier);
                            return (
                                <li key={upsell.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-white">{upsell.upsell_type.replace(/_/g, ' ')}</p>
                                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                                                {tier ? (
                                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-[0.18em] ${TIER_STYLES[tier]}`}>
                                                        {tier}
                                                    </span>
                                                ) : (
                                                    <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-bold tracking-[0.18em] text-zinc-300">
                                                        Tier unknown
                                                    </span>
                                                )}
                                                <span>{formatCustomerPhone(upsell.customer_phone)}</span>
                                            </div>
                                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                                                <span>{upsell.vehicle_summary ?? 'Vehicle unavailable'}</span>
                                                <Link
                                                    href={`/customers/${encodeURIComponent(upsell.customer_id)}`}
                                                    className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-200 transition hover:border-red-500 hover:text-white"
                                                >
                                                    View profile
                                                </Link>
                                            </div>
                                            {upsell.description && <p className="mt-2 text-xs text-zinc-300">{upsell.description}</p>}
                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${UPSELL_STATUS_STYLES[upsell.status] ?? UPSELL_STATUS_STYLES.pending}`}>
                                                    {upsell.status}
                                                </span>
                                                <span className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">{formatDate(upsell.created_at)}</span>
                                            </div>
                                        </div>
                                        <p className="text-lg font-black text-emerald-300">{formatCurrency(upsell.value_est)}</p>
                                    </div>
                                    <div className="mt-3 flex gap-2">
                                        <button
                                            type="button"
                                            disabled={upsellActionFor === upsell.id}
                                            onClick={() => void patchUpsell(upsell.id, 'accepted')}
                                            className="flex-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                                        >
                                            Accept
                                        </button>
                                        <button
                                            type="button"
                                            disabled={upsellActionFor === upsell.id}
                                            onClick={() => void patchUpsell(upsell.id, 'declined')}
                                            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-50"
                                        >
                                            Decline
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </section>

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
                    <ul ref={listRef} className="space-y-3">
                        {loading && visibleCalls.length === 0 && (
                            <li className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900 px-5 py-8 text-center text-sm text-zinc-400">Loading…</li>
                        )}
                        {!loading && visibleCalls.length === 0 && (
                            <li className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900 px-5 py-8 text-center text-sm text-zinc-400">
                                {search ? `No calls match "${search}".` : 'No calls match these filters yet.'}
                            </li>
                        )}
                        {visibleCalls.map((call) => {
                            const outcome = call.summary?.outcome;
                            const sentiment = call.summary?.sentiment;
                            const isActive = selectedId === call.id;
                            const dataPending = isDataPending(call);
                            const phoneDisplay = (call.caller_phone ?? '').trim();
                            const phoneIsPlaceholder = !phoneDisplay || phoneDisplay.toLowerCase() === 'unknown';
                            return (
                                <li key={call.id}>
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        // Fix 6: clicking an already-selected row toggles
                                        // the detail panel closed.
                                        onClick={() => setSelectedId((prev) => (prev === call.id ? null : call.id))}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                setSelectedId((prev) => (prev === call.id ? null : call.id));
                                            }
                                        }}
                                        className={`w-full rounded-3xl border p-5 text-left transition cursor-pointer ${
                                            isActive
                                                ? 'border-red-500/60 bg-red-600/10 shadow-lg shadow-red-950/30'
                                                : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600'
                                        }`}
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                {call.customer_id ? (
                                                    <Link
                                                        href={`/customers/${encodeURIComponent(call.customer_id)}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="text-base font-black text-white transition hover:text-red-200"
                                                    >
                                                        {callerLabel(call)}
                                                    </Link>
                                                ) : (
                                                    <p className="text-base font-black text-white">{callerLabel(call)}</p>
                                                )}
                                                <p className="mt-0.5 text-xs text-zinc-500">
                                                    {phoneIsPlaceholder ? 'Phone unavailable' : phoneDisplay}
                                                </p>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                {dataPending && (
                                                    <span
                                                        title="Post-call webhook hasn't filled in the basics yet (phone, conversation id, or duration). Refresh in a moment."
                                                        className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] border-amber-500/40 bg-amber-500/10 text-amber-200"
                                                    >
                                                        ⚠ Data pending
                                                    </span>
                                                )}
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
                                    </div>
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
                            <section
                                ref={(node) => { detailRef.current = node; }}
                                className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400"
                            >
                                Loading call detail…
                            </section>
                        )}
                        {selectedId && !detailLoading && detail && (
                            <CallDetailPanel
                                detail={detail}
                                onClose={closeDetail}
                                containerRef={detailRef}
                            />
                        )}
                    </aside>
                </div>
            </section>
        </main>
    );
}

function CallDetailPanel({
    detail,
    onClose,
    containerRef,
}: {
    detail: CallDetailResponse;
    onClose: () => void;
    containerRef: React.MutableRefObject<HTMLElement | null>;
}) {
    const { call, appointments, upsells, loaner_requests } = detail;
    const callWithName = call as CallRowWithName;
    const summary = call.summary;
    const transcript = call.transcript ?? [];
    const callerHeader = callerLabel(callWithName);

    return (
        <div
            // Wrap in a section so the parent's click-away handler can match
            // any descendant. The ref points at this wrapper.
            ref={(node) => { containerRef.current = node; }}
            className="space-y-4"
        >
            <section className="relative rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                {/* Fix 6: explicit close button */}
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close call detail"
                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-sm font-bold text-zinc-400 transition hover:border-red-500 hover:text-white"
                >
                    ✕
                </button>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Call detail</p>
                {call.customer_id ? (
                    <Link
                        href={`/customers/${encodeURIComponent(call.customer_id)}`}
                        className="mt-2 inline-block pr-10 text-xl font-black text-white transition hover:text-red-200"
                    >
                        {callerHeader}
                    </Link>
                ) : (
                    <h3 className="mt-2 pr-10 text-xl font-black text-white">{callerHeader}</h3>
                )}
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
                    <span>{formatTime(call.started_at)}</span>
                    <span>·</span>
                    <span>{formatDurationSecs(call.duration_secs)}</span>
                    <span>·</span>
                    <span className="capitalize">{call.direction}</span>
                </div>
            </section>

            {/* ─── What the call was about ─── */}
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
                        No summary yet —{' '}
                        {call.status === 'in_progress'
                            ? 'call is still in progress, summary will appear once Aria hangs up.'
                            : 'Aria did not generate a summary for this call (either the post-call webhook hasn\u2019t fired yet or the summariser fell back to no-op).'}
                    </p>
                )}
            </section>

            {/* ─── Topics ─── */}
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

            {/* ─── Action items (checklist) ─── */}
            {summary && summary.action_items.length > 0 && (
                <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Action items</p>
                    <ul className="mt-3 space-y-2">
                        {summary.action_items.map((item) => (
                            <li
                                key={item}
                                className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                            >
                                <span
                                    aria-hidden="true"
                                    className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/50 bg-emerald-500/10 text-xs font-black text-emerald-300"
                                >
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
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <p className="font-bold">{appt.service_type}</p>
                                    {appt.vehicle_id && (
                                        <Link
                                            href={`/vehicles/${encodeURIComponent(appt.vehicle_id)}`}
                                            className="rounded-full border border-emerald-400/50 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-100 transition hover:border-emerald-200 hover:text-white"
                                        >
                                            View vehicle
                                        </Link>
                                    )}
                                </div>
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
                                <div className="mt-1 flex items-center justify-between gap-2">
                                    <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">{u.status}</p>
                                    {u.vehicle_id && (
                                        <Link
                                            href={`/vehicles/${encodeURIComponent(u.vehicle_id)}`}
                                            className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white"
                                        >
                                            View vehicle
                                        </Link>
                                    )}
                                </div>
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
