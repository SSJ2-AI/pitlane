'use client';

import { useCallback, useEffect, useState } from 'react';
import { useVoice } from '@/providers/VoiceProvider';

type CallEntry = {
    id: string;
    direction: 'inbound' | 'outbound';
    callType?: string;
    customerId?: string;
    customerName?: string;
    phone?: string;
    status: 'initiated' | 'in_progress' | 'completed' | 'failed' | 'no_answer';
    duration?: number;
    summary?: string;
    timestamp: string;
};

const REFRESH_INTERVAL_MS = 10_000;

const statusStyles: Record<CallEntry['status'], string> = {
    initiated: 'border-blue-500/40 bg-blue-500/10 text-blue-200',
    in_progress: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    completed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    failed: 'border-red-500/40 bg-red-500/10 text-red-200',
    no_answer: 'border-zinc-700 bg-zinc-950 text-zinc-300',
};

const directionStyles: Record<CallEntry['direction'], string> = {
    inbound: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    outbound: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
};

const directionLabel: Record<CallEntry['direction'], string> = {
    inbound: 'Inbound',
    outbound: 'Outbound',
};

function formatDurationSeconds(seconds?: number) {
    if (seconds === undefined || seconds === null) return 'Live';
    return `${seconds}s`;
}

function formatTime(iso: string) {
    try {
        const date = new Date(iso);
        const isToday = date.toDateString() === new Date().toDateString();
        const time = date.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
        if (isToday) return `${time}`;
        const day = date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
        return `${day} ${time}`;
    } catch {
        return iso;
    }
}

export function CallHistory({ customerId, title }: { customerId?: string; title?: string }) {
    const { voiceServiceUrl, lastEvent } = useVoice();
    const [calls, setCalls] = useState<CallEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!voiceServiceUrl) return;
        try {
            const response = await fetch(`${voiceServiceUrl}/calls/history`, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const payload = (await response.json()) as { calls?: CallEntry[] };
            setCalls(payload.calls ?? []);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load call history');
        } finally {
            setLoading(false);
        }
    }, [voiceServiceUrl]);

    useEffect(() => {
        void load();
        const interval = setInterval(() => {
            void load();
        }, REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [load]);

    useEffect(() => {
        if (!lastEvent) return;
        if (lastEvent.type === 'INCOMING_CALL' || lastEvent.type === 'CALL_ENDED' || lastEvent.type === 'OUTBOUND_INITIATED') {
            void load();
        }
    }, [lastEvent, load]);

    const filtered = customerId ? calls.filter((call) => call.customerId === customerId) : calls;

    const heading = title ?? (customerId ? 'Calls with this customer' : 'Aria call activity');

    return (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-500">Aria phone log</p>
                    <h3 className="mt-2 text-xl font-black text-white">{heading}</h3>
                </div>
                <button
                    type="button"
                    onClick={() => void load()}
                    className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white"
                >
                    Refresh
                </button>
            </div>

            {loading && filtered.length === 0 && (
                <p className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-6 text-center text-sm text-zinc-400">Loading call history…</p>
            )}
            {!loading && filtered.length === 0 && (
                <p className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-6 text-center text-sm text-zinc-400">
                    {error ? `Voice service unavailable (${error})` : 'No calls yet. When Aria takes a call it will appear here.'}
                </p>
            )}

            <ul className="space-y-3">
                {filtered.slice(0, 10).map((call) => (
                    <li key={call.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${directionStyles[call.direction]}`}>
                                        {directionLabel[call.direction]}
                                    </span>
                                    {call.callType && (
                                        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300">
                                            {call.callType.replace(/_/g, ' ')}
                                        </span>
                                    )}
                                </div>
                                <p className="mt-2 truncate text-sm font-black text-white">
                                    {call.customerName ?? call.phone ?? 'Unknown caller'}
                                </p>
                                <p className="mt-0.5 text-xs text-zinc-500">{call.phone ?? '—'}</p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${statusStyles[call.status]}`}>
                                    {call.status.replace('_', ' ')}
                                </span>
                                <span className="text-xs font-semibold text-zinc-300">{formatDurationSeconds(call.duration)}</span>
                                <span className="text-[10px] text-zinc-500">{formatTime(call.timestamp)}</span>
                            </div>
                        </div>
                        <p className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs leading-5 text-zinc-300">
                            {call.summary && call.summary.trim().length > 0
                                ? call.summary
                                : <span className="italic text-zinc-500">No summary yet — Aria hasn&apos;t closed this call or ElevenLabs hasn&apos;t posted the transcript.</span>}
                        </p>
                    </li>
                ))}
            </ul>
        </section>
    );
}
