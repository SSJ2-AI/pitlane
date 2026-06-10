'use client';

import { useEffect, useRef, useState } from 'react';
import { useVoice } from '@/providers/VoiceProvider';

export type OutboundCallType =
    | 'appointment_reminder'
    | 'recall_notification'
    | 'service_follow_up'
    | 'parts_ready';

type OutboundCallButtonProps = {
    customerId?: string;
    customerName?: string;
    /** Fallback phone if there is no customerId yet (Phase 4 fallback to /api/voice/calls/outbound). */
    phone?: string;
};

type ResultState =
    | { kind: 'idle' }
    | { kind: 'loading'; callType: OutboundCallType }
    | { kind: 'ok'; message: string }
    | { kind: 'error'; message: string };

type CallTypeOption = {
    value: OutboundCallType;
    label: string;
    description: string;
};

const CALL_TYPES: CallTypeOption[] = [
    {
        value: 'appointment_reminder',
        label: 'Appointment Reminder',
        description: 'Confirm an upcoming service visit and answer any prep questions.',
    },
    {
        value: 'recall_notification',
        label: 'Recall Notification',
        description: 'Inform the customer of an open safety recall and schedule the fix.',
    },
    {
        value: 'service_follow_up',
        label: 'Service Follow-up',
        description: 'Check in after a recent visit to confirm the vehicle is running well.',
    },
    {
        value: 'parts_ready',
        label: 'Parts Ready Notification',
        description: 'Let the customer know an ordered part has arrived and schedule install.',
    },
];

export function OutboundCallButton({ customerId, customerName, phone }: OutboundCallButtonProps) {
    const { voiceServiceUrl } = useVoice();
    const [open, setOpen] = useState(false);
    const [result, setResult] = useState<ResultState>({ kind: 'idle' });
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (event: MouseEvent) => {
            if (!containerRef.current) return;
            if (!containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const disabled = result.kind === 'loading' || (!customerId && !phone);

    async function trigger(callType: OutboundCallType) {
        setOpen(false);
        setResult({ kind: 'loading', callType });
        try {
            // Phase 3 happy path: voice service knows the customer (mock or Fortellis-backed) so we
            // call it directly with customer_id + call_type. The voice service builds the
            // call-type-specific opening line ("Hello, may I speak with…").
            if (customerId && voiceServiceUrl) {
                const response = await fetch(`${voiceServiceUrl}/calls/outbound`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ customer_id: customerId, call_type: callType }),
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    const message = typeof payload?.error === 'string'
                        ? payload.error
                        : `Voice service returned ${response.status}.`;
                    setResult({ kind: 'error', message });
                    return;
                }
                setResult({
                    kind: 'ok',
                    message: `Aria is dialing ${customerName ?? 'the customer'} (${callType.replace(/_/g, ' ')}).`,
                });
                return;
            }

            // Fallback: no customer ID yet (e.g. truly unknown caller) -> raw outbound via
            // /api/voice/calls/outbound on the dashboard, which proxies to ElevenLabs.
            if (!phone) {
                setResult({ kind: 'error', message: 'No customer ID or phone number available to dial.' });
                return;
            }
            const fallbackResponse = await fetch('/api/voice/calls/outbound', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone_number: phone, user_name: customerName ?? 'PitLane customer' }),
            });
            const fallbackPayload = await fallbackResponse.json().catch(() => ({}));
            if (!fallbackResponse.ok) {
                setResult({
                    kind: 'error',
                    message: typeof fallbackPayload?.message === 'string'
                        ? fallbackPayload.message
                        : `Call failed (${fallbackResponse.status}).`,
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

    const label =
        result.kind === 'loading'
            ? `Calling — ${result.callType.replace(/_/g, ' ')}…`
            : 'Call Customer';

    return (
        <div ref={containerRef} className="relative flex flex-col items-start gap-2">
            <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                disabled={disabled}
                aria-haspopup="menu"
                aria-expanded={open}
                className="inline-flex items-center gap-2 rounded-2xl border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-red-200 transition hover:border-red-400 hover:bg-red-600/25 hover:text-white disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-950 disabled:text-zinc-500"
            >
                <span className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(220,38,38,0.9)]" />
                {label}
                <span className={`text-xs transition ${open ? 'rotate-180' : ''}`}>▾</span>
            </button>

            {open && (
                <div
                    role="menu"
                    className="absolute left-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50"
                >
                    {CALL_TYPES.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            role="menuitem"
                            onClick={() => trigger(option.value)}
                            className="block w-full border-b border-zinc-900 px-4 py-3 text-left transition last:border-b-0 hover:bg-zinc-900"
                        >
                            <p className="text-sm font-black text-white">{option.label}</p>
                            <p className="mt-1 text-xs text-zinc-400">{option.description}</p>
                        </button>
                    ))}
                </div>
            )}

            {result.kind === 'ok' && (
                <p className="text-xs font-semibold text-emerald-300">{result.message}</p>
            )}
            {result.kind === 'error' && (
                <p className="text-xs font-semibold text-red-300">{result.message}</p>
            )}
            {!customerId && !phone && (
                <p className="text-xs text-zinc-500">Load a customer profile to enable outbound calling.</p>
            )}
        </div>
    );
}
