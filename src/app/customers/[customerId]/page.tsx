'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import type { CustomerDetailPayload } from '@/app/api/customers/[id]/route';

const TIER_STYLES: Record<string, string> = {
    Bronze: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
    Silver: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-200',
    Gold: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    Platinum: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200',
};

const OUTCOME_STYLES: Record<string, string> = {
    appointment_booked: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    upsell_flagged: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    issue_reported: 'border-red-500/40 bg-red-500/10 text-red-200',
    inquiry: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
    other: 'border-zinc-700 bg-zinc-950 text-zinc-300',
};

function formatCurrency(value: number | null | undefined) {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
}

function formatDate(iso: string | null | undefined) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return iso;
    }
}

function tomorrowIso(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

function addDaysIso(baseIso: string, days: number): string {
    const d = new Date(`${baseIso}T00:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

interface LoanerVehicleOption {
    id: string;
    make: string;
    model: string;
    year: number;
    color: string | null;
    is_available: boolean;
}

export default function CustomerDetailPage() {
    const params = useParams<{ customerId: string }>();
    const customerId = Array.isArray(params?.customerId) ? params.customerId[0] : params?.customerId ?? '';

    const [data, setData] = useState<CustomerDetailPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [loanerOpen, setLoanerOpen] = useState(false);
    const [loanerStartDate, setLoanerStartDate] = useState(() => tomorrowIso());
    const [loanerEndDate, setLoanerEndDate] = useState(() => addDaysIso(tomorrowIso(), 3));
    const [loanerVehicleId, setLoanerVehicleId] = useState('');
    const [availableLoaners, setAvailableLoaners] = useState<LoanerVehicleOption[]>([]);
    const [assignedLoanerId, setAssignedLoanerId] = useState('');
    const [loanerNotes, setLoanerNotes] = useState('');
    const [loanerBusy, setLoanerBusy] = useState(false);

    const load = useCallback(async () => {
        if (!customerId) return;
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/customers/${encodeURIComponent(customerId)}`, { cache: 'no-store' });
            const payload = (await response.json()) as CustomerDetailPayload | { error?: string };
            if (!response.ok) {
                setError((payload as { error?: string }).error ?? `HTTP ${response.status}`);
                setData(null);
                return;
            }
            setData(payload as CustomerDetailPayload);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load customer');
        } finally {
            setLoading(false);
        }
    }, [customerId]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!data?.vehicles?.length) return;
        setLoanerVehicleId((current) => current || data.vehicles[0].id);
    }, [data]);

    useEffect(() => {
        if (!loanerOpen || !loanerStartDate || !loanerEndDate) return;
        let cancelled = false;
        async function fetchAvailable() {
            try {
                const response = await fetch(
                    `/api/manager/loaners/vehicles?available_from=${encodeURIComponent(loanerStartDate)}&available_to=${encodeURIComponent(loanerEndDate)}`,
                    { cache: 'no-store' },
                );
                const payload = (await response.json()) as { vehicles?: LoanerVehicleOption[]; error?: string };
                if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
                if (!cancelled) {
                    setAvailableLoaners(payload.vehicles ?? []);
                    setAssignedLoanerId('');
                }
            } catch (err) {
                if (!cancelled) {
                    setAvailableLoaners([]);
                    setToast({
                        type: 'error',
                        message: err instanceof Error ? err.message : 'Could not load available loaners',
                    });
                }
            }
        }
        void fetchAvailable();
        return () => {
            cancelled = true;
        };
    }, [loanerEndDate, loanerOpen, loanerStartDate]);

    function showToast(next: { type: 'success' | 'error'; message: string }) {
        setToast(next);
        window.setTimeout(() => setToast(null), 2800);
    }

    async function submitLoanerRequest() {
        if (!data) return;
        if (!loanerVehicleId) {
            showToast({ type: 'error', message: 'Please select a customer vehicle.' });
            return;
        }
        setLoanerBusy(true);
        try {
            const response = await fetch('/api/loaner-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer_id: data.customer.id,
                    dealer_id: data.dealer.id,
                    vehicle_id: loanerVehicleId,
                    loaner_vehicle_id: assignedLoanerId || null,
                    start_date: loanerStartDate,
                    end_date: loanerEndDate,
                    notes: loanerNotes.trim() || null,
                }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
            setLoanerOpen(false);
            setLoanerNotes('');
            setAssignedLoanerId('');
            showToast({ type: 'success', message: 'Loaner request submitted — service desk will confirm' });
        } catch (err) {
            showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to submit loaner request' });
        } finally {
            setLoanerBusy(false);
        }
    }

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            {toast && (
                <div className={`fixed right-4 top-4 z-50 rounded-xl border px-4 py-3 text-sm shadow-xl ${
                    toast.type === 'success'
                        ? 'border-emerald-500/50 bg-emerald-600/20 text-emerald-100'
                        : 'border-red-500/50 bg-red-600/20 text-red-100'
                }`}>
                    {toast.message}
                </div>
            )}
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100 shadow-lg shadow-red-950/30">PL</div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Customer profile</p>
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

            <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
                {loading && !data && (
                    <div className="rounded-3xl border border-dashed border-zinc-800 bg-zinc-900 px-6 py-12 text-center text-sm text-zinc-400">
                        Loading customer…
                    </div>
                )}

                {error && (
                    <div className="rounded-3xl border border-red-500/40 bg-red-500/10 px-6 py-8 text-sm text-red-100">
                        <p className="font-bold">Could not load customer {customerId}</p>
                        <p className="mt-2">{error}</p>
                        <Link
                            href="/customers"
                            className="mt-4 inline-block text-xs font-bold uppercase tracking-[0.22em] text-red-300 hover:text-red-200"
                        >
                            ← Back to all customers
                        </Link>
                    </div>
                )}

                {data && (
                    <>
                        <Link
                            href="/customers"
                            className="mb-6 inline-block text-xs font-bold uppercase tracking-[0.22em] text-zinc-500 transition hover:text-zinc-200"
                        >
                            ← All customers
                        </Link>

                        <CustomerHeader
                            data={data}
                            onRequestLoaner={() => {
                                const start = tomorrowIso();
                                setLoanerStartDate(start);
                                setLoanerEndDate(addDaysIso(start, 3));
                                setLoanerVehicleId(data.vehicles[0]?.id ?? '');
                                setLoanerOpen(true);
                            }}
                        />

                        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                            <VehiclesPanel data={data} />
                            <SidebarPanel data={data} />
                        </div>
                    </>
                )}
            </section>

            {loanerOpen && data && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
                    <div className="w-full max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl shadow-black/50">
                        <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Loaner request</p>
                                <h3 className="mt-1 text-2xl font-black text-white">Request Loaner</h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setLoanerOpen(false)}
                                className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white"
                            >
                                Close
                            </button>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                            <label className="flex flex-col gap-1 text-xs text-zinc-500">
                                Customer
                                <input
                                    value={data.customer.name}
                                    readOnly
                                    className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300"
                                />
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-zinc-500">
                                Vehicle
                                <select
                                    value={loanerVehicleId}
                                    onChange={(e) => setLoanerVehicleId(e.target.value)}
                                    className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                                >
                                    {data.vehicles.map((vehicle) => (
                                        <option key={vehicle.id} value={vehicle.id}>
                                            {vehicle.year} {vehicle.make} {vehicle.model}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-zinc-500">
                                Start date
                                <input
                                    type="date"
                                    value={loanerStartDate}
                                    onChange={(e) => {
                                        const next = e.target.value;
                                        setLoanerStartDate(next);
                                        if (loanerEndDate < next) setLoanerEndDate(addDaysIso(next, 3));
                                    }}
                                    className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                                />
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-zinc-500">
                                Est. return date
                                <input
                                    type="date"
                                    value={loanerEndDate}
                                    onChange={(e) => setLoanerEndDate(e.target.value)}
                                    className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                                />
                            </label>
                        </div>

                        <label className="mt-3 flex flex-col gap-1 text-xs text-zinc-500">
                            Available loaner
                            <select
                                value={assignedLoanerId}
                                onChange={(e) => setAssignedLoanerId(e.target.value)}
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            >
                                <option value="">Vehicle will be assigned by service team</option>
                                {availableLoaners.map((vehicle) => (
                                    <option key={vehicle.id} value={vehicle.id}>
                                        {vehicle.year} {vehicle.make} {vehicle.model}
                                        {vehicle.color ? ` · ${vehicle.color}` : ''}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="mt-3 flex flex-col gap-1 text-xs text-zinc-500">
                            Notes
                            <textarea
                                value={loanerNotes}
                                onChange={(e) => setLoanerNotes(e.target.value)}
                                rows={3}
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            />
                        </label>

                        <button
                            type="button"
                            onClick={() => void submitLoanerRequest()}
                            disabled={loanerBusy}
                            className="mt-4 rounded-2xl bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:opacity-60"
                        >
                            {loanerBusy ? 'Submitting…' : 'Submit Request'}
                        </button>
                    </div>
                </div>
            )}
        </main>
    );
}

function CustomerHeader({ data, onRequestLoaner }: { data: CustomerDetailPayload; onRequestLoaner?: () => void }) {
    const c = data.customer;
    return (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl shadow-black/25">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Customer profile</p>
                    <h2 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">{c.name}</h2>
                    <div className="mt-4 flex flex-wrap gap-3 text-sm text-zinc-300">
                        <span className="rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2">{c.phone}</span>
                        <span className="rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2">{c.email}</span>
                        <span className="rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2">Customer since {c.customerSinceYear}</span>
                        <span className={`rounded-full border px-4 py-2 font-bold uppercase tracking-[0.18em] text-xs ${TIER_STYLES[c.loyaltyTier]}`}>{c.loyaltyTier}</span>
                    </div>
                    {c.notes && (
                        <p className="mt-4 max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm leading-6 text-zinc-300">
                            {c.notes}
                        </p>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:min-w-[360px]">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Lifetime visits</p>
                        <p className="mt-2 text-2xl font-black text-white">{c.lifetimeVisits}</p>
                    </div>
                    <div className="rounded-2xl border border-red-500/40 bg-red-600/10 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Lifetime spend</p>
                        <p className="mt-2 text-2xl font-black text-red-300">{formatCurrency(c.lifetimeSpend)}</p>
                    </div>
                </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
                <Link
                    href={`/calls?customer_id=${encodeURIComponent(c.id)}`}
                    className="rounded-2xl border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-red-200 transition hover:border-red-400 hover:bg-red-600/25 hover:text-white"
                >
                    View full call history →
                </Link>
                <button
                    type="button"
                    onClick={onRequestLoaner}
                    className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-zinc-200 transition hover:border-red-500 hover:text-white"
                >
                    Request Loaner
                </button>
                <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">
                    {data.recent_calls.length} call{data.recent_calls.length === 1 ? '' : 's'} from {data.persistence === 'supabase' ? 'Supabase' : 'mock'}
                </span>
            </div>
        </section>
    );
}

function VehiclesPanel({ data }: { data: CustomerDetailPayload }) {
    return (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
            <header className="mb-4 flex items-end justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Vehicles on file</p>
                    <h3 className="mt-2 text-xl font-black text-white">{data.vehicles.length} vehicle{data.vehicles.length === 1 ? '' : 's'}</h3>
                </div>
                {data.last_service_date && (
                    <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300">
                        Last service {formatDate(data.last_service_date)}
                    </span>
                )}
            </header>

            {data.vehicles.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-6 text-center text-sm text-zinc-400">
                    No vehicles on file for this customer yet.
                </p>
            ) : (
                <ul className="space-y-3">
                    {data.vehicles.map((v) => (
                        <li key={v.id}>
                            <Link
                                href={`/vehicles/${encodeURIComponent(v.id)}`}
                                className="block rounded-2xl border border-zinc-800 bg-zinc-950 p-4 transition hover:border-red-500/40 hover:bg-zinc-900"
                            >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-black text-white">
                                            {v.year} {v.make} {v.model}
                                            {v.trim ? ` ${v.trim}` : ''}
                                        </p>
                                        <p className="mt-0.5 text-xs text-zinc-500">
                                            VIN …{v.vin.slice(-8)} · {v.mileage.toLocaleString('en-CA')} km · {v.color ?? '—'}
                                        </p>
                                    </div>
                                    <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300">
                                        Open
                                    </span>
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {data.open_ros.length > 0 && (
                <div className="mt-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Open repair orders</p>
                    <ul className="mt-3 space-y-2">
                        {data.open_ros.map((ro) => (
                            <li key={ro.ro_number} className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-bold">{ro.service_type}</span>
                                    <span className="text-[10px] uppercase tracking-[0.18em] text-amber-200">{ro.status.replace(/_/g, ' ')}</span>
                                </div>
                                <p className="mt-1 text-amber-100/80">{ro.summary}</p>
                                <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-amber-300">
                                    {ro.ro_number} · {formatDate(ro.date)}
                                    {ro.advisor_name ? ` · ${ro.advisor_name}` : ''}
                                </p>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}

function SidebarPanel({ data }: { data: CustomerDetailPayload }) {
    return (
        <aside className="space-y-6">
            <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Recent calls</p>
                <h3 className="mt-2 text-xl font-black text-white">Aria conversations</h3>

                {data.recent_calls.length === 0 ? (
                    <p className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-6 text-center text-sm text-zinc-400">
                        {data.persistence === 'supabase'
                            ? 'No calls recorded for this customer yet.'
                            : 'Supabase is not configured. Calls will appear here once it is wired up.'}
                    </p>
                ) : (
                    <ul className="mt-4 space-y-2">
                        {data.recent_calls.map((call) => (
                            <li key={call.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs text-zinc-300">{formatDate(call.started_at)}</span>
                                    {call.summary?.outcome && (
                                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${OUTCOME_STYLES[call.summary.outcome] ?? OUTCOME_STYLES.other}`}>
                                            {call.summary.outcome.replace(/_/g, ' ')}
                                        </span>
                                    )}
                                </div>
                                {call.summary?.summary_text && (
                                    <p className="mt-2 line-clamp-2 text-xs text-zinc-300">{call.summary.summary_text}</p>
                                )}
                                <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                                    {call.duration_secs ? `${call.duration_secs}s` : '—'} · {call.direction}
                                </p>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Contact</p>
                <dl className="mt-4 space-y-3 text-sm">
                    <div>
                        <dt className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Address</dt>
                        <dd className="mt-1 text-zinc-200">
                            {data.customer.address ?? '—'}
                            {data.customer.city && data.customer.province ? (
                                <span className="block text-xs text-zinc-400">
                                    {data.customer.city}, {data.customer.province} {data.customer.postalCode ?? ''}
                                </span>
                            ) : null}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Preferred language</dt>
                        <dd className="mt-1 text-zinc-200">{data.customer.preferredLanguage === 'fr' ? 'Français' : 'English'}</dd>
                    </div>
                    {data.customer.altPhone && (
                        <div>
                            <dt className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Alternate phone</dt>
                            <dd className="mt-1 text-zinc-200">{data.customer.altPhone}</dd>
                        </div>
                    )}
                </dl>
            </section>
        </aside>
    );
}
