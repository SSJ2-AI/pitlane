'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import type { LoanerVehicleRow, ScheduleOverrideRow, ServiceScheduleRow } from '@/lib/supabase';

type TabId = 'schedule' | 'overrides' | 'loaners';

interface ToastState {
    type: 'success' | 'error';
    message: string;
}

interface DayScheduleDraft {
    day_of_week: number;
    open_time: string;
    close_time: string;
    slot_duration_mins: number;
    max_concurrent_bookings: number;
    is_active: boolean;
}

interface OverrideFormState {
    override_date: string;
    mode: 'blocked' | 'custom';
    open_time: string;
    close_time: string;
    max_concurrent_bookings: string;
    reason: string;
}

interface NewVehicleState {
    make: string;
    model: string;
    year: string;
    license_plate: string;
    color: string;
    notes: string;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function defaultScheduleForDay(day_of_week: number): DayScheduleDraft {
    return {
        day_of_week,
        open_time: '08:00',
        close_time: '18:00',
        slot_duration_mins: 60,
        max_concurrent_bookings: 3,
        is_active: true,
    };
}

function tomorrowIso(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

function plusDaysIso(baseIso: string, days: number): string {
    const d = new Date(`${baseIso}T00:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

export function ManagerCalendarClient() {
    const [tab, setTab] = useState<TabId>('schedule');
    const [toast, setToast] = useState<ToastState | null>(null);

    const [scheduleRows, setScheduleRows] = useState<DayScheduleDraft[]>(
        () => Array.from({ length: 7 }, (_, i) => defaultScheduleForDay(i)),
    );
    const [scheduleBusy, setScheduleBusy] = useState(false);

    const [overrides, setOverrides] = useState<ScheduleOverrideRow[]>([]);
    const [overrideBusy, setOverrideBusy] = useState(false);
    const [overrideForm, setOverrideForm] = useState<OverrideFormState>(() => {
        const start = tomorrowIso();
        return {
            override_date: start,
            mode: 'blocked',
            open_time: '09:00',
            close_time: '17:00',
            max_concurrent_bookings: '3',
            reason: '',
        };
    });

    const [vehicles, setVehicles] = useState<LoanerVehicleRow[]>([]);
    const [vehicleBusyId, setVehicleBusyId] = useState<string | null>(null);
    const [showAddVehicle, setShowAddVehicle] = useState(false);
    const [newVehicle, setNewVehicle] = useState<NewVehicleState>({
        make: '',
        model: '',
        year: '',
        license_plate: '',
        color: '',
        notes: '',
    });

    const showToast = useCallback((next: ToastState) => {
        setToast(next);
        window.setTimeout(() => setToast(null), 2800);
    }, []);

    const loadSchedule = useCallback(async () => {
        try {
            const response = await fetch('/api/manager/schedule', { cache: 'no-store' });
            const payload = (await response.json()) as { schedules?: ServiceScheduleRow[]; error?: string };
            if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
            const base = Array.from({ length: 7 }, (_, i) => defaultScheduleForDay(i));
            for (const row of payload.schedules ?? []) {
                base[row.day_of_week] = {
                    day_of_week: row.day_of_week,
                    open_time: row.open_time?.slice(0, 5) ?? '08:00',
                    close_time: row.close_time?.slice(0, 5) ?? '18:00',
                    slot_duration_mins: row.slot_duration_mins ?? 60,
                    max_concurrent_bookings: row.max_concurrent_bookings ?? 3,
                    is_active: row.is_active ?? true,
                };
            }
            setScheduleRows(base);
        } catch (err) {
            showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to load schedule' });
        }
    }, [showToast]);

    const loadOverrides = useCallback(async () => {
        try {
            const response = await fetch('/api/manager/schedule/overrides', { cache: 'no-store' });
            const payload = (await response.json()) as { overrides?: ScheduleOverrideRow[]; error?: string };
            if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
            setOverrides(payload.overrides ?? []);
        } catch (err) {
            showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to load overrides' });
        }
    }, [showToast]);

    const loadVehicles = useCallback(async () => {
        try {
            const response = await fetch('/api/manager/loaners/vehicles', { cache: 'no-store' });
            const payload = (await response.json()) as { vehicles?: LoanerVehicleRow[]; error?: string };
            if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
            setVehicles(payload.vehicles ?? []);
        } catch (err) {
            showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to load loaner fleet' });
        }
    }, [showToast]);

    useEffect(() => {
        void Promise.all([loadSchedule(), loadOverrides(), loadVehicles()]);
    }, [loadOverrides, loadSchedule, loadVehicles]);

    const sortedOverrides = useMemo(
        () => [...overrides].sort((a, b) => (a.override_date < b.override_date ? -1 : 1)),
        [overrides],
    );

    async function saveSchedule() {
        setScheduleBusy(true);
        try {
            const response = await fetch('/api/manager/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(scheduleRows),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
            showToast({ type: 'success', message: 'Schedule saved.' });
            await loadSchedule();
        } catch (err) {
            showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save schedule' });
        } finally {
            setScheduleBusy(false);
        }
    }

    async function saveOverride() {
        setOverrideBusy(true);
        try {
            const response = await fetch('/api/manager/schedule/overrides', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    override_date: overrideForm.override_date,
                    is_blocked: overrideForm.mode === 'blocked',
                    reason: overrideForm.reason.trim() || null,
                    open_time: overrideForm.mode === 'custom' ? overrideForm.open_time : null,
                    close_time: overrideForm.mode === 'custom' ? overrideForm.close_time : null,
                    max_concurrent_bookings:
                        overrideForm.mode === 'custom' && overrideForm.max_concurrent_bookings
                            ? Number(overrideForm.max_concurrent_bookings)
                            : null,
                }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
            showToast({ type: 'success', message: 'Override saved.' });
            await loadOverrides();
            setOverrideForm((current) => ({
                ...current,
                reason: '',
            }));
        } catch (err) {
            showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save override' });
        } finally {
            setOverrideBusy(false);
        }
    }

    async function deleteOverride(id: string) {
        setOverrideBusy(true);
        try {
            const response = await fetch(`/api/manager/schedule/overrides/${encodeURIComponent(id)}`, {
                method: 'DELETE',
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
            showToast({ type: 'success', message: 'Override deleted.' });
            await loadOverrides();
        } catch (err) {
            showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to delete override' });
        } finally {
            setOverrideBusy(false);
        }
    }

    async function addVehicle() {
        setVehicleBusyId('__new__');
        try {
            const response = await fetch('/api/manager/loaners/vehicles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    make: newVehicle.make.trim(),
                    model: newVehicle.model.trim(),
                    year: Number(newVehicle.year),
                    license_plate: newVehicle.license_plate.trim(),
                    color: newVehicle.color.trim() || null,
                    notes: newVehicle.notes.trim() || null,
                }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
            showToast({ type: 'success', message: 'Loaner vehicle added.' });
            setNewVehicle({ make: '', model: '', year: '', license_plate: '', color: '', notes: '' });
            setShowAddVehicle(false);
            await loadVehicles();
        } catch (err) {
            showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to add vehicle' });
        } finally {
            setVehicleBusyId(null);
        }
    }

    async function toggleAvailability(vehicle: LoanerVehicleRow) {
        setVehicleBusyId(vehicle.id);
        try {
            const response = await fetch(`/api/manager/loaners/vehicles/${encodeURIComponent(vehicle.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_available: !vehicle.is_available }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
            await loadVehicles();
        } catch (err) {
            showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to update vehicle' });
        } finally {
            setVehicleBusyId(null);
        }
    }

    async function softDeleteVehicle(vehicle: LoanerVehicleRow) {
        setVehicleBusyId(vehicle.id);
        try {
            const response = await fetch(`/api/manager/loaners/vehicles/${encodeURIComponent(vehicle.id)}`, {
                method: 'DELETE',
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
            showToast({ type: 'success', message: 'Vehicle marked unavailable.' });
            await loadVehicles();
        } catch (err) {
            showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to delete vehicle' });
        } finally {
            setVehicleBusyId(null);
        }
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
                        <Link href="/manager/departments" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Departments</Link>
                        <Link href="/manager/staff" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Staff</Link>
                        <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200">Calendar</span>
                    </nav>
                </div>
            </header>

            {toast && (
                <div className={`fixed right-4 top-4 z-50 rounded-xl border px-4 py-3 text-sm shadow-xl ${
                    toast.type === 'success'
                        ? 'border-emerald-500/50 bg-emerald-600/20 text-emerald-100'
                        : 'border-red-500/50 bg-red-600/20 text-red-100'
                }`}>
                    {toast.message}
                </div>
            )}

            <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
                <div className="mb-6 flex flex-wrap gap-2">
                    <TabButton id="schedule" active={tab} onClick={setTab}>Weekly Schedule</TabButton>
                    <TabButton id="overrides" active={tab} onClick={setTab}>Date Overrides</TabButton>
                    <TabButton id="loaners" active={tab} onClick={setTab}>Loaner Fleet</TabButton>
                </div>

                {tab === 'schedule' && (
                    <section className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {scheduleRows.map((row) => (
                                <div key={row.day_of_week} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                                    <div className="mb-3 flex items-center justify-between">
                                        <p className="text-sm font-black text-white">{DAYS[row.day_of_week]}</p>
                                        <label className="flex items-center gap-2 text-xs text-zinc-300">
                                            <input
                                                type="checkbox"
                                                checked={row.is_active}
                                                onChange={(e) => {
                                                    setScheduleRows((current) => current.map((s) => (
                                                        s.day_of_week === row.day_of_week ? { ...s, is_active: e.target.checked } : s
                                                    )));
                                                }}
                                            />
                                            Active
                                        </label>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        <label className="flex flex-col gap-1 text-xs text-zinc-400">
                                            Open
                                            <input
                                                type="time"
                                                value={row.open_time}
                                                onChange={(e) => {
                                                    setScheduleRows((current) => current.map((s) => (
                                                        s.day_of_week === row.day_of_week ? { ...s, open_time: e.target.value } : s
                                                    )));
                                                }}
                                                className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 text-sm text-white outline-none focus:border-red-500"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1 text-xs text-zinc-400">
                                            Close
                                            <input
                                                type="time"
                                                value={row.close_time}
                                                onChange={(e) => {
                                                    setScheduleRows((current) => current.map((s) => (
                                                        s.day_of_week === row.day_of_week ? { ...s, close_time: e.target.value } : s
                                                    )));
                                                }}
                                                className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 text-sm text-white outline-none focus:border-red-500"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1 text-xs text-zinc-400">
                                            Slot duration
                                            <select
                                                value={row.slot_duration_mins}
                                                onChange={(e) => {
                                                    setScheduleRows((current) => current.map((s) => (
                                                        s.day_of_week === row.day_of_week
                                                            ? { ...s, slot_duration_mins: Number(e.target.value) }
                                                            : s
                                                    )));
                                                }}
                                                className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 text-sm text-white outline-none focus:border-red-500"
                                            >
                                                <option value={30}>30 min</option>
                                                <option value={60}>60 min</option>
                                                <option value={90}>90 min</option>
                                            </select>
                                        </label>
                                        <label className="flex flex-col gap-1 text-xs text-zinc-400">
                                            Max concurrent
                                            <input
                                                type="number"
                                                min={1}
                                                value={row.max_concurrent_bookings}
                                                onChange={(e) => {
                                                    setScheduleRows((current) => current.map((s) => (
                                                        s.day_of_week === row.day_of_week
                                                            ? { ...s, max_concurrent_bookings: Number(e.target.value) || 1 }
                                                            : s
                                                    )));
                                                }}
                                                className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 text-sm text-white outline-none focus:border-red-500"
                                            />
                                        </label>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => void saveSchedule()}
                            disabled={scheduleBusy}
                            className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:opacity-60"
                        >
                            {scheduleBusy ? 'Saving…' : 'Save Schedule'}
                        </button>
                    </section>
                )}

                {tab === 'overrides' && (
                    <section className="space-y-6">
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                            <div className="grid gap-3 md:grid-cols-2">
                                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                                    Date
                                    <input
                                        type="date"
                                        value={overrideForm.override_date}
                                        onChange={(e) => setOverrideForm((current) => ({ ...current, override_date: e.target.value }))}
                                        className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 text-sm text-white outline-none focus:border-red-500"
                                    />
                                </label>
                                <div className="flex items-end gap-4">
                                    <label className="flex items-center gap-2 text-sm text-zinc-300">
                                        <input
                                            type="radio"
                                            checked={overrideForm.mode === 'blocked'}
                                            onChange={() => setOverrideForm((current) => ({ ...current, mode: 'blocked' }))}
                                        />
                                        Block this date entirely
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-zinc-300">
                                        <input
                                            type="radio"
                                            checked={overrideForm.mode === 'custom'}
                                            onChange={() => setOverrideForm((current) => ({ ...current, mode: 'custom' }))}
                                        />
                                        Set custom hours
                                    </label>
                                </div>
                            </div>

                            {overrideForm.mode === 'custom' && (
                                <div className="mt-3 grid gap-3 md:grid-cols-3">
                                    <label className="flex flex-col gap-1 text-xs text-zinc-400">
                                        Open
                                        <input
                                            type="time"
                                            value={overrideForm.open_time}
                                            onChange={(e) => setOverrideForm((current) => ({ ...current, open_time: e.target.value }))}
                                            className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 text-sm text-white outline-none focus:border-red-500"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1 text-xs text-zinc-400">
                                        Close
                                        <input
                                            type="time"
                                            value={overrideForm.close_time}
                                            onChange={(e) => setOverrideForm((current) => ({ ...current, close_time: e.target.value }))}
                                            className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 text-sm text-white outline-none focus:border-red-500"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1 text-xs text-zinc-400">
                                        Max concurrent bookings
                                        <input
                                            type="number"
                                            min={1}
                                            value={overrideForm.max_concurrent_bookings}
                                            onChange={(e) => setOverrideForm((current) => ({ ...current, max_concurrent_bookings: e.target.value }))}
                                            className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 text-sm text-white outline-none focus:border-red-500"
                                        />
                                    </label>
                                </div>
                            )}

                            <label className="mt-3 flex flex-col gap-1 text-xs text-zinc-400">
                                Reason
                                <input
                                    type="text"
                                    value={overrideForm.reason}
                                    onChange={(e) => setOverrideForm((current) => ({ ...current, reason: e.target.value }))}
                                    placeholder="Holiday closure, training day, etc."
                                    className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
                                />
                            </label>

                            <button
                                type="button"
                                onClick={() => void saveOverride()}
                                disabled={overrideBusy}
                                className="mt-4 rounded-2xl bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:opacity-60"
                            >
                                {overrideBusy ? 'Saving…' : 'Save Override'}
                            </button>
                        </div>

                        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                            <p className="mb-3 text-sm font-bold text-white">Upcoming overrides</p>
                            {sortedOverrides.length === 0 ? (
                                <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 px-3 py-4 text-sm text-zinc-500">
                                    No upcoming overrides.
                                </p>
                            ) : (
                                <ul className="space-y-2">
                                    {sortedOverrides.map((entry) => (
                                        <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3">
                                            <div>
                                                <p className="text-sm font-bold text-white">{entry.override_date}</p>
                                                <p className="text-xs text-zinc-400">
                                                    {entry.is_blocked
                                                        ? 'Blocked all day'
                                                        : `${entry.open_time?.slice(0, 5) ?? '--:--'} - ${entry.close_time?.slice(0, 5) ?? '--:--'}`}
                                                    {entry.reason ? ` · ${entry.reason}` : ''}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                disabled={overrideBusy}
                                                onClick={() => void deleteOverride(entry.id)}
                                                className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white disabled:opacity-60"
                                            >
                                                Delete
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </section>
                )}

                {tab === 'loaners' && (
                    <section className="space-y-4">
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={() => setShowAddVehicle((current) => !current)}
                                className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-zinc-200 transition hover:border-red-500 hover:text-white"
                            >
                                {showAddVehicle ? 'Close' : 'Add Vehicle'}
                            </button>
                        </div>

                        {showAddVehicle && (
                            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                                <div className="grid gap-3 md:grid-cols-3">
                                    <input
                                        value={newVehicle.make}
                                        onChange={(e) => setNewVehicle((current) => ({ ...current, make: e.target.value }))}
                                        placeholder="Make *"
                                        className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
                                    />
                                    <input
                                        value={newVehicle.model}
                                        onChange={(e) => setNewVehicle((current) => ({ ...current, model: e.target.value }))}
                                        placeholder="Model *"
                                        className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
                                    />
                                    <input
                                        value={newVehicle.year}
                                        onChange={(e) => setNewVehicle((current) => ({ ...current, year: e.target.value }))}
                                        type="number"
                                        placeholder="Year *"
                                        className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
                                    />
                                    <input
                                        value={newVehicle.license_plate}
                                        onChange={(e) => setNewVehicle((current) => ({ ...current, license_plate: e.target.value }))}
                                        placeholder="License plate *"
                                        className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
                                    />
                                    <input
                                        value={newVehicle.color}
                                        onChange={(e) => setNewVehicle((current) => ({ ...current, color: e.target.value }))}
                                        placeholder="Color"
                                        className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
                                    />
                                    <input
                                        value={newVehicle.notes}
                                        onChange={(e) => setNewVehicle((current) => ({ ...current, notes: e.target.value }))}
                                        placeholder="Notes"
                                        className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void addVehicle()}
                                    disabled={vehicleBusyId === '__new__'}
                                    className="mt-3 rounded-2xl bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:opacity-60"
                                >
                                    {vehicleBusyId === '__new__' ? 'Saving…' : 'Save Vehicle'}
                                </button>
                            </div>
                        )}

                        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
                            <table className="w-full text-left text-sm">
                                <thead className="border-b border-zinc-800 bg-zinc-950/60 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                                    <tr>
                                        <th className="px-3 py-3 font-semibold">Vehicle</th>
                                        <th className="px-3 py-3 font-semibold">License</th>
                                        <th className="px-3 py-3 font-semibold">Color</th>
                                        <th className="px-3 py-3 font-semibold">Status</th>
                                        <th className="px-3 py-3 text-right font-semibold">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {vehicles.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-3 py-8 text-center text-sm text-zinc-500">No loaner vehicles on file.</td>
                                        </tr>
                                    )}
                                    {vehicles.map((vehicle) => (
                                        <tr key={vehicle.id} className="border-b border-zinc-800/60 last:border-b-0">
                                            <td className="px-3 py-3 text-white">{vehicle.year} {vehicle.make} {vehicle.model}</td>
                                            <td className="px-3 py-3 text-zinc-300">{vehicle.license_plate}</td>
                                            <td className="px-3 py-3 text-zinc-400">{vehicle.color ?? '—'}</td>
                                            <td className="px-3 py-3">
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${
                                                    vehicle.is_available
                                                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                                                        : 'border-zinc-700 bg-zinc-950 text-zinc-300'
                                                }`}>
                                                    {vehicle.is_available ? 'Available' : 'Unavailable'}
                                                </span>
                                            </td>
                                            <td className="px-3 py-3 text-right">
                                                <div className="inline-flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => void toggleAvailability(vehicle)}
                                                        disabled={vehicleBusyId === vehicle.id}
                                                        className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white disabled:opacity-60"
                                                    >
                                                        Toggle
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => void softDeleteVehicle(vehicle)}
                                                        disabled={vehicleBusyId === vehicle.id}
                                                        className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white disabled:opacity-60"
                                                    >
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
                )}
            </section>
        </main>
    );
}

function TabButton(
    props: { id: TabId; active: TabId; onClick: (id: TabId) => void; children: React.ReactNode },
) {
    const isActive = props.active === props.id;
    return (
        <button
            type="button"
            onClick={() => props.onClick(props.id)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                isActive
                    ? 'border-red-500/40 bg-red-600/15 text-red-200'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-red-500 hover:text-white'
            }`}
        >
            {props.children}
        </button>
    );
}
