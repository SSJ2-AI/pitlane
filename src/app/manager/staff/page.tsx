'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { VoiceStatusDot } from '@/components/VoiceStatusDot';
import type { StaffRole, StaffRow } from '@/lib/supabase';

// /manager/staff — service-manager console for staff management.
//
// - Lists every advisor in the manager's dealer (group_managers see all
//   staff across the group).
// - Invite advisor form: email + full name. Calls Supabase Auth
//   admin.inviteUserByEmail() via /api/staff POST, then inserts the
//   staff row.
// - Toggle is_active per advisor.
// - Managers cannot invite other managers or group_managers (capped to
//   service_advisor) — server-side check + form has no role selector.

interface StaffResponse {
    staff: StaffRow[];
    session: { role: StaffRole; dealer_id: string };
    can_manage: boolean;
    persistence: 'supabase' | 'mock';
}

const ROLE_LABEL: Record<StaffRole, string> = {
    service_advisor: 'Service advisor',
    service_manager: 'Service manager',
    group_manager: 'Group manager',
};

const ROLE_STYLE: Record<StaffRole, string> = {
    service_advisor: 'border-zinc-700 bg-zinc-950 text-zinc-300',
    service_manager: 'border-red-500/40 bg-red-600/15 text-red-200',
    group_manager: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200',
};

function formatRelative(iso: string): string {
    try {
        const diff = (Date.now() - new Date(iso).getTime()) / 86_400_000;
        if (diff < 1) return 'today';
        if (diff < 7) return `${Math.floor(diff)}d ago`;
        return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return iso;
    }
}

export default function ManagerStaffPage() {
    const [data, setData] = useState<StaffResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteName, setInviteName] = useState('');
    const [inviteMsg, setInviteMsg] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await fetch('/api/staff', { cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const payload = (await r.json()) as StaffResponse;
            setData(payload);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load staff');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function toggleActive(id: string, next: boolean) {
        setBusy(id);
        setError(null);
        try {
            const r = await fetch(`/api/staff/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: next }),
            });
            const payload = (await r.json()) as { error?: string };
            if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update advisor');
        } finally {
            setBusy(null);
        }
    }

    async function handleInvite(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setBusy('__invite__');
        setError(null);
        setInviteMsg(null);
        try {
            const r = await fetch('/api/staff', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: inviteEmail.trim(), full_name: inviteName.trim() }),
            });
            const payload = (await r.json()) as { error?: string; invite_sent?: boolean };
            if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
            setInviteEmail('');
            setInviteName('');
            setInviteMsg(payload.invite_sent ? 'Invite email sent.' : 'Advisor added (no invite — user already existed).');
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to invite advisor');
        } finally {
            setBusy(null);
        }
    }

    const canManage = data?.can_manage ?? false;

    return (
        <main className="min-h-screen bg-[#09090b] text-zinc-100">
            <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100">PL</div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white">Pit<span className="text-red-500">Lane</span></h1>
                            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Manager · Staff</p>
                        </div>
                    </Link>
                    <nav className="flex flex-wrap items-center gap-3">
                        <VoiceStatusDot />
                        <Link href="/dashboard" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Dashboard</Link>
                        <Link href="/manager/calendar" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Calendar</Link>
                        <Link href="/manager/departments" className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">Departments</Link>
                        <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200">Staff</span>
                    </nav>
                </div>
            </header>

            <section className="mx-auto max-w-5xl px-5 py-8 lg:px-8">
                <div className="mb-6 flex flex-col gap-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.4em] text-red-400">Staff</p>
                    <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Service advisors</h2>
                    <p className="max-w-3xl text-sm leading-6 text-zinc-400">
                        Invite advisors by email to give them PitLane access. Inviting from this page is capped at the service-advisor role — only group managers can elevate to service-manager.
                    </p>
                </div>

                {error && <div className="mb-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-100">{error}</div>}
                {inviteMsg && <div className="mb-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">{inviteMsg}</div>}
                {loading && !data && <div className="h-32 animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900" />}

                {data && (
                    <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900">
                        <table className="w-full text-left text-sm">
                            <thead className="border-b border-zinc-800 bg-zinc-950/60 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                                <tr>
                                    <th className="px-4 py-3 font-semibold">Name</th>
                                    <th className="px-4 py-3 font-semibold">Email</th>
                                    <th className="px-4 py-3 font-semibold">Role</th>
                                    <th className="px-4 py-3 font-semibold">Status</th>
                                    <th className="px-4 py-3 font-semibold">Invited</th>
                                    {canManage && <th className="px-4 py-3 text-right font-semibold">Actions</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {data.staff.length === 0 ? (
                                    <tr>
                                        <td colSpan={canManage ? 6 : 5} className="px-4 py-10 text-center text-sm text-zinc-500">
                                            No staff on file yet — invite your first advisor below.
                                        </td>
                                    </tr>
                                ) : (
                                    data.staff.map((row) => (
                                        <tr key={row.id} className="border-b border-zinc-800/60 last:border-b-0 hover:bg-zinc-950/40">
                                            <td className="px-4 py-3 font-bold text-white">{row.full_name}</td>
                                            <td className="px-4 py-3 text-zinc-300">{row.email}</td>
                                            <td className="px-4 py-3">
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${ROLE_STYLE[row.role]}`}>
                                                    {ROLE_LABEL[row.role]}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${row.is_active ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 bg-zinc-950 text-zinc-300'}`}>
                                                    {row.is_active ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-zinc-400">{formatRelative(row.created_at)}</td>
                                            {canManage && (
                                                <td className="px-4 py-3 text-right">
                                                    {row.role === 'service_advisor' ? (
                                                        <button
                                                            type="button"
                                                            disabled={busy === row.id}
                                                            onClick={() => void toggleActive(row.id, !row.is_active)}
                                                            className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white disabled:opacity-40"
                                                        >
                                                            {row.is_active ? 'Deactivate' : 'Activate'}
                                                        </button>
                                                    ) : (
                                                        <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">—</span>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {canManage && (
                    <form onSubmit={handleInvite} className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                        <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Invite advisor</p>
                        <p className="mt-1 text-xs text-zinc-500">A magic-link sign-up email is sent. The advisor picks their password on first login.</p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <label className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Full name *</span>
                                <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} required placeholder="Marco Alvarez" className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500" />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Email *</span>
                                <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} type="email" required placeholder="marco@dealer.ca" className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500" />
                            </label>
                        </div>
                        <button
                            type="submit"
                            disabled={busy === '__invite__'}
                            className="mt-4 rounded-2xl bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-900 disabled:text-zinc-400"
                        >
                            {busy === '__invite__' ? 'Sending…' : 'Send invite'}
                        </button>
                    </form>
                )}
            </section>
        </main>
    );
}
