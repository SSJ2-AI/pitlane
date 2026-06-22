'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';

interface Customer {
    id: string;
    name: string;
    phone: string;
    email: string;
    customerSince: number;
    lifetimeVisits: number;
    lifetimeSpend: number;
    vehicles: { year: number; make: string; model: string; vin: string; }[];
    lastService: string;
    openRecalls: number;
}

const MOCK_CUSTOMERS: Customer[] = [
    { id: 'cust_001', name: 'James Whitfield', phone: '647-555-0192', email: 'j.whitfield@gmail.com', customerSince: 2018, lifetimeVisits: 14, lifetimeSpend: 32850, vehicles: [{ year: 2021, make: 'Porsche', model: 'Cayenne S', vin: 'WP1AA2AY4MDA12345' }, { year: 2020, make: 'Porsche', model: '911 Carrera S', vin: 'WP0AA2A71LS200123' }], lastService: 'Nov 2025', openRecalls: 1 },
    { id: 'cust_002', name: 'Sarah Park', phone: '416-555-0847', email: 'sarah.park@outlook.com', customerSince: 2021, lifetimeVisits: 8, lifetimeSpend: 14200, vehicles: [{ year: 2022, make: 'Porsche', model: 'Macan GTS', vin: 'WP0AA2A71LS200456' }], lastService: 'Mar 2026', openRecalls: 0 },
    { id: 'cust_003', name: 'Michael Chen', phone: '905-555-0321', email: 'mchen@gmail.com', customerSince: 2020, lifetimeVisits: 11, lifetimeSpend: 28600, vehicles: [{ year: 2023, make: 'Porsche', model: '911 GT3', vin: 'WP0CA2985NS610087' }], lastService: 'Jan 2026', openRecalls: 0 },
    { id: 'cust_004', name: 'Priya Nair', phone: '647-555-0411', email: 'p.nair@rogers.com', customerSince: 2022, lifetimeVisits: 5, lifetimeSpend: 9800, vehicles: [{ year: 2022, make: 'Porsche', model: 'Taycan', vin: 'WP0AB2A97NS123456' }], lastService: 'Apr 2026', openRecalls: 0 },
    { id: 'cust_005', name: 'David Kowalski', phone: '416-555-0992', email: 'd.kowalski@hotmail.com', customerSince: 2019, lifetimeVisits: 18, lifetimeSpend: 41500, vehicles: [{ year: 2023, make: 'Porsche', model: 'Macan Turbo', vin: 'WP1AE2AY9NDA55789' }], lastService: 'Jun 2026', openRecalls: 0 },
];

function formatCurrency(n: number) {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
}

export default function CustomersPage() {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // In mock mode, use MOCK_CUSTOMERS. In production, would call /api/customers
        setTimeout(() => { setCustomers(MOCK_CUSTOMERS); setLoading(false); }, 400);
    }, []);

    const filtered = customers.filter(c =>
        !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search) || c.email.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
                    <div className="flex items-center gap-3">
                        <Link href="/dashboard" className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100">PL</Link>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Porsche service desk</p>
                        </div>
                    </div>
                    <nav className="flex items-center gap-2">
                        <VoiceStatusDot />
                        <Link href="/calls" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500 transition">Calls</Link>
                        <Link href="/service-desk" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500 transition">Service desk</Link>
                        <Link href="/customers" className="rounded-full border border-red-500/60 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-100">Customers</Link>
                        <Link href="/dashboard" className="rounded-full border border-zinc-700 bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 transition">Service Advisor</Link>
                    </nav>
                </div>
            </header>

            <div className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-zinc-500">Customer directory</p>
                        <h2 className="mt-2 text-3xl font-black tracking-tight text-white">All customers</h2>
                    </div>
                    <input
                        value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search by name, phone, or email…"
                        className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500 sm:max-w-xs"
                    />
                </div>

                {loading ? (
                    <div className="space-y-3 animate-pulse">
                        {[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-2xl border border-zinc-800 bg-zinc-900" />)}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filtered.map(c => (
                            <Link key={c.id} href={`/dashboard?phone=${encodeURIComponent(c.phone)}`}
                                className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 transition hover:border-zinc-600 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <span className="text-lg font-black text-white">{c.name}</span>
                                        {c.openRecalls > 0 && (
                                            <span className="rounded-full border border-red-500/50 bg-red-600/15 px-3 py-0.5 text-xs font-bold text-red-200">{c.openRecalls} open recall</span>
                                        )}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-3 text-sm text-zinc-400">
                                        <span>{c.phone}</span>
                                        <span className="text-zinc-600">·</span>
                                        <span>{c.email}</span>
                                        <span className="text-zinc-600">·</span>
                                        <span>Customer since {c.customerSince}</span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {c.vehicles.map(v => (
                                            <span key={v.vin} className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs text-zinc-300">{v.year} {v.model}</span>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex shrink-0 gap-4 text-right sm:gap-6">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Visits</p>
                                        <p className="mt-1 text-xl font-black text-white">{c.lifetimeVisits}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Lifetime spend</p>
                                        <p className="mt-1 text-xl font-black text-red-300">{formatCurrency(c.lifetimeSpend)}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Last service</p>
                                        <p className="mt-1 text-lg font-bold text-zinc-200">{c.lastService}</p>
                                    </div>
                                </div>
                            </Link>
                        ))}
                        {filtered.length === 0 && (
                            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-10 text-center text-zinc-500">
                                No customers match &quot;{search}&quot;
                            </div>
                        )}
                    </div>
                )}
            </div>
        </main>
    );
}
