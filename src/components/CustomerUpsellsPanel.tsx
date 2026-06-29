'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UpsellRow } from '@/lib/supabase';

interface UpsellsResponse {
    upsells: UpsellRow[];
    persistence: 'supabase' | 'none';
}

type PendingAction = { id: string; status: 'accepted' | 'declined' } | null;

const STATUS_STYLES: Record<string, string> = {
    pending: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    accepted: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    declined: 'border-zinc-700 bg-zinc-950 text-zinc-300',
    expired: 'border-zinc-700 bg-zinc-950 text-zinc-400',
};

function formatCurrency(value: number | null) {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
}

function formatDate(iso: string) {
    try {
        return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return iso;
    }
}

export function CustomerUpsellsPanel({ customerId }: { customerId?: string }) {
    const [data, setData] = useState<UpsellsResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState<PendingAction>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    useEffect(() => {
        if (!customerId) {
            setData(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetch(`/api/customers/${encodeURIComponent(customerId)}/upsells`, { cache: 'no-store' })
            .then(async (r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return (await r.json()) as UpsellsResponse;
            })
            .then((payload) => {
                if (cancelled) return;
                setData(payload);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : 'Failed to load upsells');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [customerId]);

    // Fix 7: optimistically flip the row's status, then PATCH the API.
    // On failure we revert and surface the error inline so the advisor
    // knows the change didn't stick.
    const updateStatus = useCallback(
        async (upsellId: string, status: 'accepted' | 'declined') => {
            if (!customerId) return;
            setActionError(null);
            setPending({ id: upsellId, status });
            const previous = data;
            setData((current) =>
                current
                    ? {
                          ...current,
                          upsells: current.upsells.map((u) =>
                              u.id === upsellId ? { ...u, status } : u,
                          ),
                      }
                    : current,
            );
            try {
                const response = await fetch(
                    `/api/customers/${encodeURIComponent(customerId)}/upsells/${encodeURIComponent(upsellId)}`,
                    {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status }),
                    },
                );
                if (!response.ok) {
                    let message = `HTTP ${response.status}`;
                    try {
                        const payload = (await response.json()) as { error?: string };
                        if (payload?.error) message = payload.error;
                    } catch {
                        // body wasn't JSON; keep status-only message
                    }
                    throw new Error(message);
                }
                const payload = (await response.json()) as { upsell?: UpsellRow };
                if (payload.upsell) {
                    setData((current) =>
                        current
                            ? {
                                  ...current,
                                  upsells: current.upsells.map((u) =>
                                      u.id === upsellId ? (payload.upsell as UpsellRow) : u,
                                  ),
                              }
                            : current,
                    );
                }
            } catch (err) {
                setData(previous);
                setActionError(err instanceof Error ? err.message : 'Failed to update upsell');
            } finally {
                setPending(null);
            }
        },
        [customerId, data],
    );

    if (!customerId) return null;

    const total = (data?.upsells ?? []).reduce((sum, u) => sum + (u.value_est ?? 0), 0);

    return (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Upsells offered</p>
                    <h3 className="mt-2 text-xl font-black text-white">Pipeline for this customer</h3>
                </div>
                <p className="text-lg font-black text-emerald-300">{formatCurrency(total)}</p>
            </div>

            {data?.persistence === 'none' && (
                <p className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-3 text-xs text-zinc-400">
                    Supabase not configured — upsells will appear once Aria&apos;s tools start writing.
                </p>
            )}
            {loading && !data && (
                <p className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-3 text-xs text-zinc-400">Loading upsells…</p>
            )}
            {error && (
                <p className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-100">{error}</p>
            )}
            {!loading && (data?.upsells.length ?? 0) === 0 && data?.persistence === 'supabase' && (
                <p className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-3 text-xs text-zinc-400">
                    No upsells on file yet for this customer.
                </p>
            )}

            {actionError && (
                <p className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-100">{actionError}</p>
            )}

            <ul className="mt-4 space-y-2">
                {(data?.upsells ?? []).slice(0, 6).map((u) => {
                    const isPending = u.status === 'pending';
                    const acceptInFlight = pending?.id === u.id && pending.status === 'accepted';
                    const declineInFlight = pending?.id === u.id && pending.status === 'declined';
                    const anyInFlight = acceptInFlight || declineInFlight;
                    return (
                        <li key={u.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-black text-white">{u.upsell_type}</p>
                                    {u.description && <p className="mt-1 text-xs text-zinc-400">{u.description}</p>}
                                    <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-zinc-500">{formatDate(u.created_at)}</p>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${STATUS_STYLES[u.status] ?? STATUS_STYLES.pending}`}>
                                        {u.status}
                                    </span>
                                    <span className="text-sm font-black text-emerald-300">{formatCurrency(u.value_est)}</span>
                                </div>
                            </div>
                            {isPending && (
                                <div className="mt-3 flex items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => void updateStatus(u.id, 'accepted')}
                                        disabled={anyInFlight}
                                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-100 transition hover:border-emerald-400 hover:bg-emerald-500/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {acceptInFlight ? 'Saving…' : 'Accept'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void updateStatus(u.id, 'declined')}
                                        disabled={anyInFlight}
                                        className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {declineInFlight ? 'Saving…' : 'Decline'}
                                    </button>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
