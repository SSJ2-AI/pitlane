'use client';

import { useVoice } from '@/providers/VoiceProvider';

const labels: Record<'connecting' | 'connected' | 'disconnected', string> = {
    connecting: 'Connecting Aria',
    connected: 'Aria online',
    disconnected: 'Aria offline',
};

const dotColors: Record<'connecting' | 'connected' | 'disconnected', string> = {
    connecting: 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.7)]',
    connected: 'bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.7)]',
    disconnected: 'bg-zinc-500',
};

export function VoiceStatusDot() {
    const { connectionStatus, reconnect } = useVoice();
    const isDisconnected = connectionStatus === 'disconnected';

    return (
        <button
            type="button"
            onClick={isDisconnected ? reconnect : undefined}
            title={isDisconnected ? 'Click to retry connection' : labels[connectionStatus]}
            className={`inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition ${isDisconnected ? 'hover:border-red-500 hover:text-white' : 'cursor-default'}`}
        >
            <span className={`h-2 w-2 rounded-full ${dotColors[connectionStatus]}`} />
            <span>{labels[connectionStatus]}</span>
        </button>
    );
}
