'use client';

import { useCallback, useEffect, useState } from 'react';

// Phase 9b — service-floor assignment panel. Renders next to (or on) a
// repair-order detail surface. Handles three actions against the
// /api/repair-orders/[id] endpoint:
//
//   - Assign technicians (multi-select from /api/employees)
//   - Mark the service complete (modal with time + notes)
//   - Extend the ETA (modal with new date + reason dropdown + notes)

interface Employee {
    employeeId: string;
    name: string;
    specialty?: string;
    source: 'fortellis' | 'mock';
}

interface RepairOrderAssignment {
    id: string;
    repair_order_id: string;
    tech_ids: string[];
    tech_names: string[];
    service_status: string;
    estimated_completion: string | null;
    actual_completion: string | null;
    extended_until: string | null;
    extension_reason: string | null;
    notes: string | null;
}

interface Props {
    repairOrderId: string;
    initialStatus?: string;
}

const EXTENSION_REASONS = [
    'Parts delay',
    'Additional work discovered',
    'Customer requested',
    'Quality check failed',
    'Other',
] as const;

export function TechAssignmentPanel({ repairOrderId, initialStatus }: Props) {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [selectedTechs, setSelectedTechs] = useState<Employee[]>([]);
    const [assignment, setAssignment] = useState<RepairOrderAssignment | null>(null);
    const [loading, setLoading] = useState(false);
    const [actionFor, setActionFor] = useState<'assign' | 'complete' | 'extend' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    const [showComplete, setShowComplete] = useState(false);
    const [showExtend, setShowExtend] = useState(false);
    const [completeNotes, setCompleteNotes] = useState('');
    const [extendDate, setExtendDate] = useState('');
    const [extendReason, setExtendReason] = useState<string>(EXTENSION_REASONS[0]);
    const [extendNotes, setExtendNotes] = useState('');

    const loadEmployees = useCallback(async () => {
        try {
            const r = await fetch('/api/employees?type=technician', { cache: 'no-store' });
            if (!r.ok) return;
            const payload = (await r.json()) as { employees: Employee[] };
            setEmployees(payload.employees ?? []);
        } catch {
            // Non-fatal — dropdown stays empty.
        }
    }, []);

    const loadAssignment = useCallback(async () => {
        try {
            const r = await fetch(`/api/repair-orders/${encodeURIComponent(repairOrderId)}`, { cache: 'no-store' });
            if (!r.ok) return;
            const payload = (await r.json()) as { repair_order_assignment: RepairOrderAssignment | null };
            if (payload.repair_order_assignment) {
                setAssignment(payload.repair_order_assignment);
                // Pre-populate selected techs from the existing assignment.
                const ids = payload.repair_order_assignment.tech_ids;
                const names = payload.repair_order_assignment.tech_names;
                const prefill: Employee[] = ids.map((id, i) => ({
                    employeeId: id,
                    name: names[i] ?? id,
                    source: 'mock',
                }));
                if (prefill.length > 0) setSelectedTechs(prefill);
            }
        } catch {
            // Non-fatal.
        }
    }, [repairOrderId]);

    useEffect(() => {
        void loadEmployees();
        void loadAssignment();
    }, [loadEmployees, loadAssignment]);

    useEffect(() => {
        if (!toast) return;
        const t = window.setTimeout(() => setToast(null), 3500);
        return () => window.clearTimeout(t);
    }, [toast]);

    function addTech(emp: Employee) {
        setSelectedTechs((current) => {
            if (current.some((t) => t.employeeId === emp.employeeId)) return current;
            return [...current, emp];
        });
    }

    function removeTech(employeeId: string) {
        setSelectedTechs((current) => current.filter((t) => t.employeeId !== employeeId));
    }

    async function postAction(action: 'assign' | 'complete' | 'extend', body: Record<string, unknown>) {
        setActionFor(action);
        setError(null);
        try {
            const r = await fetch(`/api/repair-orders/${encodeURIComponent(repairOrderId)}?action=${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!r.ok) {
                const b = await r.json().catch(() => ({}));
                throw new Error(typeof b?.error === 'string' ? b.error : `HTTP ${r.status}`);
            }
            const payload = (await r.json()) as { repair_order_assignment: RepairOrderAssignment };
            setAssignment(payload.repair_order_assignment);
            setToast(
                action === 'assign'
                    ? 'Technicians assigned.'
                    : action === 'complete'
                    ? 'Service marked complete.'
                    : 'ETA extended.',
            );
            if (action === 'complete') setShowComplete(false);
            if (action === 'extend') setShowExtend(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update repair order');
        } finally {
            setActionFor(null);
        }
    }

    function assignTechs() {
        if (selectedTechs.length === 0) {
            setError('Pick at least one technician.');
            return;
        }
        void postAction('assign', {
            techIds: selectedTechs.map((t) => t.employeeId),
            techNames: selectedTechs.map((t) => t.name),
            assignedBy: 'service_desk',
        });
    }

    function submitComplete() {
        void postAction('complete', {
            completedAt: new Date().toISOString(),
            notes: completeNotes.trim() || null,
        });
    }

    function submitExtend() {
        if (!extendDate) {
            setError('Pick the new ETA.');
            return;
        }
        void postAction('extend', {
            newDate: new Date(extendDate).toISOString(),
            reason: extendReason,
            notes: extendNotes.trim() || null,
        });
    }

    void loading;
    const currentStatus = assignment?.service_status ?? initialStatus ?? 'in_progress';
    const isCompleted = currentStatus === 'completed';

    return (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="mb-4 flex items-end justify-between">
                <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Service floor</p>
                    <h3 className="mt-2 text-2xl font-black text-white">Technician assignment</h3>
                </div>
                <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-200">
                    {currentStatus.replace(/_/g, ' ')}
                </span>
            </div>

            <p className="text-xs text-zinc-500">RO: <code className="text-zinc-300">{repairOrderId}</code></p>

            {/* Tech selection */}
            <div className="mt-5">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Assign technicians</p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {selectedTechs.map((t) => (
                        <span
                            key={t.employeeId}
                            className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs text-red-100"
                        >
                            {t.name}
                            <button
                                type="button"
                                onClick={() => removeTech(t.employeeId)}
                                aria-label={`Remove ${t.name}`}
                                className="text-red-200 transition hover:text-white"
                            >
                                ×
                            </button>
                        </span>
                    ))}
                    {selectedTechs.length === 0 && (
                        <span className="text-xs italic text-zinc-500">None selected</span>
                    )}
                </div>
                <select
                    className="mt-3 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                    value=""
                    disabled={isCompleted}
                    onChange={(e) => {
                        const emp = employees.find((x) => x.employeeId === e.target.value);
                        if (emp) addTech(emp);
                    }}
                >
                    <option value="">Add a technician…</option>
                    {employees.map((emp) => (
                        <option key={emp.employeeId} value={emp.employeeId}>
                            {emp.name}
                            {emp.specialty ? ` · ${emp.specialty}` : ''}
                        </option>
                    ))}
                </select>
                <div className="mt-3 flex flex-wrap gap-2">
                    <button
                        type="button"
                        disabled={actionFor === 'assign' || isCompleted}
                        onClick={assignTechs}
                        className="rounded-2xl bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-900 disabled:text-zinc-400"
                    >
                        {actionFor === 'assign' ? 'Assigning…' : 'Assign'}
                    </button>
                    <button
                        type="button"
                        disabled={actionFor !== null || isCompleted}
                        onClick={() => setShowComplete(true)}
                        className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                        Mark complete
                    </button>
                    <button
                        type="button"
                        disabled={actionFor !== null || isCompleted}
                        onClick={() => setShowExtend(true)}
                        className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-amber-200 transition hover:border-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
                    >
                        Extend ETA
                    </button>
                </div>
            </div>

            {assignment?.actual_completion && (
                <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-100">
                    Completed at {new Date(assignment.actual_completion).toLocaleString('en-CA')}
                    {assignment.notes ? ` — ${assignment.notes}` : ''}
                </p>
            )}
            {assignment?.extended_until && currentStatus === 'extended' && (
                <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                    Extended to {new Date(assignment.extended_until).toLocaleDateString('en-CA')}
                    {assignment.extension_reason ? ` — ${assignment.extension_reason}` : ''}
                </p>
            )}

            {error && (
                <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">{error}</p>
            )}

            {/* Mark complete modal */}
            {showComplete && (
                <Modal title="Mark service complete" onClose={() => setShowComplete(false)}>
                    <p className="text-xs text-zinc-400">
                        Completion time defaults to now. Add any notes the next advisor needs.
                    </p>
                    <textarea
                        value={completeNotes}
                        onChange={(e) => setCompleteNotes(e.target.value)}
                        rows={3}
                        placeholder="e.g. Front brake pads also replaced — invoice updated."
                        className="mt-3 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                    />
                    <ModalActions
                        onCancel={() => setShowComplete(false)}
                        primaryLabel={actionFor === 'complete' ? 'Saving…' : 'Mark complete'}
                        onPrimary={submitComplete}
                        primaryDisabled={actionFor === 'complete'}
                    />
                </Modal>
            )}

            {/* Extend ETA modal */}
            {showExtend && (
                <Modal title="Extend ETA" onClose={() => setShowExtend(false)}>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">New ETA</span>
                        <input
                            type="datetime-local"
                            value={extendDate}
                            onChange={(e) => setExtendDate(e.target.value)}
                            className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                        />
                    </label>
                    <label className="mt-3 flex flex-col gap-1">
                        <span className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Reason</span>
                        <select
                            value={extendReason}
                            onChange={(e) => setExtendReason(e.target.value)}
                            className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                        >
                            {EXTENSION_REASONS.map((r) => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                    </label>
                    <textarea
                        value={extendNotes}
                        onChange={(e) => setExtendNotes(e.target.value)}
                        rows={3}
                        placeholder="Extra context for the customer call back."
                        className="mt-3 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                    />
                    <ModalActions
                        onCancel={() => setShowExtend(false)}
                        primaryLabel={actionFor === 'extend' ? 'Saving…' : 'Extend ETA'}
                        onPrimary={submitExtend}
                        primaryDisabled={actionFor === 'extend'}
                    />
                </Modal>
            )}

            {toast && (
                <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
                    <div className="pointer-events-auto rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-3 text-sm font-semibold text-emerald-100 shadow-2xl shadow-black/40">
                        {toast}
                    </div>
                </div>
            )}
        </section>
    );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
    return (
        <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4"
            role="dialog"
            aria-modal="true"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl shadow-black/50"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-3 flex items-start justify-between">
                    <h3 className="text-lg font-black text-white">{title}</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                    >
                        Close
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}

function ModalActions({
    onCancel,
    onPrimary,
    primaryLabel,
    primaryDisabled,
}: {
    onCancel: () => void;
    onPrimary: () => void;
    primaryLabel: string;
    primaryDisabled?: boolean;
}) {
    return (
        <div className="mt-5 flex items-center justify-end gap-3">
            <button
                type="button"
                onClick={onCancel}
                className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-zinc-500 hover:text-white"
            >
                Cancel
            </button>
            <button
                type="button"
                disabled={primaryDisabled}
                onClick={onPrimary}
                className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-900 disabled:text-zinc-400"
            >
                {primaryLabel}
            </button>
        </div>
    );
}
