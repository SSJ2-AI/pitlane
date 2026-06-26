'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import { RoleNav } from '@/components/RoleNav';
import type {
    LoanerVehicleRow,
    ScheduleOverrideRow,
    ServiceScheduleRow,
} from '@/lib/supabase';
import type { PitLaneRole } from '@/lib/role';

// /manager/calendar — Phase 13 internal calendar console for service
// managers. Three tabs:
//
//   1. Weekly schedule — recurring open hours + capacity caps per
//      day of week. Powers Aria's available-slot search.
//   2. Date overrides — one-off blocked dates / custom hours.
//   3. Loaner fleet — inventory of courtesy cars (make/model/plate/
//      availability). Plate is quasi-PII (see migration 0014) and is
//      ONLY visible to staff on this page.
//
// Role gate: if the caller isn't a service_manager we redirect to
// /calls (the spec landing page). Mock mode keeps the ?role= URL hint
// honoured for dev parity.

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const SLOT_DURATION_CHOICES = [30, 60, 90] as const;

interface SessionPayload {
    role: PitLaneRole;
    dealerId: string;
    fullName: string | null;
    email: string | null;
}

interface ScheduleResponse {
    schedule: ServiceScheduleRow[];
    dealer_id: string | null;
    persistence: 'supabase' | 'mock';
}

interface OverridesResponse {
    overrides: ScheduleOverrideRow[];
    persistence: 'supabase' | 'mock';
}

interface VehiclesResponse {
    vehicles: LoanerVehicleRow[];
    persistence: 'supabase' | 'mock';
}

type Tab = 'schedule' | 'overrides' | 'fleet';

export default function ManagerCalendarPage() {
    return (
        <Suspense fallback={<Fallback />}>
            <Inner />
        </Suspense>
    );
}

function Fallback() {
    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <div className="mx-auto max-w-7xl px-5 py-16 text-center text-sm text-zinc-400 lg:px-8">
                Loading calendar…
            </div>
        </main>
    );
}

function Inner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [session, setSession] = useState<SessionPayload | null>(null);
    const [sessionLoaded, setSessionLoaded] = useState(false);
    const [tab, setTab] = useState<Tab>('schedule');
    const [toast, setToast] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const r = await fetch('/api/session', { cache: 'no-store' });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const payload = (await r.json()) as SessionPayload;
                if (cancelled) return;
                setSession(payload);
                if (payload.role !== 'service_manager') {
                    router.replace('/calls');
                }
            } catch {
                if (!cancelled) router.replace('/calls');
            } finally {
                if (!cancelled) setSessionLoaded(true);
            }
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, [router]);

    function flash(kind: 'ok' | 'err', message: string) {
        setToast({ kind, message });
        window.setTimeout(() => setToast(null), 4000);
    }

    if (!sessionLoaded) return <Fallback />;
    if (session && session.role !== 'service_manager') return <Fallback />;

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100">
                            PL
                        </div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">
                                Pit<span className="text-red-500">Lane</span>
                            </h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
                                Manager · Calendar
                            </p>
                        </div>
                    </Link>
                    <div className="flex flex-wrap items-center gap-3">
                        <VoiceStatusDot />
                        <RoleNav />
                    </div>
                </div>
            </header>

            <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
                <div className="mb-6 flex flex-col gap-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.4em] text-red-400">Calendar</p>
                    <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
                        Service hours &amp; loaner fleet
                    </h2>
                    <p className="max-w-3xl text-sm leading-6 text-zinc-400">
                        Define weekly open hours, capacity caps, date-specific overrides, and the
                        courtesy-vehicle inventory. Aria uses these to offer customers concrete
                        booking slots and to flag when a loaner is available.
                    </p>
                </div>

                {toast && (
                    <div
                        className={`mb-4 rounded-2xl border px-5 py-4 text-sm ${
                            toast.kind === 'ok'
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                                : 'border-red-500/40 bg-red-500/10 text-red-100'
                        }`}
                    >
                        {toast.message}
                    </div>
                )}

                <div className="mb-6 flex flex-wrap gap-2">
                    {(
                        [
                            { id: 'schedule', label: 'Weekly schedule' },
                            { id: 'overrides', label: 'Date overrides' },
                            { id: 'fleet', label: 'Loaner fleet' },
                        ] as Array<{ id: Tab; label: string }>
                    ).map((t) => (
                        <button
                            type="button"
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className={`rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] transition ${
                                tab === t.id
                                    ? 'border-red-500/50 bg-red-600/20 text-red-100'
                                    : 'border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-red-500/50 hover:text-white'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {tab === 'schedule' && <WeeklyScheduleTab onFlash={flash} role={searchParams.get('role')} />}
                {tab === 'overrides' && <OverridesTab onFlash={flash} role={searchParams.get('role')} />}
                {tab === 'fleet' && <LoanerFleetTab onFlash={flash} role={searchParams.get('role')} />}
            </section>
        </main>
    );
}

// ─── Weekly schedule tab ────────────────────────────────────────────────────

function WeeklyScheduleTab({
    onFlash,
    role,
}: {
    onFlash: (kind: 'ok' | 'err', message: string) => void;
    role: string | null;
}) {
    const roleSuffix = role ? `?role=${encodeURIComponent(role)}` : '';
    const [rows, setRows] = useState<ServiceScheduleRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetch(`/api/manager/schedule${roleSuffix}`, { cache: 'no-store' });
            const payload = (await r.json()) as ScheduleResponse;
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            // Ensure all 7 days present.
            const byDay = new Map(payload.schedule.map((s) => [s.day_of_week, s]));
            const filled = Array.from({ length: 7 }, (_, day) => {
                const existing = byDay.get(day);
                if (existing) return existing;
                return {
                    id: `new_${day}`,
                    dealer_id: payload.dealer_id ?? '',
                    day_of_week: day,
                    open_time: day === 0 ? '00:00' : '08:00',
                    close_time: day === 0 ? '00:00' : '18:00',
                    slot_duration_mins: 60,
                    max_concurrent_bookings: day === 0 ? 0 : 3,
                    is_active: day !== 0,
                    created_by: null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                } satisfies ServiceScheduleRow;
            });
            setRows(filled);
        } catch (err) {
            onFlash('err', err instanceof Error ? err.message : 'Failed to load schedule');
        } finally {
            setLoading(false);
        }
    }, [onFlash, roleSuffix]);

    useEffect(() => {
        void load();
    }, [load]);

    function patch(day: number, key: keyof ServiceScheduleRow, value: unknown) {
        setRows((current) =>
            current.map((r) => (r.day_of_week === day ? { ...r, [key]: value } : r)),
        );
    }

    async function save() {
        setSaving(true);
        try {
            const r = await fetch(`/api/manager/schedule${roleSuffix}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    days: rows.map((row) => ({
                        day_of_week: row.day_of_week,
                        open_time: row.open_time.slice(0, 5),
                        close_time: row.close_time.slice(0, 5),
                        slot_duration_mins: row.slot_duration_mins,
                        max_concurrent_bookings: row.max_concurrent_bookings,
                        is_active: row.is_active,
                    })),
                }),
            });
            const payload = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
            onFlash('ok', 'Schedule saved.');
            await load();
        } catch (err) {
            onFlash('err', err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return <div className="h-48 animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900" />;
    }

    return (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">
                Recurring weekly hours
            </p>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="border-b border-zinc-800 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                        <tr>
                            <th className="px-3 py-3 font-semibold">Day</th>
                            <th className="px-3 py-3 font-semibold">Open</th>
                            <th className="px-3 py-3 font-semibold">Close</th>
                            <th className="px-3 py-3 font-semibold">Slot</th>
                            <th className="px-3 py-3 font-semibold">Capacity</th>
                            <th className="px-3 py-3 font-semibold">Active</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.day_of_week} className="border-b border-zinc-800/60 last:border-b-0">
                                <td className="px-3 py-3 font-bold text-white">
                                    {DAY_LABELS[row.day_of_week]}
                                </td>
                                <td className="px-3 py-3">
                                    <input
                                        type="time"
                                        value={row.open_time.slice(0, 5)}
                                        onChange={(e) => patch(row.day_of_week, 'open_time', e.target.value)}
                                        disabled={!row.is_active}
                                        className="rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white outline-none focus:border-red-500 disabled:opacity-40"
                                    />
                                </td>
                                <td className="px-3 py-3">
                                    <input
                                        type="time"
                                        value={row.close_time.slice(0, 5)}
                                        onChange={(e) => patch(row.day_of_week, 'close_time', e.target.value)}
                                        disabled={!row.is_active}
                                        className="rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white outline-none focus:border-red-500 disabled:opacity-40"
                                    />
                                </td>
                                <td className="px-3 py-3">
                                    <select
                                        value={row.slot_duration_mins}
                                        onChange={(e) =>
                                            patch(row.day_of_week, 'slot_duration_mins', Number(e.target.value))
                                        }
                                        disabled={!row.is_active}
                                        className="rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white outline-none focus:border-red-500 disabled:opacity-40"
                                    >
                                        {SLOT_DURATION_CHOICES.map((min) => (
                                            <option key={min} value={min}>{min} min</option>
                                        ))}
                                    </select>
                                </td>
                                <td className="px-3 py-3">
                                    <input
                                        type="number"
                                        min={0}
                                        max={20}
                                        value={row.max_concurrent_bookings}
                                        onChange={(e) =>
                                            patch(
                                                row.day_of_week,
                                                'max_concurrent_bookings',
                                                Math.max(0, Number(e.target.value) || 0),
                                            )
                                        }
                                        disabled={!row.is_active}
                                        className="w-20 rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white outline-none focus:border-red-500 disabled:opacity-40"
                                    />
                                </td>
                                <td className="px-3 py-3">
                                    <button
                                        type="button"
                                        onClick={() => patch(row.day_of_week, 'is_active', !row.is_active)}
                                        className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] transition ${
                                            row.is_active
                                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400'
                                                : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-500'
                                        }`}
                                    >
                                        {row.is_active ? 'Open' : 'Closed'}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="mt-5 flex justify-end">
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className="rounded-2xl bg-red-600 px-5 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-900 disabled:text-zinc-400"
                >
                    {saving ? 'Saving…' : 'Save schedule'}
                </button>
            </div>
        </div>
    );
}

// ─── Date overrides tab ─────────────────────────────────────────────────────

function OverridesTab({
    onFlash,
    role,
}: {
    onFlash: (kind: 'ok' | 'err', message: string) => void;
    role: string | null;
}) {
    const roleSuffix = role ? `?role=${encodeURIComponent(role)}` : '';
    const [overrides, setOverrides] = useState<ScheduleOverrideRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [date, setDate] = useState('');
    const [mode, setMode] = useState<'block' | 'custom'>('block');
    const [openTime, setOpenTime] = useState('09:00');
    const [closeTime, setCloseTime] = useState('17:00');
    const [maxBookings, setMaxBookings] = useState(2);
    const [reason, setReason] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetch(`/api/manager/schedule/overrides${roleSuffix}`, { cache: 'no-store' });
            const payload = (await r.json()) as OverridesResponse;
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            setOverrides(payload.overrides);
        } catch (err) {
            onFlash('err', err instanceof Error ? err.message : 'Failed to load overrides');
        } finally {
            setLoading(false);
        }
    }, [onFlash, roleSuffix]);

    useEffect(() => {
        void load();
    }, [load]);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!date) {
            onFlash('err', 'Pick a date for the override');
            return;
        }
        setSaving(true);
        try {
            const r = await fetch(`/api/manager/schedule/overrides${roleSuffix}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    override_date: date,
                    is_blocked: mode === 'block',
                    reason: reason || null,
                    open_time: mode === 'custom' ? openTime : null,
                    close_time: mode === 'custom' ? closeTime : null,
                    max_concurrent_bookings: mode === 'custom' ? maxBookings : null,
                }),
            });
            const payload = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
            onFlash('ok', 'Override saved.');
            setDate('');
            setReason('');
            await load();
        } catch (err) {
            onFlash('err', err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    }

    async function remove(id: string) {
        try {
            const r = await fetch(`/api/manager/schedule/overrides/${id}${roleSuffix}`, {
                method: 'DELETE',
            });
            const payload = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
            onFlash('ok', 'Override removed.');
            await load();
        } catch (err) {
            onFlash('err', err instanceof Error ? err.message : 'Delete failed');
        }
    }

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <form
                onSubmit={submit}
                className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5"
            >
                <p className="mb-4 text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">
                    Add an override
                </p>
                <label className="flex flex-col gap-1 text-sm">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Date *</span>
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        required
                        className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                    />
                </label>

                <fieldset className="mt-4 flex flex-col gap-2">
                    <legend className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                        Type
                    </legend>
                    <label className="flex items-center gap-2 text-sm text-zinc-200">
                        <input
                            type="radio"
                            checked={mode === 'block'}
                            onChange={() => setMode('block')}
                            className="accent-red-500"
                        />
                        Block this date entirely
                    </label>
                    <label className="flex items-center gap-2 text-sm text-zinc-200">
                        <input
                            type="radio"
                            checked={mode === 'custom'}
                            onChange={() => setMode('custom')}
                            className="accent-red-500"
                        />
                        Set custom hours
                    </label>
                </fieldset>

                {mode === 'custom' && (
                    <div className="mt-4 grid grid-cols-3 gap-2">
                        <label className="flex flex-col gap-1 text-xs">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Open</span>
                            <input
                                type="time"
                                value={openTime}
                                onChange={(e) => setOpenTime(e.target.value)}
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white outline-none focus:border-red-500"
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-xs">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Close</span>
                            <input
                                type="time"
                                value={closeTime}
                                onChange={(e) => setCloseTime(e.target.value)}
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white outline-none focus:border-red-500"
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-xs">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Capacity</span>
                            <input
                                type="number"
                                min={0}
                                value={maxBookings}
                                onChange={(e) => setMaxBookings(Math.max(0, Number(e.target.value) || 0))}
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white outline-none focus:border-red-500"
                            />
                        </label>
                    </div>
                )}

                <label className="mt-4 flex flex-col gap-1 text-sm">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Reason</span>
                    <input
                        type="text"
                        placeholder="Statutory holiday, off-site training, etc."
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                    />
                </label>

                <button
                    type="submit"
                    disabled={saving}
                    className="mt-5 rounded-2xl bg-red-600 px-5 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-900 disabled:text-zinc-400"
                >
                    {saving ? 'Saving…' : 'Save override'}
                </button>
            </form>

            <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                <p className="mb-4 text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">
                    Upcoming overrides
                </p>
                {loading ? (
                    <div className="h-32 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-950" />
                ) : overrides.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-6 text-center text-sm text-zinc-400">
                        No overrides scheduled.
                    </p>
                ) : (
                    <ul className="space-y-3">
                        {overrides.map((o) => (
                            <li
                                key={o.id}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3"
                            >
                                <div className="min-w-0">
                                    <p className="text-sm font-bold text-white">{o.override_date}</p>
                                    <p className="mt-0.5 text-xs text-zinc-400">
                                        {o.is_blocked
                                            ? 'Blocked'
                                            : `Custom hours ${o.open_time?.slice(0, 5) ?? '?'}–${o.close_time?.slice(0, 5) ?? '?'} · capacity ${o.max_concurrent_bookings ?? '—'}`}
                                        {o.reason ? ` · ${o.reason}` : ''}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void remove(o.id)}
                                    className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white"
                                >
                                    Delete
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

// ─── Loaner fleet tab ───────────────────────────────────────────────────────

function LoanerFleetTab({
    onFlash,
    role,
}: {
    onFlash: (kind: 'ok' | 'err', message: string) => void;
    role: string | null;
}) {
    const roleSuffix = role ? `?role=${encodeURIComponent(role)}` : '';
    const [vehicles, setVehicles] = useState<LoanerVehicleRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [showAdd, setShowAdd] = useState(false);

    const [make, setMake] = useState('');
    const [model, setModel] = useState('');
    const [year, setYear] = useState(new Date().getFullYear());
    const [plate, setPlate] = useState('');
    const [color, setColor] = useState('');
    const [notes, setNotes] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetch(`/api/manager/loaners/vehicles${roleSuffix}`, { cache: 'no-store' });
            const payload = (await r.json()) as VehiclesResponse;
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            setVehicles(payload.vehicles);
        } catch (err) {
            onFlash('err', err instanceof Error ? err.message : 'Failed to load fleet');
        } finally {
            setLoading(false);
        }
    }, [onFlash, roleSuffix]);

    useEffect(() => {
        void load();
    }, [load]);

    async function toggleAvailable(v: LoanerVehicleRow) {
        setBusy(v.id);
        try {
            const r = await fetch(`/api/manager/loaners/vehicles/${v.id}${roleSuffix}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_available: !v.is_available }),
            });
            const payload = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
            await load();
        } catch (err) {
            onFlash('err', err instanceof Error ? err.message : 'Update failed');
        } finally {
            setBusy(null);
        }
    }

    async function remove(v: LoanerVehicleRow) {
        if (!window.confirm(`Remove ${v.year} ${v.make} ${v.model} from the fleet?`)) return;
        setBusy(v.id);
        try {
            const r = await fetch(`/api/manager/loaners/vehicles/${v.id}${roleSuffix}`, {
                method: 'DELETE',
            });
            const payload = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
            onFlash('ok', 'Loaner vehicle archived (set unavailable).');
            await load();
        } catch (err) {
            onFlash('err', err instanceof Error ? err.message : 'Delete failed');
        } finally {
            setBusy(null);
        }
    }

    async function addVehicle(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!make || !model || !plate) {
            onFlash('err', 'make, model, license_plate are required');
            return;
        }
        setBusy('__new__');
        try {
            const r = await fetch(`/api/manager/loaners/vehicles${roleSuffix}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    make,
                    model,
                    year,
                    license_plate: plate,
                    color: color || null,
                    notes: notes || null,
                }),
            });
            const payload = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
            onFlash('ok', 'Loaner vehicle added.');
            setShowAdd(false);
            setMake('');
            setModel('');
            setYear(new Date().getFullYear());
            setPlate('');
            setColor('');
            setNotes('');
            await load();
        } catch (err) {
            onFlash('err', err instanceof Error ? err.message : 'Add failed');
        } finally {
            setBusy(null);
        }
    }

    const sorted = useMemo(
        () =>
            [...vehicles].sort((a, b) => {
                if (a.is_available !== b.is_available) return a.is_available ? -1 : 1;
                return `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`);
            }),
        [vehicles],
    );

    return (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">
                    Courtesy vehicles ({vehicles.length})
                </p>
                <button
                    type="button"
                    onClick={() => setShowAdd((v) => !v)}
                    className="rounded-full border border-red-500/40 bg-red-600/15 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-red-100 transition hover:border-red-400 hover:bg-red-600/25 hover:text-white"
                >
                    {showAdd ? 'Cancel' : 'Add vehicle'}
                </button>
            </div>

            {showAdd && (
                <form
                    onSubmit={addVehicle}
                    className="mb-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-4"
                >
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <label className="flex flex-col gap-1 text-xs">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Make *</span>
                            <input
                                value={make}
                                onChange={(e) => setMake(e.target.value)}
                                required
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-xs">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Model *</span>
                            <input
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                                required
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-xs">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Year *</span>
                            <input
                                type="number"
                                min={1990}
                                max={2100}
                                value={year}
                                onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
                                required
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-xs">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">License plate *</span>
                            <input
                                value={plate}
                                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                                required
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-mono uppercase text-white outline-none focus:border-red-500"
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-xs">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Color</span>
                            <input
                                value={color}
                                onChange={(e) => setColor(e.target.value)}
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-xs sm:col-span-2 lg:col-span-3">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Notes</span>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={2}
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            />
                        </label>
                    </div>
                    <button
                        type="submit"
                        disabled={busy === '__new__'}
                        className="mt-4 rounded-2xl bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-900 disabled:text-zinc-400"
                    >
                        {busy === '__new__' ? 'Adding…' : 'Add vehicle'}
                    </button>
                </form>
            )}

            {loading ? (
                <div className="h-32 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-950" />
            ) : sorted.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-6 text-center text-sm text-zinc-400">
                    No loaner vehicles configured yet.
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="border-b border-zinc-800 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                            <tr>
                                <th className="px-3 py-3 font-semibold">Vehicle</th>
                                <th className="px-3 py-3 font-semibold">Plate</th>
                                <th className="px-3 py-3 font-semibold">Color</th>
                                <th className="px-3 py-3 font-semibold">Status</th>
                                <th className="px-3 py-3 text-right font-semibold">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((v) => (
                                <tr key={v.id} className="border-b border-zinc-800/60 last:border-b-0">
                                    <td className="px-3 py-3">
                                        <p className="font-bold text-white">{v.year} {v.make} {v.model}</p>
                                        {v.notes && <p className="mt-0.5 text-xs text-zinc-400">{v.notes}</p>}
                                    </td>
                                    <td className="px-3 py-3 font-mono text-xs text-zinc-200">{v.license_plate}</td>
                                    <td className="px-3 py-3 text-zinc-300">{v.color ?? '—'}</td>
                                    <td className="px-3 py-3">
                                        <span
                                            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${
                                                v.is_available
                                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                                                    : 'border-zinc-700 bg-zinc-950 text-zinc-300'
                                            }`}
                                        >
                                            {v.is_available ? 'Available' : 'Unavailable'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-3 text-right">
                                        <button
                                            type="button"
                                            disabled={busy === v.id}
                                            onClick={() => void toggleAvailable(v)}
                                            className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white disabled:opacity-40"
                                        >
                                            {v.is_available ? 'Mark unavailable' : 'Mark available'}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={busy === v.id}
                                            onClick={() => void remove(v)}
                                            className="ml-2 rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white disabled:opacity-40"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
