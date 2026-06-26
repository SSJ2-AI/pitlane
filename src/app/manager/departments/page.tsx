'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import type { DepartmentRow } from '@/lib/supabase';

// /manager/departments — Phase 9b service-manager console for editing
// the Aria phone-tree routing table.
//
// Role gate (UX only — see src/lib/role.ts for the full caveat):
//   ?role=service_manager   read + write + add + delete
//   ?role=service_advisor   read-only
//   (no role param)         read-only (advisor default)
//
// The dashboard appends the role param onto API requests automatically so
// the server's canEditDepartments check enforces the gate symmetrically.

interface DepartmentsResponse {
    departments: DepartmentRow[];
    role: 'service_manager' | 'service_advisor';
    can_edit: boolean;
    persistence: 'supabase' | 'mock';
}

export default function ManagerDepartmentsPage() {
    return (
        <Suspense fallback={<Fallback />}>
            <Inner />
        </Suspense>
    );
}

function Fallback() {
    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <div className="mx-auto max-w-7xl px-5 py-16 text-center text-sm text-zinc-400 lg:px-8">Loading departments…</div>
        </main>
    );
}

function Inner() {
    const searchParams = useSearchParams();
    const role = searchParams.get('role')?.toLowerCase() ?? 'service_advisor';
    const roleSuffix = `?role=${encodeURIComponent(role)}`;

    const [data, setData] = useState<DepartmentsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [draft, setDraft] = useState<Record<string, DepartmentRow>>({});

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await fetch(`/api/departments${roleSuffix}`, { cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const payload = (await r.json()) as DepartmentsResponse;
            setData(payload);
            setDraft(Object.fromEntries(payload.departments.map((d) => [d.id, { ...d }])));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load departments');
        } finally {
            setLoading(false);
        }
    }, [roleSuffix]);

    useEffect(() => {
        void load();
    }, [load]);

    function patchDraft(id: string, patch: Partial<DepartmentRow>) {
        setDraft((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    }

    async function saveRow(id: string) {
        setBusy(id);
        setError(null);
        try {
            const d = draft[id];
            const r = await fetch(`/api/departments/${id}${roleSuffix}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'x-pitlane-role': role },
                body: JSON.stringify({
                    name: d.name,
                    phone_number: d.phone_number,
                    extension: d.extension,
                    display_name: d.display_name,
                    display_order: d.display_order,
                }),
            });
            const payload = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setBusy(null);
        }
    }

    async function deleteRow(id: string) {
        if (!confirm('Delete this department? Aria will lose this transfer route.')) return;
        setBusy(id);
        setError(null);
        try {
            const r = await fetch(`/api/departments/${id}${roleSuffix}`, {
                method: 'DELETE',
                headers: { 'x-pitlane-role': role },
            });
            const payload = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Delete failed');
        } finally {
            setBusy(null);
        }
    }

    async function addRow(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        const payload = {
            name: String(formData.get('name') ?? ''),
            display_name: String(formData.get('display_name') ?? ''),
            phone_number: String(formData.get('phone_number') ?? '') || null,
            extension: String(formData.get('extension') ?? '') || null,
            display_order: Number(formData.get('display_order') ?? 99),
        };
        setBusy('__new__');
        setError(null);
        try {
            const r = await fetch(`/api/departments${roleSuffix}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-pitlane-role': role },
                body: JSON.stringify(payload),
            });
            const body = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
            form.reset();
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add department');
        } finally {
            setBusy(null);
        }
    }

    const canEdit = data?.can_edit ?? false;

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100 shadow-lg shadow-red-950/30">PL</div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Manager console</p>
                        </div>
                    </Link>
                    <nav className="flex flex-wrap items-center gap-3">
                        <VoiceStatusDot />
                        <Link href="/dashboard" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Dashboard</Link>
                        <Link href="/service-desk" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Service desk</Link>
                        <Link href="/manager/calendar" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Calendar</Link>
                        <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200">Departments</span>
                    </nav>
                </div>
            </header>

            <section className="mx-auto max-w-5xl px-5 py-8 lg:px-8">
                <div className="mb-6 flex flex-col gap-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.4em] text-red-400">Phone tree</p>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Departments</h2>
                        <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${canEdit ? 'border-red-500/40 bg-red-600/15 text-red-200' : 'border-zinc-700 bg-zinc-950 text-zinc-300'}`}>
                            {canEdit ? 'Service Manager · read + write' : 'Service Advisor · read only'}
                        </span>
                    </div>
                    <p className="max-w-3xl text-sm leading-6 text-zinc-400">
                        Aria reads this table to route the <code className="rounded bg-zinc-800 px-1.5">transfer_call</code> tool. Phone number and optional extension feed Twilio&apos;s
                        <code className="rounded bg-zinc-800 px-1.5">&lt;Dial&gt;</code> verb directly. This is PitLane metadata only — not pulled from CDK.
                    </p>
                    {!canEdit && (
                        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
                            Read-only view. Append <code className="rounded bg-amber-500/20 px-1.5">?role=service_manager</code> to the URL to enable editing.
                        </p>
                    )}
                </div>

                {error && <div className="mb-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-100">{error}</div>}

                {loading && !data && <div className="h-64 animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900" />}

                {data && (
                    <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900">
                        <table className="w-full text-left text-sm">
                            <thead className="border-b border-zinc-800 bg-zinc-950/60 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                                <tr>
                                    <th className="px-4 py-3 font-semibold">Order</th>
                                    <th className="px-4 py-3 font-semibold">Internal name</th>
                                    <th className="px-4 py-3 font-semibold">Display name</th>
                                    <th className="px-4 py-3 font-semibold">Phone number</th>
                                    <th className="px-4 py-3 font-semibold">Ext</th>
                                    {canEdit && <th className="px-4 py-3 text-right font-semibold">Actions</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {data.departments.length === 0 && (
                                    <tr>
                                        <td colSpan={canEdit ? 6 : 5} className="px-4 py-10 text-center text-sm text-zinc-500">
                                            No departments configured.
                                        </td>
                                    </tr>
                                )}
                                {data.departments.map((row) => {
                                    const d = draft[row.id] ?? row;
                                    const dirty =
                                        d.name !== row.name ||
                                        d.display_name !== row.display_name ||
                                        d.phone_number !== row.phone_number ||
                                        d.extension !== row.extension ||
                                        d.display_order !== row.display_order;
                                    return (
                                        <tr key={row.id} className="border-b border-zinc-800/60 last:border-b-0 hover:bg-zinc-950/40">
                                            <td className="w-20 px-4 py-3">
                                                {canEdit ? (
                                                    <input
                                                        type="number"
                                                        value={d.display_order}
                                                        onChange={(e) => patchDraft(row.id, { display_order: Number(e.target.value) })}
                                                        className="w-16 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white outline-none focus:border-red-500"
                                                    />
                                                ) : (
                                                    <span className="text-zinc-300">{d.display_order}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                {canEdit ? (
                                                    <input
                                                        value={d.name}
                                                        onChange={(e) => patchDraft(row.id, { name: e.target.value })}
                                                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-white outline-none focus:border-red-500"
                                                    />
                                                ) : (
                                                    <code className="text-zinc-300">{d.name}</code>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                {canEdit ? (
                                                    <input
                                                        value={d.display_name}
                                                        onChange={(e) => patchDraft(row.id, { display_name: e.target.value })}
                                                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white outline-none focus:border-red-500"
                                                    />
                                                ) : (
                                                    <span className="font-bold text-white">{d.display_name}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                {canEdit ? (
                                                    <input
                                                        value={d.phone_number ?? ''}
                                                        onChange={(e) => patchDraft(row.id, { phone_number: e.target.value || null })}
                                                        placeholder="+16475550000"
                                                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white outline-none focus:border-red-500"
                                                    />
                                                ) : (
                                                    <span className="text-zinc-300">{d.phone_number ?? '—'}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                {canEdit ? (
                                                    <input
                                                        value={d.extension ?? ''}
                                                        onChange={(e) => patchDraft(row.id, { extension: e.target.value || null })}
                                                        placeholder="opt"
                                                        className="w-20 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white outline-none focus:border-red-500"
                                                    />
                                                ) : (
                                                    <span className="text-zinc-300">{d.extension ?? '—'}</span>
                                                )}
                                            </td>
                                            {canEdit && (
                                                <td className="px-4 py-3 text-right">
                                                    <div className="inline-flex gap-2">
                                                        <button
                                                            type="button"
                                                            disabled={!dirty || busy === row.id}
                                                            onClick={() => void saveRow(row.id)}
                                                            className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40"
                                                        >
                                                            Save
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={busy === row.id}
                                                            onClick={() => void deleteRow(row.id)}
                                                            className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-red-200 disabled:opacity-40"
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {canEdit && (
                    <form onSubmit={addRow} className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                        <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Add department</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                            <label className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Internal name *</span>
                                <input name="name" required placeholder="finance" className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-white outline-none focus:border-red-500" />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Display name *</span>
                                <input name="display_name" required placeholder="Finance Office" className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500" />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Phone number</span>
                                <input name="phone_number" placeholder="+16475550000" className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500" />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Extension</span>
                                <input name="extension" placeholder="201" className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500" />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Order</span>
                                <input name="display_order" type="number" defaultValue={99} className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500" />
                            </label>
                        </div>
                        <button
                            type="submit"
                            disabled={busy === '__new__'}
                            className="mt-4 rounded-2xl bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-900 disabled:text-zinc-400"
                        >
                            {busy === '__new__' ? 'Adding…' : 'Add department'}
                        </button>
                    </form>
                )}
            </section>
        </main>
    );
}
