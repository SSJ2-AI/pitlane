'use client';

import { useEffect, useState } from 'react';
import { useVoice } from '@/providers/VoiceProvider';

type WarrantyStatus = 'active' | 'expiring_soon' | 'expired';

interface WarrantyResponse {
    vehicle_id: string;
    vin: string;
    warranty_status: WarrantyStatus;
    factory_expiry: string;
    cpo_expiry: string;
    mileage?: number;
    open_recalls: number;
    recall_descriptions: Array<{
        nhtsa_id?: string;
        component?: string;
        description?: string;
        remedy?: string;
    }>;
    source: string;
}

const STATUS_STYLES: Record<WarrantyStatus, { badge: string; label: string; tone: string }> = {
    active: {
        badge: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
        label: 'Active',
        tone: 'text-emerald-200',
    },
    expiring_soon: {
        badge: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
        label: 'Expiring soon',
        tone: 'text-amber-200',
    },
    expired: {
        badge: 'border-red-500/40 bg-red-500/10 text-red-200',
        label: 'Expired',
        tone: 'text-red-200',
    },
};

export function WarrantyBadge({ vehicleId }: { vehicleId?: string }) {
    const { voiceServiceUrl } = useVoice();
    const [data, setData] = useState<WarrantyResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [retryToken, setRetryToken] = useState(0);

    useEffect(() => {
        if (!vehicleId || !voiceServiceUrl) {
            setData(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetch(`${voiceServiceUrl}/tools/warranty/${encodeURIComponent(vehicleId)}`, { cache: 'no-store' })
            .then(async (r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return (await r.json()) as WarrantyResponse;
            })
            .then((payload) => {
                if (cancelled) return;
                setData(payload);
            })
            .catch((err) => {
                if (cancelled) return;
                // Fix 8: log raw error for ops; surface a friendly message
                // + Retry button to the advisor. Returning here doesn't
                // throw upward so the rest of the customer profile stays
                // intact when the voice service is down.
                console.warn('[WarrantyBadge] voice service request failed:', err);
                setError(err instanceof Error ? err.message : 'unknown');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [vehicleId, voiceServiceUrl, retryToken]);

    if (!vehicleId) return null;

    if (loading && !data) {
        return (
            <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Warranty</p>
                <p className="mt-4 text-sm text-zinc-400">Looking up warranty…</p>
            </section>
        );
    }

    if (error && !data) {
        return (
            <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Warranty</p>
                <div className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
                    <p className="font-bold">Voice service temporarily unavailable — retry in a moment.</p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-amber-200/80">{error}</p>
                    <button
                        type="button"
                        onClick={() => setRetryToken((t) => t + 1)}
                        className="mt-3 rounded-full border border-amber-300/50 bg-amber-500/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-100 transition hover:border-amber-200 hover:bg-amber-500/30 hover:text-white"
                    >
                        Retry
                    </button>
                </div>
            </section>
        );
    }

    if (!data) {
        return (
            <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Warranty</p>
                <p className="mt-4 text-sm text-zinc-400">No warranty data on file.</p>
            </section>
        );
    }

    const style = STATUS_STYLES[data.warranty_status];

    return (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Warranty</p>
                    <h3 className="mt-2 text-xl font-black text-white">Coverage status</h3>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${style.badge}`}>
                    {style.label}
                </span>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                    <dt className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Factory expiry</dt>
                    <dd className={`mt-1 text-base font-black ${style.tone}`}>{data.factory_expiry}</dd>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                    <dt className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">CPO expiry</dt>
                    <dd className="mt-1 text-base font-black text-white">{data.cpo_expiry}</dd>
                </div>
                <div className="col-span-2 rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                    <dt className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Open recalls</dt>
                    <dd className={`mt-1 text-base font-black ${data.open_recalls > 0 ? 'text-red-300' : 'text-zinc-300'}`}>
                        {data.open_recalls} {data.open_recalls === 1 ? 'campaign' : 'campaigns'}
                    </dd>
                </div>
            </dl>

            {data.recall_descriptions.length > 0 && (
                <ul className="mt-4 space-y-2">
                    {data.recall_descriptions.map((recall, idx) => (
                        <li key={recall.nhtsa_id ?? idx} className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-100">
                            {recall.nhtsa_id && (
                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-red-300">{recall.nhtsa_id}</p>
                            )}
                            {recall.component && <p className="mt-1 font-bold text-white">{recall.component}</p>}
                            {recall.description && <p className="mt-1 text-red-100/90">{recall.description}</p>}
                            {recall.remedy && <p className="mt-1 text-[11px] italic text-red-200">Remedy: {recall.remedy}</p>}
                        </li>
                    ))}
                </ul>
            )}

            <p className="mt-4 text-[10px] uppercase tracking-[0.22em] text-zinc-600">Source: {data.source}</p>
        </section>
    );
}
