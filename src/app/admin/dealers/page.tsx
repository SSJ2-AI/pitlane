'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
    FormEvent,
    Suspense,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import type { DealerListRow } from '@/lib/mock-dealers';

// /admin/dealers — PitLane admin onboarding portal (Fix 3, Phase 10).
//
// Visible to anyone, but the "Add dealer" button + the admin nav link are
// guarded behind ?admin=true so a casual visitor doesn't see write
// affordances. Hard-auth (role-based) is planned for Phase 11.

interface DealersResponse {
    dealers: DealerListRow[];
    persistence: 'supabase' | 'mock';
}

const STATUS_PILL: Record<DealerListRow['status'], string> = {
    live: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    mock: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
    offline: 'border-zinc-700 bg-zinc-950 text-zinc-300',
};

const ARIA_PILL: Record<DealerListRow['aria_status'], string> = {
    live: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    training: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    offline: 'border-zinc-700 bg-zinc-950 text-zinc-300',
};

const STATUS_LABEL: Record<DealerListRow['status'], string> = {
    live: 'Live CDK',
    mock: 'Mock',
    offline: 'Offline',
};

export default function AdminDealersPage() {
    return (
        <Suspense fallback={<AdminDealersFallback />}>
            <AdminDealersInner />
        </Suspense>
    );
}

function AdminDealersFallback() {
    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <div className="mx-auto max-w-7xl px-5 py-16 text-center text-sm text-zinc-400 lg:px-8">Loading admin console…</div>
        </main>
    );
}

function AdminDealersInner() {
    const searchParams = useSearchParams();
    const isAdmin = searchParams.get('admin') === 'true';

    const [data, setData] = useState<DealersResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [showAddModal, setShowAddModal] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await fetch('/api/admin/dealers', { cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const payload = (await r.json()) as DealersResponse;
            setData(payload);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load dealers');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!toast) return;
        const t = window.setTimeout(() => setToast(null), 4_000);
        return () => window.clearTimeout(t);
    }, [toast]);

    const persistenceBadge = useMemo(() => {
        if (!data) return { label: 'Loading…', cls: 'border-zinc-700 bg-zinc-950 text-zinc-300' };
        return data.persistence === 'supabase'
            ? { label: 'Powered by Supabase', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' }
            : { label: 'Demo data', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-200' };
    }, [data]);

    const adminQuery = isAdmin ? '?admin=true' : '';

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <Link href={`/dashboard${adminQuery}`} className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100 shadow-lg shadow-red-950/30">PL</div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Admin console</p>
                        </div>
                    </Link>
                    <nav className="flex flex-wrap items-center gap-3">
                        <VoiceStatusDot />
                        <Link href={`/dashboard${adminQuery}`} className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Dashboard</Link>
                        <Link href={`/calls${adminQuery}`} className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Calls</Link>
                        <Link href={`/customers${adminQuery}`} className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Customers</Link>
                        <Link href={`/analytics${adminQuery}`} className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Analytics</Link>
                        <Link href={`/service-desk${adminQuery}`} className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Service desk</Link>
                        {isAdmin && (
                            <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200">Admin</span>
                        )}
                    </nav>
                </div>
            </header>

            <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
                <div className="mb-6 flex flex-col gap-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.4em] text-red-400">Dealer roster</p>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Dealerships</h2>
                        <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${persistenceBadge.cls}`}>
                            {persistenceBadge.label}
                        </span>
                    </div>
                    <p className="max-w-3xl text-base leading-7 text-zinc-400">
                        Every dealership PitLane serves. Aria persona, CDK connectivity, and Twilio phone number per rooftop —
                        plus the one-click onboarding that provisions a new dealer in seconds.
                    </p>
                </div>

                {!isAdmin && (
                    <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-100">
                        Read-only view. Append <code className="rounded bg-amber-500/20 px-1.5">?admin=true</code> to the URL to enable the &ldquo;Add dealer&rdquo; flow.
                    </div>
                )}

                {error && (
                    <div className="mb-6 rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-100">{error}</div>
                )}

                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">
                        {data?.dealers.length ?? 0} dealer{data?.dealers.length === 1 ? '' : 's'}
                    </span>
                    {isAdmin && (
                        <button
                            type="button"
                            onClick={() => setShowAddModal(true)}
                            className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500"
                        >
                            + Add dealer
                        </button>
                    )}
                </div>

                {loading && !data && (
                    <div className="space-y-3 animate-pulse">
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="h-20 rounded-2xl border border-zinc-800 bg-zinc-900" />
                        ))}
                    </div>
                )}

                {data && (
                    <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900">
                        <table className="w-full text-left text-sm">
                            <thead className="border-b border-zinc-800 bg-zinc-950/60 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                                <tr>
                                    <th className="px-4 py-3 font-semibold">Dealer</th>
                                    <th className="px-4 py-3 font-semibold">Brand</th>
                                    <th className="px-4 py-3 font-semibold">Phone</th>
                                    <th className="px-4 py-3 font-semibold">Status</th>
                                    <th className="px-4 py-3 font-semibold">Aria</th>
                                    <th className="px-4 py-3 font-semibold">Subdomain</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.dealers.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-500">
                                            No dealers on file. Use &ldquo;Add dealer&rdquo; to onboard the first rooftop.
                                        </td>
                                    </tr>
                                ) : (
                                    data.dealers.map((d) => (
                                        <tr key={d.id} className="border-b border-zinc-800/60 transition last:border-b-0 hover:bg-zinc-950/40">
                                            <td className="px-4 py-4">
                                                <p className="text-sm font-black text-white">{d.name}</p>
                                                <p className="mt-0.5 text-xs text-zinc-500">{d.location}</p>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-200">
                                                    {d.brand}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 text-zinc-300">{d.phone_number ?? '—'}</td>
                                            <td className="px-4 py-4">
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${STATUS_PILL[d.status]}`}>
                                                    {STATUS_LABEL[d.status]}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex flex-col gap-1">
                                                    <span className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${ARIA_PILL[d.aria_status]}`}>
                                                        {d.aria_status}
                                                    </span>
                                                    {d.aria_persona && (
                                                        <span className="text-[10px] text-zinc-500">{d.aria_persona}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <code className="text-xs text-zinc-400">{d.subdomain ?? '—'}</code>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {showAddModal && isAdmin && (
                <AddDealerModal
                    onClose={() => setShowAddModal(false)}
                    onCreated={(dealer) => {
                        setData((current) =>
                            current ? { ...current, dealers: [...current.dealers, dealer] } : current,
                        );
                        setToast(`Onboarded ${dealer.name}.`);
                        setShowAddModal(false);
                    }}
                />
            )}

            {toast && (
                <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
                    <div className="pointer-events-auto rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-3 text-sm font-semibold text-emerald-100 shadow-2xl shadow-black/40">
                        {toast}
                    </div>
                </div>
            )}
        </main>
    );
}

interface AddDealerModalProps {
    onClose: () => void;
    onCreated: (dealer: DealerListRow) => void;
}

function AddDealerModal({ onClose, onCreated }: AddDealerModalProps) {
    const [name, setName] = useState('');
    const [brand, setBrand] = useState('porsche');
    const [subscriptionId, setSubscriptionId] = useState('');
    const [phone, setPhone] = useState('');
    const [persona, setPersona] = useState('Aria');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        if (!name.trim() || !brand.trim()) {
            setError('Dealer name and brand are required.');
            return;
        }
        setSubmitting(true);
        try {
            const response = await fetch('/api/admin/dealers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    brand: brand.trim().toLowerCase(),
                    fortellis_subscription_id: subscriptionId.trim() || null,
                    phone_number: phone.trim() || null,
                    aria_persona: persona.trim() || 'Aria',
                }),
            });
            const payload = (await response.json()) as { dealer?: DealerListRow; error?: string };
            if (!response.ok || !payload.dealer) {
                throw new Error(payload.error ?? `HTTP ${response.status}`);
            }
            onCreated(payload.dealer);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create dealer');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-dealer-title"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl shadow-black/50"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-5 flex items-start justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-red-400">Onboard a rooftop</p>
                        <h3 id="add-dealer-title" className="mt-2 text-2xl font-black text-white">Add dealer</h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                    >
                        Close
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Dealer name *</span>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Porsche Calgary"
                            className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
                            required
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Brand *</span>
                        <select
                            value={brand}
                            onChange={(e) => setBrand(e.target.value)}
                            className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                        >
                            <option value="porsche">Porsche</option>
                            <option value="audi">Audi</option>
                            <option value="bmw">BMW</option>
                            <option value="mercedes">Mercedes-Benz</option>
                            <option value="lexus">Lexus</option>
                            <option value="other">Other</option>
                        </select>
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">CDK Subscription-Id</span>
                        <input
                            value={subscriptionId}
                            onChange={(e) => setSubscriptionId(e.target.value)}
                            placeholder="abcd-1234-…"
                            className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-mono text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Twilio phone number</span>
                        <input
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="+1 587 555 0100"
                            inputMode="tel"
                            className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Aria persona name</span>
                        <input
                            value={persona}
                            onChange={(e) => setPersona(e.target.value)}
                            placeholder="Aria"
                            className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
                        />
                    </label>

                    {error && (
                        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>
                    )}

                    <div className="mt-2 flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-900 disabled:text-zinc-400"
                        >
                            {submitting ? 'Onboarding…' : 'Onboard dealer'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
