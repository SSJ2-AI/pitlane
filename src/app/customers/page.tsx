'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminNavLink } from '@/components/AdminNavLink';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import type { CustomerListRow } from '@/app/api/customers/route';

type LoyaltyTier = CustomerListRow['loyalty_tier'];

type SortKey =
    | 'overdue'
    | 'last_service'
    | 'lifetime_spend'
    | 'loaner_requests'
    | 'last_call';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
    { value: 'overdue', label: 'Overdue for service' },
    { value: 'last_service', label: 'Last service (recent)' },
    { value: 'lifetime_spend', label: 'Lifetime spend' },
    { value: 'loaner_requests', label: 'Open loaner requests' },
    { value: 'last_call', label: 'Last call (recent)' },
];

const TIER_STYLES: Record<LoyaltyTier, string> = {
    Bronze: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
    Silver: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-200',
    Gold: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    Platinum: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200',
};

interface CustomersListResponse {
    customers: CustomerListRow[];
    total: number;
    dealer: { id: string; name: string };
    persistence: 'supabase' | 'mock';
}

function formatCurrency(n: number) {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
}

function formatRelativeDate(iso: string | null) {
    if (!iso) return '—';
    try {
        const date = new Date(iso);
        const today = new Date();
        const diffDays = Math.floor((today.getTime() - date.getTime()) / 86_400_000);
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays}d ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
        return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return iso;
    }
}

const OUTCOME_STYLES: Record<string, string> = {
    appointment_booked: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    upsell_flagged: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    issue_reported: 'border-red-500/40 bg-red-500/10 text-red-200',
    inquiry: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
    other: 'border-zinc-700 bg-zinc-950 text-zinc-300',
};

export default function CustomersPage() {
    const [data, setData] = useState<CustomersListResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState<SortKey>('overdue');

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/customers', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = (await response.json()) as CustomersListResponse;
            setData(payload);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load customers');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const filtered = useMemo(() => {
        if (!data) return [] as CustomerListRow[];
        const q = search.trim().toLowerCase();
        const base = !q
            ? data.customers
            : data.customers.filter(
                  (c) =>
                      c.name.toLowerCase().includes(q) ||
                      c.phone.includes(q) ||
                      c.email.toLowerCase().includes(q),
              );
        return sortCustomers(base, sortBy);
    }, [data, search, sortBy]);

    const overdueCount = useMemo(
        () => (data?.customers ?? []).filter((c) => c.is_service_overdue).length,
        [data],
    );

    const totalSpend = useMemo(
        () => (data?.customers ?? []).reduce((sum, c) => sum + c.lifetime_spend, 0),
        [data],
    );

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100 shadow-lg shadow-red-950/30">PL</div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Customer directory</p>
                        </div>
                    </Link>
                    <nav className="flex flex-wrap items-center gap-3">
                        <VoiceStatusDot />
                        <Link href="/dashboard" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Dashboard</Link>
                        <Link href="/calls" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Calls</Link>
                        <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200">Customers</span>
                        <Link href="/analytics" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Analytics</Link>
                        <Link href="/service-desk" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Service desk</Link>
                        <AdminNavLink />
                    </nav>
                </div>
            </header>

            <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
                <div className="mb-6 flex flex-col gap-2">
                    <p className="text-sm font-semibold uppercase tracking-[0.4em] text-red-400">Directory</p>
                    <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">All customers</h2>
                    <p className="max-w-3xl text-base leading-7 text-zinc-400">
                        Every customer Aria can identify by phone. Click a row to see only their calls,
                        or jump straight to their primary vehicle.
                    </p>
                </div>

                <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard label="Total customers" value={data ? String(data.total) : '—'} />
                    <StatCard
                        label="Lifetime spend"
                        value={data ? formatCurrency(totalSpend) : '—'}
                        accent="emerald"
                    />
                    <StatCard
                        label="Service overdue"
                        value={data ? String(overdueCount) : '—'}
                        accent={overdueCount > 0 ? 'amber' : undefined}
                    />
                    <StatCard
                        label="Dealer"
                        value={data ? data.dealer.name : '—'}
                    />
                </div>

                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name, phone, or email…"
                        className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500 sm:max-w-md"
                    />
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">
                            {filtered.length} of {data?.customers.length ?? 0} matching
                        </span>
                        <label className="flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Sort by</span>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as SortKey)}
                                className="rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            >
                                {SORT_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                </div>

                {error && (
                    <div className="mb-6 rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-100">{error}</div>
                )}

                {loading && !data && (
                    <div className="space-y-3 animate-pulse">
                        {[0, 1, 2, 3].map((i) => (
                            <div key={i} className="h-24 rounded-2xl border border-zinc-800 bg-zinc-900" />
                        ))}
                    </div>
                )}

                {data && (
                    <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900">
                        <table className="w-full text-left text-sm">
                            <thead className="border-b border-zinc-800 bg-zinc-950/60 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                                <tr>
                                    <th className="px-4 py-3 font-semibold">Customer</th>
                                    <th className="px-4 py-3 font-semibold">Phone</th>
                                    <th className="px-4 py-3 font-semibold">Tier</th>
                                    <th className="px-4 py-3 font-semibold">Vehicles</th>
                                    <th className="px-4 py-3 font-semibold">Open ROs</th>
                                    <th className="px-4 py-3 font-semibold">Last call</th>
                                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-10 text-center text-sm text-zinc-500">
                                            {search ? `No customers match "${search}"` : 'No customers on file.'}
                                        </td>
                                    </tr>
                                ) : (
                                    filtered.map((c) => (
                                        <tr
                                            key={c.id}
                                            className="border-b border-zinc-800/60 transition last:border-b-0 hover:bg-zinc-950/40"
                                        >
                                            <td className="px-4 py-4">
                                                <Link
                                                    href={`/customers/${encodeURIComponent(c.id)}`}
                                                    className="block min-w-0"
                                                >
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="truncate text-sm font-black text-white transition hover:text-red-200">{c.name}</p>
                                                        {c.is_service_overdue && (
                                                            <span className="rounded-full border border-orange-500/50 bg-orange-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-orange-200">
                                                                Service overdue
                                                            </span>
                                                        )}
                                                        {c.has_open_loaner_request && (
                                                            <span className="rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-red-200">
                                                                Loaner requested
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="mt-0.5 truncate text-xs text-zinc-500">{c.email}</p>
                                                </Link>
                                            </td>
                                            <td className="px-4 py-4 text-zinc-300">{c.phone}</td>
                                            <td className="px-4 py-4">
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${TIER_STYLES[c.loyalty_tier]}`}>
                                                    {c.loyalty_tier}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-base font-black text-white">{c.vehicles.length}</span>
                                                {c.vehicles.length > 0 && (
                                                    <p className="mt-0.5 text-[11px] text-zinc-500">
                                                        {c.vehicles
                                                            .slice(0, 2)
                                                            .map((v) => `${v.year} ${v.model}`)
                                                            .join(', ')}
                                                        {c.vehicles.length > 2 && ` +${c.vehicles.length - 2}`}
                                                    </p>
                                                )}
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className={`text-base font-black ${c.open_ros_count > 0 ? 'text-amber-300' : 'text-zinc-400'}`}>
                                                    {c.open_ros_count}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4">
                                                {c.last_call ? (
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-xs text-zinc-200">{formatRelativeDate(c.last_call.date)}</span>
                                                        {c.last_call.outcome && (
                                                            <span className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${OUTCOME_STYLES[c.last_call.outcome] ?? OUTCOME_STYLES.other}`}>
                                                                {c.last_call.outcome.replace(/_/g, ' ')}
                                                            </span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-zinc-500">No calls yet</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-4 text-right">
                                                <div className="flex flex-wrap justify-end gap-2">
                                                    <Link
                                                        href={`/calls?customer_id=${encodeURIComponent(c.id)}`}
                                                        className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white"
                                                    >
                                                        View calls
                                                    </Link>
                                                    {c.vehicles[0] && (
                                                        <Link
                                                            href={`/vehicles/${encodeURIComponent(c.vehicles[0].id)}`}
                                                            className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white"
                                                        >
                                                            View vehicles
                                                        </Link>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </main>
    );
}

function sortCustomers(rows: CustomerListRow[], sortBy: SortKey): CustomerListRow[] {
    const copy = [...rows];
    switch (sortBy) {
        case 'overdue':
            // Overdue customers first, then by oldest last_service_date so the
            // "most stale" advisor-action customer floats to the top.
            return copy.sort((a, b) => {
                if (a.is_service_overdue !== b.is_service_overdue) return a.is_service_overdue ? -1 : 1;
                return compareIsoDateAsc(a.last_service_date, b.last_service_date);
            });
        case 'last_service':
            // Most recent service first; nulls (never serviced) sink to bottom.
            return copy.sort((a, b) => compareIsoDateDesc(a.last_service_date, b.last_service_date));
        case 'lifetime_spend':
            return copy.sort((a, b) => b.lifetime_spend - a.lifetime_spend);
        case 'loaner_requests':
            // Loaner-flagged first, secondary by last_call recency so the same
            // customer doesn't sit at the top forever once handled.
            return copy.sort((a, b) => {
                if (a.has_open_loaner_request !== b.has_open_loaner_request) return a.has_open_loaner_request ? -1 : 1;
                return compareIsoDateDesc(a.last_call?.date ?? null, b.last_call?.date ?? null);
            });
        case 'last_call':
            return copy.sort((a, b) => compareIsoDateDesc(a.last_call?.date ?? null, b.last_call?.date ?? null));
        default:
            return copy;
    }
}

// `null` sorts after real dates in both directions — a customer with no
// service / no call history shouldn't be presented as more or less recent
// than someone with a real date.
function compareIsoDateDesc(a: string | null, b: string | null) {
    if (a === b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a < b ? 1 : -1;
}
function compareIsoDateAsc(a: string | null, b: string | null) {
    if (a === b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a < b ? -1 : 1;
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'emerald' | 'amber' }) {
    return (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">{label}</p>
            <p
                className={`mt-2 text-2xl font-black ${
                    accent === 'emerald'
                        ? 'text-emerald-300'
                        : accent === 'amber'
                        ? 'text-amber-300'
                        : 'text-white'
                }`}
            >
                {value}
            </p>
        </div>
    );
}
