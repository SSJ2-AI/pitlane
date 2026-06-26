'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { LoanerVehicleRow } from '@/lib/supabase';

// LoanerRequestModal — Phase 13 manual loaner-request entry from the
// customer profile. Visible to all authenticated dashboard roles.
//
// Pre-fills the customer name (read-only display), exposes the
// customer's vehicles as a dropdown, defaults the pickup date to
// tomorrow and the return to pickup+3, and queries
// /api/manager/loaners/vehicles?available_from=&available_to= for the
// available loaner dropdown. Submits to POST /api/loaner-requests.

interface VehicleOption {
    id: string;
    label: string;
}

interface LoanerRequestModalProps {
    open: boolean;
    onClose: () => void;
    customerId: string;
    customerName: string;
    vehicles: VehicleOption[];
    onSuccess?: () => void;
}

function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
}

export function LoanerRequestModal({
    open,
    onClose,
    customerId,
    customerName,
    vehicles,
    onSuccess,
}: LoanerRequestModalProps) {
    const tomorrow = isoDate(addDays(new Date(), 1));
    const returnDefault = isoDate(addDays(new Date(), 4));

    const [vehicleId, setVehicleId] = useState<string>(vehicles[0]?.id ?? '');
    const [startDate, setStartDate] = useState<string>(tomorrow);
    const [endDate, setEndDate] = useState<string>(returnDefault);
    const [notes, setNotes] = useState('');
    const [loaners, setLoaners] = useState<LoanerVehicleRow[]>([]);
    const [loanerId, setLoanerId] = useState<string>('');
    const [loadingLoaners, setLoadingLoaners] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const refreshLoaners = useCallback(async () => {
        if (!open) return;
        setLoadingLoaners(true);
        try {
            const url = `/api/manager/loaners/vehicles?available_from=${encodeURIComponent(startDate)}&available_to=${encodeURIComponent(endDate)}`;
            const r = await fetch(url, { cache: 'no-store' });
            if (!r.ok) {
                setLoaners([]);
                return;
            }
            const payload = (await r.json()) as { vehicles?: LoanerVehicleRow[] };
            setLoaners(payload.vehicles ?? []);
        } catch {
            setLoaners([]);
        } finally {
            setLoadingLoaners(false);
        }
    }, [open, startDate, endDate]);

    useEffect(() => {
        void refreshLoaners();
    }, [refreshLoaners]);

    useEffect(() => {
        if (open) {
            setVehicleId(vehicles[0]?.id ?? '');
            setStartDate(tomorrow);
            setEndDate(returnDefault);
            setNotes('');
            setLoanerId('');
            setError(null);
            setSuccess(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    if (!open) return null;

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        setSuccess(null);
        setSubmitting(true);
        try {
            const r = await fetch('/api/loaner-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer_id: customerId,
                    vehicle_id: vehicleId || null,
                    loaner_vehicle_id: loanerId || null,
                    start_date: startDate,
                    end_date: endDate,
                    notes: notes || null,
                }),
            });
            const payload = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
            setSuccess('Loaner request submitted — service desk will confirm.');
            onSuccess?.();
            window.setTimeout(() => {
                onClose();
            }, 1200);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Submission failed');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="loaner-request-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-5 flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.32em] text-red-400">Loaner</p>
                        <h3 id="loaner-request-title" className="mt-2 text-2xl font-black tracking-tight text-white">
                            Request loaner vehicle
                        </h3>
                        <p className="mt-1 text-xs text-zinc-400">{customerName}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs font-bold text-zinc-300 transition hover:border-red-500 hover:text-white"
                    >
                        ✕
                    </button>
                </div>

                {error && <div className="mb-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}
                {success && <div className="mb-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{success}</div>}

                <form onSubmit={submit} className="space-y-4">
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Customer</span>
                        <input
                            value={customerName}
                            readOnly
                            className="rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300"
                        />
                    </label>

                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Vehicle being serviced</span>
                        <select
                            value={vehicleId}
                            onChange={(e) => setVehicleId(e.target.value)}
                            className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                        >
                            {vehicles.length === 0 && <option value="">No vehicles on file</option>}
                            {vehicles.map((v) => (
                                <option key={v.id} value={v.id}>{v.label}</option>
                            ))}
                        </select>
                    </label>

                    <div className="grid grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Pickup date</span>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                required
                                className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Est. return date</span>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                required
                                className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            />
                        </label>
                    </div>

                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                            Available loaner
                            {loadingLoaners && <span className="ml-2 text-zinc-400">loading…</span>}
                        </span>
                        <select
                            value={loanerId}
                            onChange={(e) => setLoanerId(e.target.value)}
                            className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                        >
                            {loaners.length === 0 ? (
                                <option value="">Vehicle will be assigned by service team</option>
                            ) : (
                                <>
                                    <option value="">— No preference (service team picks) —</option>
                                    {loaners.map((v) => (
                                        <option key={v.id} value={v.id}>
                                            {v.year} {v.make} {v.model}
                                            {v.color ? ` · ${v.color}` : ''}
                                        </option>
                                    ))}
                                </>
                            )}
                        </select>
                    </label>

                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Notes</span>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={3}
                            placeholder="Pickup time, additional drivers, accessibility needs…"
                            className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                        />
                    </label>

                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="rounded-2xl bg-red-600 px-5 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-900 disabled:text-zinc-400"
                        >
                            {submitting ? 'Submitting…' : 'Submit request'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
