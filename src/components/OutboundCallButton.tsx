'use client';

import { useState } from 'react';

type OutboundCallButtonProps = {
    phone?: string;
    userName?: string;
    label?: string;
};

type ResultState =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ok'; message: string }
    | { kind: 'error'; message: string };

export function OutboundCallButton({ phone, userName, label = 'Have Aria call now' }: OutboundCallButtonProps) {
    const [result, setResult] = useState<ResultState>({ kind: 'idle' });

    const disabled = !phone || result.kind === 'loading';

    async function trigger() {
        if (!phone) return;
        setResult({ kind: 'loading' });
        try {
            const response = await fetch('/api/voice/calls/outbound', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone_number: phone, user_name: userName ?? 'PitLane customer' }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                setResult({
                    kind: 'error',
                    message: typeof payload?.message === 'string' ? payload.message : `Call failed (${response.status}).`,
                });
                return;
            }
            setResult({ kind: 'ok', message: 'Outbound call queued with Aria.' });
        } catch (error) {
            setResult({
                kind: 'error',
                message: error instanceof Error ? error.message : 'Network error reaching the voice service.',
            });
        }
    }

    return (
        <div className="flex flex-col items-start gap-2">
            <button
                type="button"
                onClick={trigger}
                disabled={disabled}
                className="inline-flex items-center gap-2 rounded-2xl border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-red-200 transition hover:border-red-400 hover:bg-red-600/25 hover:text-white disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-950 disabled:text-zinc-500"
            >
                <span className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(220,38,38,0.9)]" />
                {result.kind === 'loading' ? 'Calling…' : label}
            </button>
            {result.kind === 'ok' && (
                <p className="text-xs font-semibold text-emerald-300">{result.message}</p>
            )}
            {result.kind === 'error' && (
                <p className="text-xs font-semibold text-red-300">{result.message}</p>
            )}
        </div>
    );
}
