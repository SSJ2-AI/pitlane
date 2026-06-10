'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

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
    description?: string;
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
    nhtsa_id?: string;
    campaign?: string;
    component?: string;
    summary?: string;
    description?: string;
    remedy?: string;
    status?: string;
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

export type IncomingCallEvent = {
    type: 'INCOMING_CALL';
    callId?: string;
    caller?: {
        phone?: string;
        customer?: VoiceCustomer | null;
    };
    timestamp?: string;
};

export type CallEndedEvent = {
    type: 'CALL_ENDED';
    callId?: string;
    duration?: number;
    summary?: string;
    transcript?: string;
    timestamp?: string;
};

export type OutboundInitiatedEvent = {
    type: 'OUTBOUND_INITIATED';
    callId?: string;
    customer?: VoiceCustomer | null;
    callType?: string;
    timestamp?: string;
};

export type ConnectedEvent = {
    type: 'CONNECTED';
    message?: string;
    timestamp?: string;
};

export type VoiceEvent =
    | IncomingCallEvent
    | CallEndedEvent
    | OutboundInitiatedEvent
    | ConnectedEvent
    | { type?: string; [key: string]: unknown };

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type VoiceContextValue = {
    voiceServiceUrl: string;
    incomingCall: IncomingCallEvent | null;
    lastEvent: VoiceEvent | null;
    recentEvents: VoiceEvent[];
    connectionStatus: ConnectionStatus;
    lastMessageAt: string | null;
    dismissIncomingCall: () => void;
    reconnect: () => void;
};

const VoiceContext = createContext<VoiceContextValue | undefined>(undefined);

const defaultVoiceServiceUrl = 'https://pitlane-voice-production.up.railway.app';
const voiceServiceUrl =
    process.env.NEXT_PUBLIC_VOICE_SERVICE_URL && process.env.NEXT_PUBLIC_VOICE_SERVICE_URL.length > 0
        ? process.env.NEXT_PUBLIC_VOICE_SERVICE_URL
        : defaultVoiceServiceUrl;

function toWebSocketUrl(serviceUrl: string) {
    const url = new URL('/ws', serviceUrl);
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
    return url.toString();
}

const MAX_RECENT_EVENTS = 20;

export function VoiceProvider({ children }: { children: ReactNode }) {
    const [incomingCall, setIncomingCall] = useState<IncomingCallEvent | null>(null);
    const [lastEvent, setLastEvent] = useState<VoiceEvent | null>(null);
    const [recentEvents, setRecentEvents] = useState<VoiceEvent[]>([]);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
    const [lastMessageAt, setLastMessageAt] = useState<string | null>(null);
    const reconnectToken = useRef(0);
    const [reconnectCounter, setReconnectCounter] = useState(0);

    useEffect(() => {
        let isActive = true;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let socket: WebSocket | null = null;

        try {
            socket = new WebSocket(toWebSocketUrl(voiceServiceUrl));
        } catch (error) {
            console.warn('PitLane voice WebSocket failed to construct', error);
            setConnectionStatus('disconnected');
            return () => {
                isActive = false;
            };
        }

        setConnectionStatus('connecting');

        socket.addEventListener('open', () => {
            if (isActive) setConnectionStatus('connected');
        });

        socket.addEventListener('message', (event) => {
            if (!isActive) return;

            try {
                const message = JSON.parse(String(event.data)) as VoiceEvent;
                setLastMessageAt(new Date().toISOString());
                setLastEvent(message);
                setRecentEvents((current) => [message, ...current].slice(0, MAX_RECENT_EVENTS));

                if (message.type === 'INCOMING_CALL') {
                    setIncomingCall(message as IncomingCallEvent);
                } else if (message.type === 'CALL_ENDED') {
                    setIncomingCall((current) => {
                        if (!current) return null;
                        if (!current.callId || !(message as CallEndedEvent).callId) return null;
                        return current.callId === (message as CallEndedEvent).callId ? null : current;
                    });
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
            socket?.close();
        });

        return () => {
            isActive = false;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            socket?.close();
        };
    }, [reconnectCounter]);

    const dismissIncomingCall = useCallback(() => setIncomingCall(null), []);
    const reconnect = useCallback(() => {
        reconnectToken.current += 1;
        setReconnectCounter(reconnectToken.current);
    }, []);

    const value = useMemo<VoiceContextValue>(() => ({
        voiceServiceUrl,
        incomingCall,
        lastEvent,
        recentEvents,
        connectionStatus,
        lastMessageAt,
        dismissIncomingCall,
        reconnect,
    }), [incomingCall, lastEvent, recentEvents, connectionStatus, lastMessageAt, dismissIncomingCall, reconnect]);

    return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
    const context = useContext(VoiceContext);
    if (!context) {
        throw new Error('useVoice must be used inside VoiceProvider');
    }
    return context;
}
