'use client';

import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type VoiceCustomerVehicle = {
    id?: string;
    vin?: string;
    year?: number;
    make?: string;
    model?: string;
    trim?: string;
    color?: string;
    mileage?: number;
    licensePlate?: string;
};

export type VoiceRepairOrder = {
    id?: string;
    roNumber?: string;
    status?: string;
    serviceType?: string;
    advisorName?: string;
    openedAt?: string;
    total?: number;
    vehicleId?: string;
};

export type VoiceAppointment = {
    id?: string;
    customerId?: string;
    vehicleId?: string;
    date?: string;
    time?: string;
    serviceType?: string;
    advisorName?: string;
    status?: string;
};

export type VoiceRecall = {
    id?: string;
    campaign?: string;
    component?: string;
    summary?: string;
    remedy?: string;
};

export type VoiceCustomer = {
    id?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    preferredLanguage?: string;
    lastVisit?: string;
    lifetimeValue?: number;
    loyaltyTier?: string;
    vehicles?: VoiceCustomerVehicle[];
    openRepairOrders?: VoiceRepairOrder[];
    upcomingAppointments?: VoiceAppointment[];
    openRecalls?: VoiceRecall[];
    notes?: string;
};

export type IncomingCall = {
    type: 'INCOMING_CALL';
    callId?: string;
    caller?: {
        phone?: string;
        customer?: VoiceCustomer | null;
    };
    timestamp?: string;
};

type VoiceMessage = IncomingCall | {
    type?: string;
    [key: string]: unknown;
};

type VoiceContextValue = {
    incomingCall: IncomingCall | null;
    connectionStatus: 'connecting' | 'connected' | 'disconnected';
    lastMessageAt: string | null;
    dismissIncomingCall: () => void;
    reconnect: () => void;
};

const VoiceContext = createContext<VoiceContextValue | undefined>(undefined);

const voiceServiceUrl = process.env.NEXT_PUBLIC_VOICE_SERVICE_URL ?? 'https://pitlane-voice-production.up.railway.app';

function toWebSocketUrl(serviceUrl: string) {
    const url = new URL('/ws', serviceUrl);
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
    return url.toString();
}

export function VoiceProvider({ children }: { children: ReactNode }) {
    const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<VoiceContextValue['connectionStatus']>('connecting');
    const [lastMessageAt, setLastMessageAt] = useState<string | null>(null);
    const reconnectToken = useRef(0);
    const [reconnectCounter, setReconnectCounter] = useState(0);

    useEffect(() => {
        let isActive = true;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        const socket = new WebSocket(toWebSocketUrl(voiceServiceUrl));

        setConnectionStatus('connecting');

        socket.addEventListener('open', () => {
            if (isActive) setConnectionStatus('connected');
        });

        socket.addEventListener('message', (event) => {
            if (!isActive) return;

            try {
                const message = JSON.parse(String(event.data)) as VoiceMessage;
                setLastMessageAt(new Date().toISOString());

                if (message.type === 'INCOMING_CALL') {
                    setIncomingCall(message as IncomingCall);
                }
            } catch (error) {
                console.warn('Unable to parse PitLane voice message', error);
            }
        });

        socket.addEventListener('close', () => {
            if (!isActive) return;
            setConnectionStatus('disconnected');
            reconnectTimer = setTimeout(() => {
                reconnectToken.current += 1;
                setReconnectCounter(reconnectToken.current);
            }, 3000);
        });

        socket.addEventListener('error', () => {
            if (isActive) setConnectionStatus('disconnected');
            socket.close();
        });

        return () => {
            isActive = false;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            socket.close();
        };
    }, [reconnectCounter]);

    const value = useMemo<VoiceContextValue>(() => ({
        incomingCall,
        connectionStatus,
        lastMessageAt,
        dismissIncomingCall: () => setIncomingCall(null),
        reconnect: () => {
            reconnectToken.current += 1;
            setReconnectCounter(reconnectToken.current);
        },
    }), [connectionStatus, incomingCall, lastMessageAt]);

    return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
    const context = useContext(VoiceContext);
    if (!context) {
        throw new Error('useVoice must be used inside VoiceProvider');
    }
    return context;
}
