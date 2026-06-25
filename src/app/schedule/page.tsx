'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';

// /schedule — Phase 10 weekly appointment calendar.
//
// Reads /api/schedule for the current week and renders a grid (7 day
// columns × time rows). Aria-booked cells are teal; advisor-booked cells
// are gray. Clicking a cell deep-links to the customer profile or the
// call detail that booked it.

interface ScheduleRow {
    id: string;
    customer_id: string;
    customer_name: string | null;
    vehicle_id: string;
    vehicle_label: string | null;
    date: string;
    time: string;
    service_type: string;
    advisor: string | null;
    duration_est_hours: number | null;
    status: string;
    confirmation_number: string | null;
    call_log_id: string | null;
    is_aria_booked: boolean;
}

interface ScheduleResponse {
    appointments: ScheduleRow[];
    from: string;
    to: string;
    persistence: 'supabase' | 'mock';
}

function startOfWeek(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    // Monday-start week to match dealership operations.
    const day = x.getDay() === 0 ? 6 : x.getDay() - 1;
    x.setDate(x.getDate() - day);
    return x;
}

function addDays(d: Date, n: number): Date {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}

function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function fmtWeekday(d: Date): string {
    return d.toLocaleDateString('en-CA', { weekday: 'short' });
}

function fmtDayNum(d: Date): string {
    return String(d.getDate());
}

export default function SchedulePage() {
    const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
    const [data, setData] = useState<ScheduleResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(anchor, i)), [anchor]);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        const from = isoDate(anchor);
        const to = isoDate(addDays(anchor, 6));
        try {
            const r = await fetch(`/api/schedule?from=${from}&to=${to}`, { cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const payload = (await r.json()) as ScheduleResponse;
            setData(payload);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load schedule');
        } finally {
            setLoading(false);
        }
    }, [anchor]);

    useEffect(() => {
        void load();
    }, [load]);

    const byDay = useMemo(() => {
        const map = new Map<string, ScheduleRow[]>();
        for (const a of data?.appointments ?? []) {
            const key = a.date;
            const list = map.get(key) ?? [];
            list.push(a);
            map.set(key, list);
        }
        // Sort each day's list by time. Use Array.from to avoid the
        // downlevelIteration trap on Map.values().
        for (const list of Array.from(map.values())) {
            list.sort((a: ScheduleRow, b: ScheduleRow) =>
                a.time < b.time ? -1 : a.time > b.time ? 1 : 0,
            );
        }
        return map;
    }, [data]);

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100 shadow-lg shadow-red-950/30">PL</div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Schedule</p>
                        </div>
                    </Link>
                    <nav className="flex flex-wrap items-center gap-3">
                        <VoiceStatusDot />
                        <Link href="/dashboard" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Dashboard</Link>
                        <Link href="/calls" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Calls</Link>
                        <Link href="/customers" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Customers</Link>
                        <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200">Schedule</span>
                        <Link href="/service-desk" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Service desk</Link>
                    </nav>
                </div>
            </header>

            <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
                <div className="mb-6 flex flex-col gap-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.4em] text-red-400">Weekly schedule</p>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
                            Week of {anchor.toLocaleDateString('en-CA', { month: 'long', day: 'numeric' })}
                        </h2>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setAnchor((a) => addDays(a, -7))}
                                className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white"
                            >
                                ← Prev
                            </button>
                            <button
                                type="button"
                                onClick={() => setAnchor(startOfWeek(new Date()))}
                                className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white"
                            >
                                This week
                            </button>
                            <button
                                type="button"
                                onClick={() => setAnchor((a) => addDays(a, 7))}
                                className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white"
                            >
                                Next →
                            </button>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                        <span className="inline-flex items-center gap-2">
                            <span className="inline-block h-3 w-3 rounded-full bg-teal-500" /> Aria-booked
                        </span>
                        <span className="inline-flex items-center gap-2">
                            <span className="inline-block h-3 w-3 rounded-full bg-zinc-500" /> Advisor-booked
                        </span>
                    </div>
                </div>

                {error && (
                    <div className="mb-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-100">{error}</div>
                )}

                {loading && !data && (
                    <div className="h-64 animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900" />
                )}

                {data && (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
                        {weekDays.map((day) => {
                            const iso = isoDate(day);
                            const list = byDay.get(iso) ?? [];
                            const isToday = isoDate(new Date()) === iso;
                            return (
                                <div
                                    key={iso}
                                    className={`flex min-h-[200px] flex-col gap-2 rounded-2xl border p-3 ${
                                        isToday ? 'border-red-500/40 bg-red-500/5' : 'border-zinc-800 bg-zinc-900'
                                    }`}
                                >
                                    <div className="flex items-baseline justify-between">
                                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">{fmtWeekday(day)}</p>
                                        <p className={`text-lg font-black ${isToday ? 'text-red-200' : 'text-white'}`}>{fmtDayNum(day)}</p>
                                    </div>
                                    {list.length === 0 ? (
                                        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 px-2 py-3 text-center text-[10px] italic text-zinc-500">
                                            No appointments
                                        </p>
                                    ) : (
                                        list.map((a) => {
                                            const cellCls = a.is_aria_booked
                                                ? 'border-teal-500/40 bg-teal-500/10 text-teal-100'
                                                : 'border-zinc-700 bg-zinc-950 text-zinc-200';
                                            const linkHref = a.call_log_id
                                                ? `/calls/${encodeURIComponent(a.call_log_id)}`
                                                : `/customers/${encodeURIComponent(a.customer_id)}`;
                                            return (
                                                <Link
                                                    key={a.id}
                                                    href={linkHref}
                                                    className={`block rounded-xl border px-2 py-1.5 text-xs leading-4 transition hover:brightness-110 ${cellCls}`}
                                                >
                                                    <p className="font-bold">{a.time}</p>
                                                    <p className="truncate">{a.customer_name ?? `Customer ${a.customer_id}`}</p>
                                                    <p className="truncate text-[10px] opacity-80">{a.vehicle_label ?? a.vehicle_id}</p>
                                                    <p className="mt-0.5 truncate text-[10px] opacity-70">{a.service_type}</p>
                                                </Link>
                                            );
                                        })
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </main>
    );
}
