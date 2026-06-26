'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import type { PitLaneRole } from '@/lib/role';
import type { LoanerVehicleRow, ScheduleOverrideRow, ServiceScheduleRow } from '@/lib/supabase';

type TabKey = 'weekly' | 'overrides' | 'loaners';

interface SessionPayload {
    role: PitLaneRole;
    dealerId: string;
}

type ScheduleDraft = Pick<
    ServiceScheduleRow,
    'day_of_week' | 'open_time' | 'close_time' | 'slot_duration_mins' | 'max_concurrent_bookings' | 'is_active'
>;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function defaultSchedule(): ScheduleDraft[] {
    return DAYS.map((_, day) => ({
        day_of_week: day,
        open_time: day === 0 ? '10:00' : '08:00',
        close_time: day === 0 ? '16:00' : '18:00',
        slot_duration_mins: 60,
        max_concurrent_bookings: 3,
        is_active: day !== 0,
    }));
}

function tomorrowIso(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

export default function ManagerCalendarPage() {
    const router = useRouter();
    const [session, setSession] = useState<SessionPayload | null>(null);
    const [tab, setTab] = useState<TabKey>('weekly');
    const [schedule, setSchedule] = useState<ScheduleDraft[]>(defaultSchedule());
    const [overrides, setOverrides] = useState<ScheduleOverrideRow[]>([]);
    const [vehicles, setVehicles] = useState<LoanerVehicleRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const loadSchedule = useCallback(async () => {
        const r = await fetch('/api/manager/schedule', { cache: 'no-store' });
        const body = (await r.json()) as { schedule?: ServiceScheduleRow[]; error?: string };
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        if (body.schedule && body.schedule.length > 0) {
            const next = defaultSchedule();
            for (const row of body.schedule) {
                next[row.day_of_week] = {
                    day_of_week: row.day_of_week,
                    open_time: row.open_time.slice(0, 5),
                    close_time: row.close_time.slice(0, 5),
                    slot_duration_mins: row.slot_duration_mins,
                    max_concurrent_bookings: row.max_concurrent_bookings,
                    is_active: row.is_active,
                };
            }
            setSchedule(next);
        }
    }, []);

    const loadOverrides = useCallback(async () => {
        const r = await fetch('/api/manager/schedule/overrides', { cache: 'no-store' });
        const body = (await r.json()) as { overrides?: ScheduleOverrideRow[]; error?: string };
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        setOverrides(body.overrides ?? []);
    }, []);

    const loadVehicles = useCallback(async () => {
        const r = await fetch('/api/manager/loaners/vehicles', { cache: 'no-store' });
        const body = (await r.json()) as { vehicles?: LoanerVehicleRow[]; error?: string };
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        setVehicles(body.vehicles ?? []);
    }, []);

    useEffect(() => {
        let cancelled = false;
        async function boot() {
            try {
                const sessionResponse = await fetch('/api/session', { cache: 'no-store' });
                const sessionPayload = (await sessionResponse.json()) as SessionPayload;
                if (sessionPayload.role !== 'service_manager') {
                    router.replace('/calls');
                    return;
                }
                if (!cancelled) setSession(sessionPayload);
                await Promise.all([loadSchedule(), loadOverrides(), loadVehicles()]);
            } catch (err) {
                if (!cancelled) setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to load calendar data' });
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void boot();
        return () => {
            cancelled = true;
        };
    }, [loadOverrides, loadSchedule, loadVehicles, router]);

    function patchDay(day: number, patch: Partial<ScheduleDraft>) {
        setSchedule((prev) => prev.map((row) => (row.day_of_week === day ? { ...row, ...patch } : row)));
    }

    async function saveSchedule() {
        setBusy('schedule');
        setToast(null);
        try {
            const r = await fetch('/api/manager/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(schedule),
            });
            const body = (await r.json()) as { error?: string; schedule?: ServiceScheduleRow[] };
            if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
            setToast({ type: 'success', message: 'Schedule saved.' });
            await loadSchedule();
        } catch (err) {
            setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save schedule' });
        } finally {
            setBusy(null);
        }
    }

    if (loading && !session) {
        return (
            <main className="min-h-screen bg-[#09090b] px-6 py-12 text-zinc-100">
                <div className="mx-auto h-64 max-w-5xl animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900" />
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100">PL</div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Manager calendar</p>
                        </div>
                    </Link>
                    <nav className="flex flex-wrap items-center gap-3">
                        <VoiceStatusDot />
                        <Link href="/dashboard" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Dashboard</Link>
                        <Link href="/service-desk" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Service desk</Link>
                        <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200">Calendar</span>
                        <Link href="/manager/departments" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Departments</Link>
                        <Link href="/manager/staff" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Staff</Link>
                    </nav>
                </div>
            </header>

            <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
                <div className="mb-6 flex flex-col gap-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.4em] text-red-400">Internal capacity</p>
                    <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Calendar controls</h2>
                    <p className="max-w-3xl text-sm leading-6 text-zinc-400">
                        Configure weekly service capacity, date-specific closures or custom hours, and the dealership loaner fleet.
                    </p>
                </div>

                {toast && (
                    <div className={`mb-4 rounded-2xl border px-5 py-4 text-sm ${toast.type === 'success' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' : 'border-red-500/40 bg-red-500/10 text-red-100'}`}>
                        {toast.message}
                    </div>
                )}

                <div className="mb-6 flex flex-wrap gap-2">
                    <TabButton active={tab === 'weekly'} onClick={() => setTab('weekly')}>Weekly Schedule</TabButton>
                    <TabButton active={tab === 'overrides'} onClick={() => setTab('overrides')}>Date Overrides</TabButton>
                    <TabButton active={tab === 'loaners'} onClick={() => setTab('loaners')}>Loaner Fleet</TabButton>
                </div>

                {tab === 'weekly' && (
                    <WeeklyScheduleTab
                        schedule={schedule}
                        busy={busy === 'schedule'}
                        onPatchDay={patchDay}
                        onSave={() => void saveSchedule()}
                    />
                )}
                {tab === 'overrides' && (
                    <OverridesTab
                        overrides={overrides}
                        busy={busy}
                        setBusy={setBusy}
                        setToast={setToast}
                        reload={loadOverrides}
                    />
                )}
                {tab === 'loaners' && (
                    <LoanerFleetTab
                        vehicles={vehicles}
                        busy={busy}
                        setBusy={setBusy}
                        setToast={setToast}
                        reload={loadVehicles}
                    />
                )}
            </section>
        </main>
    );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-full border px-4 py-2 text-sm font-bold transition ${active ? 'border-red-500/40 bg-red-600/15 text-red-200' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-red-500 hover:text-white'}`}
        >
            {children}
        </button>
    );
}

function WeeklyScheduleTab({
    schedule,
    busy,
    onPatchDay,
    onSave,
}: {
    schedule: ScheduleDraft[];
    busy: boolean;
    onPatchDay: (day: number, patch: Partial<ScheduleDraft>) => void;
    onSave: () => void;
}) {
    return (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="grid gap-4 lg:grid-cols-2">
                {schedule.map((day) => (
                    <div key={day.day_of_week} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h3 className="text-lg font-black text-white">{DAYS[day.day_of_week]}</h3>
                            <button
                                type="button"
                                onClick={() => onPatchDay(day.day_of_week, { is_active: !day.is_active })}
                                className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${day.is_active ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 bg-zinc-900 text-zinc-400'}`}
                            >
                                {day.is_active ? 'Active' : 'Closed'}
                            </button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <LabelledInput label="Open time" type="time" value={day.open_time} onChange={(value) => onPatchDay(day.day_of_week, { open_time: value })} />
                            <LabelledInput label="Close time" type="time" value={day.close_time} onChange={(value) => onPatchDay(day.day_of_week, { close_time: value })} />
                            <label className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                                Slot length
                                <select
                                    value={day.slot_duration_mins}
                                    onChange={(e) => onPatchDay(day.day_of_week, { slot_duration_mins: Number(e.target.value) })}
                                    className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-red-500"
                                >
                                    <option value={30}>30 mins</option>
                                    <option value={60}>60 mins</option>
                                    <option value={90}>90 mins</option>
                                </select>
                            </label>
                            <LabelledInput label="Max concurrent" type="number" min="1" value={String(day.max_concurrent_bookings)} onChange={(value) => onPatchDay(day.day_of_week, { max_concurrent_bookings: Number(value) })} />
                        </div>
                    </div>
                ))}
            </div>
            <button
                type="button"
                disabled={busy}
                onClick={onSave}
                className="mt-5 rounded-2xl border border-red-500/40 bg-red-600/15 px-5 py-3 text-sm font-black uppercase tracking-[0.22em] text-red-100 transition hover:border-red-400 hover:bg-red-600/25 disabled:opacity-50"
            >
                Save Schedule
            </button>
        </section>
    );
}

function OverridesTab({
    overrides,
    busy,
    setBusy,
    setToast,
    reload,
}: {
    overrides: ScheduleOverrideRow[];
    busy: string | null;
    setBusy: (value: string | null) => void;
    setToast: (value: { type: 'success' | 'error'; message: string } | null) => void;
    reload: () => Promise<void>;
}) {
    const [date, setDate] = useState(tomorrowIso());
    const [mode, setMode] = useState<'blocked' | 'custom'>('blocked');
    const [reason, setReason] = useState('');
    const [openTime, setOpenTime] = useState('09:00');
    const [closeTime, setCloseTime] = useState('15:00');
    const [maxConcurrent, setMaxConcurrent] = useState(2);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setBusy('override');
        setToast(null);
        try {
            const r = await fetch('/api/manager/schedule/overrides', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    override_date: date,
                    is_blocked: mode === 'blocked',
                    reason,
                    open_time: mode === 'custom' ? openTime : null,
                    close_time: mode === 'custom' ? closeTime : null,
                    max_concurrent_bookings: mode === 'custom' ? maxConcurrent : null,
                }),
            });
            const body = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
            setToast({ type: 'success', message: 'Override saved.' });
            await reload();
        } catch (err) {
            setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save override' });
        } finally {
            setBusy(null);
        }
    }

    async function deleteOverride(id: string) {
        setBusy(id);
        setToast(null);
        try {
            const r = await fetch(`/api/manager/schedule/overrides/${encodeURIComponent(id)}`, { method: 'DELETE' });
            const body = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
            setToast({ type: 'success', message: 'Override deleted.' });
            await reload();
        } catch (err) {
            setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to delete override' });
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
            <form onSubmit={submit} className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">New override</p>
                <div className="mt-4 space-y-4">
                    <LabelledInput label="Date" type="date" value={date} onChange={setDate} />
                    <div className="space-y-2 text-sm text-zinc-200">
                        <label className="flex items-center gap-2">
                            <input type="radio" checked={mode === 'blocked'} onChange={() => setMode('blocked')} />
                            Block this date entirely
                        </label>
                        <label className="flex items-center gap-2">
                            <input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} />
                            Set custom hours
                        </label>
                    </div>
                    {mode === 'custom' && (
                        <div className="grid gap-3 sm:grid-cols-2">
                            <LabelledInput label="Open" type="time" value={openTime} onChange={setOpenTime} />
                            <LabelledInput label="Close" type="time" value={closeTime} onChange={setCloseTime} />
                            <LabelledInput label="Max concurrent" type="number" min="1" value={String(maxConcurrent)} onChange={(value) => setMaxConcurrent(Number(value))} />
                        </div>
                    )}
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                        Reason
                        <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-red-500" />
                    </label>
                </div>
                <button type="submit" disabled={busy === 'override'} className="mt-5 rounded-2xl border border-red-500/40 bg-red-600/15 px-5 py-3 text-sm font-black uppercase tracking-[0.22em] text-red-100 transition hover:border-red-400 hover:bg-red-600/25 disabled:opacity-50">
                    Save Override
                </button>
            </form>

            <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                <h3 className="text-xl font-black text-white">Upcoming overrides</h3>
                <ul className="mt-4 space-y-3">
                    {overrides.length === 0 && <li className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-8 text-center text-sm text-zinc-500">No upcoming overrides.</li>}
                    {overrides.map((row) => (
                        <li key={row.id} className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="font-black text-white">{row.override_date}</p>
                                <p className="mt-1 text-sm text-zinc-400">
                                    {row.is_blocked ? 'Blocked all day' : `${row.open_time?.slice(0, 5)}-${row.close_time?.slice(0, 5)} (${row.max_concurrent_bookings ?? 'default'} concurrent)`}
                                </p>
                                {row.reason && <p className="mt-1 text-xs text-zinc-500">{row.reason}</p>}
                            </div>
                            <button type="button" disabled={busy === row.id} onClick={() => void deleteOverride(row.id)} className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white disabled:opacity-50">
                                Delete
                            </button>
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    );
}

function LoanerFleetTab({
    vehicles,
    busy,
    setBusy,
    setToast,
    reload,
}: {
    vehicles: LoanerVehicleRow[];
    busy: string | null;
    setBusy: (value: string | null) => void;
    setToast: (value: { type: 'success' | 'error'; message: string } | null) => void;
    reload: () => Promise<void>;
}) {
    const [showForm, setShowForm] = useState(false);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        setBusy('vehicle_new');
        setToast(null);
        try {
            const r = await fetch('/api/manager/loaners/vehicles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    make: String(formData.get('make') ?? ''),
                    model: String(formData.get('model') ?? ''),
                    year: Number(formData.get('year') ?? 0),
                    color: String(formData.get('color') ?? ''),
                    license_plate: String(formData.get('license_plate') ?? ''),
                    notes: String(formData.get('notes') ?? ''),
                }),
            });
            const body = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
            form.reset();
            setShowForm(false);
            setToast({ type: 'success', message: 'Loaner vehicle added.' });
            await reload();
        } catch (err) {
            setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to add vehicle' });
        } finally {
            setBusy(null);
        }
    }

    async function patchVehicle(id: string, patch: Partial<Pick<LoanerVehicleRow, 'is_available' | 'notes' | 'color'>>) {
        setBusy(id);
        setToast(null);
        try {
            const r = await fetch(`/api/manager/loaners/vehicles/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            const body = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
            await reload();
        } catch (err) {
            setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to update vehicle' });
        } finally {
            setBusy(null);
        }
    }

    async function deleteVehicle(id: string) {
        setBusy(id);
        setToast(null);
        try {
            const r = await fetch(`/api/manager/loaners/vehicles/${encodeURIComponent(id)}`, { method: 'DELETE' });
            const body = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
            setToast({ type: 'success', message: 'Loaner vehicle marked unavailable.' });
            await reload();
        } catch (err) {
            setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to delete vehicle' });
        } finally {
            setBusy(null);
        }
    }

    return (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="text-xl font-black text-white">Loaner fleet</h3>
                    <p className="mt-1 text-sm text-zinc-500">{vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'} configured</p>
                </div>
                <button type="button" onClick={() => setShowForm((value) => !value)} className="rounded-2xl border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-red-100 transition hover:border-red-400 hover:bg-red-600/25">
                    Add Vehicle
                </button>
            </div>

            {showForm && (
                <form onSubmit={submit} className="mb-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                    <div className="grid gap-3 md:grid-cols-3">
                        <LabelledInput label="Make" name="make" required />
                        <LabelledInput label="Model" name="model" required />
                        <LabelledInput label="Year" name="year" type="number" min="1990" required />
                        <LabelledInput label="Color" name="color" />
                        <LabelledInput label="License plate" name="license_plate" required />
                        <label className="block text-xs font-bold uppercase tracking-[0.2em] text-zinc-500 md:col-span-3">
                            Notes
                            <textarea name="notes" className="mt-2 min-h-20 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-red-500" />
                        </label>
                    </div>
                    <button type="submit" disabled={busy === 'vehicle_new'} className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200 disabled:opacity-50">
                        Submit
                    </button>
                </form>
            )}

            <div className="overflow-hidden rounded-2xl border border-zinc-800">
                <table className="w-full text-left text-sm">
                    <thead className="border-b border-zinc-800 bg-zinc-950 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                        <tr>
                            <th className="px-4 py-3">Vehicle</th>
                            <th className="px-4 py-3">Plate</th>
                            <th className="px-4 py-3">Color</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {vehicles.length === 0 && (
                            <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-zinc-500">No loaner vehicles configured.</td></tr>
                        )}
                        {vehicles.map((vehicle) => (
                            <tr key={vehicle.id} className="border-b border-zinc-800/60 last:border-b-0">
                                <td className="px-4 py-3 font-bold text-white">{vehicle.year} {vehicle.make} {vehicle.model}</td>
                                <td className="px-4 py-3 font-mono text-xs text-zinc-300">{vehicle.license_plate}</td>
                                <td className="px-4 py-3 text-zinc-300">{vehicle.color ?? '-'}</td>
                                <td className="px-4 py-3">
                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${vehicle.is_available ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 bg-zinc-950 text-zinc-400'}`}>
                                        {vehicle.is_available ? 'Available' : 'Unavailable'}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <div className="inline-flex flex-wrap justify-end gap-2">
                                        <button type="button" disabled={busy === vehicle.id} onClick={() => void patchVehicle(vehicle.id, { is_available: !vehicle.is_available })} className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white disabled:opacity-50">
                                            Toggle
                                        </button>
                                        <button type="button" disabled={busy === vehicle.id} onClick={() => void deleteVehicle(vehicle.id)} className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white disabled:opacity-50">
                                            Delete
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function LabelledInput({
    label,
    onChange,
    ...props
}: {
    label: string;
    onChange?: (value: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
    const id = useMemo(() => props.name ?? label.toLowerCase().replace(/\s+/g, '-'), [label, props.name]);
    return (
        <label htmlFor={id} className="block text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            {label}
            <input
                id={id}
                onChange={(e) => onChange?.(e.target.value)}
                className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-red-500"
                {...props}
            />
        </label>
    );
}
