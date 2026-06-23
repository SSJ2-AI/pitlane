'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CallHistory } from '@/components/CallHistory';
import { CustomerUpsellsPanel } from '@/components/CustomerUpsellsPanel';
import { OutboundCallButton } from '@/components/OutboundCallButton';
import { TodaysAppointmentsPanel } from '@/components/TodaysAppointmentsPanel';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import { WarrantyBadge } from '@/components/WarrantyBadge';
import { useVoice } from '@/providers/VoiceProvider';

type DeclinedService = {
    service: string;
    cost: number;
    note: string;
};

type ServiceHistory = {
    id: string;
    date: string;
    services: string[];
    techName: string;
    cost: number;
    declined: DeclinedService[];
};

type Recall = {
    campaign: string;
    component: string;
    summary: string;
    remedy: string;
};

type RepairOrder = {
    id: string;
    number: string;
    status: string;
    service: string;
    advisorName: string;
};

type Vehicle = {
    id: string;
    year: number;
    make: string;
    model: string;
    vin: string;
    color: string;
    mileageKm: number;
    serviceHistory: ServiceHistory[];
    recalls: Recall[];
};

type LookupData = {
    customer: {
        id?: string;
        name: string;
        phone: string;
        email: string;
        customerSinceYear: number;
        loyaltyTier?: string;
        lifetimeVisits: number;
        lifetimeSpend: number;
        advisorNote?: string;
    };
    vehicles: Vehicle[];
    shopStatus: {
        capacityPercent: number;
        estimatedWaitMinutes: number;
        technicians: number;
        openRepairOrders: number;
    };
    nextAppointment: {
        date: string;
        time: string;
        services: string[];
        advisorName?: string;
    };
    openRepairOrders?: RepairOrder[];
};

const notFoundMessage = 'No customer found for this number - this may be a new customer.';

function formatCurrency(value: number) {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value: number) {
    return new Intl.NumberFormat('en-CA').format(value);
}

function getCapacityColor(capacity: number) {
    if (capacity > 80) return { bar: 'bg-red-600', text: 'text-red-300', pill: 'border-red-500/40 bg-red-500/10 text-red-200' };
    if (capacity >= 60) return { bar: 'bg-amber-500', text: 'text-amber-300', pill: 'border-amber-500/40 bg-amber-500/10 text-amber-200' };
    return { bar: 'bg-emerald-500', text: 'text-emerald-300', pill: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' };
}

function vinTail(vin: string) { return vin.slice(-8); }

export default function DashboardPage() {
    const [phone, setPhone] = useState('');
    const [data, setData] = useState<LookupData | null>(null);
    const [activeVehicleId, setActiveVehicleId] = useState<string | null>(null);
    const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
    const [message, setMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { incomingCall } = useVoice();
    const lastAutoLoadedCallId = useRef<string | null>(null);

    const activeVehicle = useMemo(() => {
        if (!data) return null;
        return data.vehicles.find((v) => v.id === activeVehicleId) ?? data.vehicles[0];
    }, [activeVehicleId, data]);

    const customerYears = data ? new Date().getFullYear() - data.customer.customerSinceYear : 0;
    const hasDashboard = Boolean(data && activeVehicle);

    const runLookup = useCallback(async (lookupPhone: string) => {
        if (!lookupPhone || lookupPhone.replace(/\D/g, '').length < 10) {
            setMessage(notFoundMessage);
            setData(null);
            setActiveVehicleId(null);
            return;
        }
        setIsLoading(true);
        setMessage('');
        try {
            const response = await fetch('/api/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: lookupPhone }),
            });
            const payload = await response.json();
            if (!response.ok || !payload?.customer) {
                setData(null);
                setActiveVehicleId(null);
                setMessage(payload?.message ?? notFoundMessage);
                return;
            }
            setData(payload);
            setActiveVehicleId(payload.vehicles?.[0]?.id ?? null);
            setExpandedRows({});
        } catch {
            setData(null);
            setActiveVehicleId(null);
            setMessage('Lookup is temporarily unavailable. Please try again.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        await runLookup(phone);
    }

    // When Aria identifies a caller, auto-load that customer into the dashboard
    // so the advisor sees the same person Aria is talking to.
    useEffect(() => {
        if (!incomingCall) return;
        const callId = incomingCall.callId;
        const incomingPhone = incomingCall.caller?.phone ?? incomingCall.caller?.customer?.phone;
        if (!incomingPhone) return;
        if (callId && lastAutoLoadedCallId.current === callId) return;
        lastAutoLoadedCallId.current = callId ?? null;
        setPhone(incomingPhone);
        void runLookup(incomingPhone);
    }, [incomingCall, runLookup]);

    function toggleHistoryRow(id: string) {
        setExpandedRows((current) => ({ ...current, [id]: !current[id] }));
    }

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100 shadow-lg shadow-red-950/30">PL</div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Porsche service desk</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <VoiceStatusDot />
                        <Link
                            href="/calls"
                            className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white"
                        >
                            Calls
                        </Link>
                        <Link
                            href="/customers"
                            className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white"
                        >
                            Customers
                        </Link>
                        <Link
                            href="/analytics"
                            className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white"
                        >
                            Analytics
                        </Link>
                        <Link
                            href="/service-desk"
                            className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white"
                        >
                            Service desk
                        </Link>
                        <div className="inline-flex w-fit items-center rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200">
                            <span className="mr-2 h-2 w-2 rounded-full bg-red-500 shadow-[0_0_18px_rgba(220,38,38,0.9)]" />
                            Service Advisor
                        </div>
                    </div>
                </div>
            </header>

            <section className="mx-auto flex max-w-7xl flex-col px-5 py-8 lg:px-8">
                <div className={hasDashboard ? 'mb-8' : 'mb-2'}>
                    <div className={hasDashboard ? 'w-full' : 'w-full'}>
                        {!hasDashboard && (
                            <div className="mb-8">
                                <p className="mb-3 text-sm font-semibold uppercase tracking-[0.4em] text-red-400">Customer lookup</p>
                                <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Identify the next Porsche service guest.</h2>
                                <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">Enter a phone number to surface customer history, vehicle alerts, shop load, and the next appointment in one advisor view.</p>
                            </div>
                        )}
                        <form onSubmit={handleSubmit} className={`rounded-3xl border border-zinc-800 bg-zinc-900/80 p-3 shadow-2xl shadow-black/40 ${hasDashboard ? 'max-w-3xl' : 'max-w-3xl'}`}>
                            <div className="flex flex-col gap-3 sm:flex-row">
                                <label className="sr-only" htmlFor="phone">Customer phone number</label>
                                <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="647-555-0192" inputMode="tel" className="min-h-16 flex-1 rounded-2xl border border-zinc-800 bg-zinc-950 px-5 text-xl font-semibold text-white outline-none transition placeholder:text-zinc-600 focus:border-red-500 focus:ring-4 focus:ring-red-600/20" />
                                <button type="submit" disabled={isLoading} className="min-h-16 rounded-2xl bg-red-600 px-8 text-base font-bold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-900 disabled:text-zinc-400">
                                    {isLoading ? 'Looking up...' : 'Lookup'}
                                </button>
                            </div>
                        </form>
                        {message && <div className="mt-5 max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-4 text-sm font-medium text-zinc-300">{message}</div>}
                    </div>
                </div>

                {/* Phase 9 task 4: morning-briefing panel. Visible only when no
                    customer has been pulled into the active dashboard — once
                    an advisor is mid-conversation we don't want to bury the
                    customer header under appointment cards. */}
                {!hasDashboard && <TodaysAppointmentsPanel />}

                {data && activeVehicle && (
                    <div className="space-y-6">
                        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl shadow-black/25">
                            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                    <p className="mb-2 text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Customer profile</p>
                                    <div className="flex flex-wrap items-center gap-4">
                                        <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{data.customer.name}</h2>
                                        <OutboundCallButton
                                            customerId={data.customer.id}
                                            customerName={data.customer.name}
                                            phone={data.customer.phone}
                                        />
                                    </div>
                                    <div className="mt-4 flex flex-wrap gap-3 text-sm text-zinc-300">
                                        <span className="rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2">{data.customer.phone}</span>
                                        <span className="rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2">{data.customer.email}</span>
                                        <span className="rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2">Customer since {customerYears} years</span>
                                        {data.customer.loyaltyTier && <span className="rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 font-bold text-red-200">{data.customer.loyaltyTier}</span>}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3 sm:min-w-[360px]">
                                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Lifetime visits</p>
                                        <p className="mt-2 text-2xl font-black text-white">{formatNumber(data.customer.lifetimeVisits)}</p>
                                    </div>
                                    <div className="rounded-2xl border border-red-500/40 bg-red-600/10 p-4">
                                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Lifetime spend</p>
                                        <p className="mt-2 text-2xl font-black text-red-300">{formatCurrency(data.customer.lifetimeSpend)}</p>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <nav className="flex gap-3 overflow-x-auto rounded-3xl border border-zinc-800 bg-zinc-900 p-2">
                            {data.vehicles.map((vehicle) => {
                                const isActive = vehicle.id === activeVehicle.id;
                                return (
                                    <button key={vehicle.id} type="button" onClick={() => setActiveVehicleId(vehicle.id)} className={`min-w-[240px] flex-1 rounded-2xl border px-5 py-4 text-left transition ${isActive ? 'border-red-500/60 bg-red-600/15 shadow-lg shadow-red-950/20' : 'border-transparent bg-zinc-950/70 hover:border-zinc-700'}`}>
                                        <p className="text-sm font-semibold text-zinc-400">{vehicle.year} {vehicle.make}</p>
                                        <p className="mt-1 text-lg font-black text-white">{vehicle.model}</p>
                                        <p className="mt-2 text-xs uppercase tracking-[0.22em] text-zinc-500">{vehicle.color}</p>
                                    </button>
                                );
                            })}
                        </nav>

                        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                            <div className="space-y-6">
                                <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                                    <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                        <div>
                                            <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Vehicle detail</p>
                                            <h3 className="mt-2 text-2xl font-black text-white">{activeVehicle.year} {activeVehicle.make} {activeVehicle.model}</h3>
                                        </div>
                                        <span className={`w-fit rounded-full border px-4 py-2 text-sm font-bold ${activeVehicle.recalls.length > 0 ? 'border-red-500/50 bg-red-600/15 text-red-200' : 'border-zinc-700 text-zinc-300'}`}>
                                            {activeVehicle.recalls.length} open recall{activeVehicle.recalls.length === 1 ? '' : 's'}
                                        </span>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                        {[
                                            { label: 'VIN', value: activeVehicle.vin },
                                            { label: 'Color', value: activeVehicle.color },
                                            { label: 'Mileage', value: `${formatNumber(activeVehicle.mileageKm)} km` },
                                            { label: 'Last service', value: activeVehicle.serviceHistory[0]?.date ?? 'No visits' },
                                        ].map(({ label, value }) => (
                                            <div key={label} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                                                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">{label}</p>
                                                <p className="mt-2 break-words text-base font-bold text-zinc-100" title={label === 'VIN' ? value : undefined}>{label === 'VIN' ? vinTail(value) : value}</p>
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                {activeVehicle.recalls.length > 0 && (
                                    <section className="rounded-3xl border border-red-500/40 bg-red-600/10 p-6 shadow-xl shadow-red-950/10">
                                        <div className="mb-4 flex items-center justify-between gap-4">
                                            <div>
                                                <p className="text-sm font-semibold uppercase tracking-[0.32em] text-red-300">Open campaigns</p>
                                                <h3 className="mt-2 text-2xl font-black text-white">Recall opportunities</h3>
                                            </div>
                                            <span className="rounded-full border border-red-500/40 bg-zinc-950 px-4 py-2 text-sm font-bold text-red-200">Action required</span>
                                        </div>
                                        <div className="space-y-3">
                                            {activeVehicle.recalls.map((recall) => (
                                                <article key={recall.campaign} className="rounded-2xl border border-red-500/30 bg-zinc-950 p-5">
                                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                        <div>
                                                            <p className="text-sm font-black text-red-200">{recall.campaign} - {recall.component}</p>
                                                            <p className="mt-2 text-sm leading-6 text-zinc-300">{recall.summary}</p>
                                                        </div>
                                                        <p className="shrink-0 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-red-200">{recall.remedy}</p>
                                                    </div>
                                                </article>
                                            ))}
                                        </div>
                                    </section>
                                )}

                                <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                                    <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                        <div>
                                            <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Service history</p>
                                            <h3 className="mt-2 text-2xl font-black text-white">Previous repair orders</h3>
                                        </div>
                                        <span className="rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-bold text-zinc-300">{activeVehicle.serviceHistory.length} visit{activeVehicle.serviceHistory.length === 1 ? '' : 's'}</span>
                                    </div>
                                    {activeVehicle.serviceHistory.length > 0 ? (
                                    <div className="overflow-hidden rounded-2xl border border-zinc-800">
                                        {activeVehicle.serviceHistory.map((history) => {
                                            const isExpanded = Boolean(expandedRows[history.id]);
                                            return (
                                                <div key={history.id} className="border-b border-zinc-800 last:border-b-0">
                                                    <button type="button" onClick={() => toggleHistoryRow(history.id)} className="grid w-full gap-3 bg-zinc-950 p-4 text-left transition hover:bg-zinc-900 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                                                        <div>
                                                            <p className="text-sm font-black text-white">{history.date}</p>
                                                            <p className="mt-1 text-sm text-zinc-400">{history.services.join(', ')}</p>
                                                        </div>
                                                        <p className="text-sm font-semibold text-zinc-300">Tech: {history.techName}</p>
                                                        <p className="text-sm font-black text-red-300">{formatCurrency(history.cost)}</p>
                                                    </button>
                                                    {isExpanded && (
                                                        <div className="grid gap-4 bg-zinc-900 p-4 lg:grid-cols-2">
                                                            <div>
                                                                <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Completed services</p>
                                                                <ul className="mt-3 space-y-2">
                                                                    {history.services.map((service) => (
                                                                        <li key={service} className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-200">{service}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                            <div>
                                                                <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Declined work</p>
                                                                {history.declined.length > 0 ? (
                                                                    <ul className="mt-3 space-y-2">
                                                                        {history.declined.map((declined) => (
                                                                            <li key={declined.service} className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
                                                                                <div className="flex items-center justify-between gap-3">
                                                                                    <span className="font-bold text-amber-100">{declined.service}</span>
                                                                                    <span className="font-black text-amber-200">{formatCurrency(declined.cost)}</span>
                                                                                </div>
                                                                                <p className="mt-2 text-amber-100/80">{declined.note}</p>
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                ) : (
                                                                    <p className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">No declined services recorded.</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    ) : (
                                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-5 py-4 text-sm text-zinc-400">No service history recorded for this vehicle.</div>
                                    )}
                                </section>
                            </div>

                            <aside className="space-y-6">
                                <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                                    <div className="mb-5 flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Shop status</p>
                                            <h3 className="mt-2 text-2xl font-black text-white">Live capacity</h3>
                                        </div>
                                        <span className={`rounded-full border px-3 py-1 text-sm font-bold ${getCapacityColor(data.shopStatus.capacityPercent).pill}`}>
                                            {data.shopStatus.capacityPercent}%
                                        </span>
                                    </div>
                                    <div className="h-3 overflow-hidden rounded-full bg-zinc-950">
                                        <div className={`h-full rounded-full ${getCapacityColor(data.shopStatus.capacityPercent).bar}`} style={{ width: `${data.shopStatus.capacityPercent}%` }} />
                                    </div>
                                    <div className="mt-5 grid grid-cols-2 gap-3">
                                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Wait</p>
                                            <p className={`mt-2 text-2xl font-black ${getCapacityColor(data.shopStatus.capacityPercent).text}`}>{data.shopStatus.estimatedWaitMinutes}m</p>
                                        </div>
                                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Techs</p>
                                            <p className="mt-2 text-2xl font-black text-white">{data.shopStatus.technicians}</p>
                                        </div>
                                        <div className="col-span-2 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Open repair orders</p>
                                            <p className="mt-2 text-2xl font-black text-white">{data.shopStatus.openRepairOrders}</p>
                                        </div>
                                    </div>
                                </section>

                                <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                                    <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Customer open ROs</p>
                                    <p className="mt-2 text-3xl font-black text-white">{data.openRepairOrders?.length ?? 0}</p>
                                    <div className="mt-4 space-y-2">
                                        {(data.openRepairOrders?.length ?? 0) > 0 ? data.openRepairOrders?.map((repairOrder) => (
                                            <div key={repairOrder.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
                                                <p className="font-black text-white">{repairOrder.number} - {repairOrder.service}</p>
                                                <p className="mt-1">{repairOrder.status} with {repairOrder.advisorName}</p>
                                            </div>
                                        )) : (
                                            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">No open repair orders.</div>
                                        )}
                                    </div>
                                </section>

                                <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                                    <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Next appointment</p>
                                    <h3 className="mt-2 text-2xl font-black text-white">{data.nextAppointment.date}</h3>
                                    <p className="mt-1 text-lg font-bold text-red-300">{data.nextAppointment.time}</p>
                                    {data.nextAppointment.advisorName && <p className="mt-1 text-sm font-semibold text-zinc-300">Advisor: {data.nextAppointment.advisorName}</p>}
                                    <div className="mt-5 space-y-2">
                                        {data.nextAppointment.services.map((service) => (
                                            <div key={service} className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-semibold text-zinc-200">{service}</div>
                                        ))}
                                    </div>
                                </section>

                                <WarrantyBadge vehicleId={activeVehicle.id} />

                                <CustomerUpsellsPanel customerId={data.customer.id} />

                                <CallHistory customerId={data.customer.id} />

                                {data.customer.id && (
                                    <div className="flex justify-end">
                                        <Link
                                            href={`/calls?customer_id=${encodeURIComponent(data.customer.id)}`}
                                            className="text-xs font-semibold uppercase tracking-[0.22em] text-red-300 transition hover:text-red-200"
                                        >
                                            Open full call log →
                                        </Link>
                                    </div>
                                )}

                                {data.customer.id && (
                                    <CallHistory title="All recent calls" />
                                )}

                                <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                                    <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Advisor note</p>
                                    {data.customer.advisorNote && (
                                        <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-600/10 p-4 text-sm leading-6 text-red-100">{data.customer.advisorNote}</p>
                                    )}
                                    <p className="mt-6 text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Advisor prompts</p>
                                    <ul className="mt-5 space-y-3 text-sm text-zinc-300">
                                        <li className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">Confirm contact preferences and appointment arrival window.</li>
                                        <li className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">Review open campaigns before preparing the write-up.</li>
                                        <li className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">Re-offer declined work with current pricing and availability.</li>
                                    </ul>
                                </section>
                            </aside>
                        </div>
                    </div>
                )}
            </section>
        </main>
    );
}
