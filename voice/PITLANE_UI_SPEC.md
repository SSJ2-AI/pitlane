# PitLane UI Changes — AI Telephony Integration Spec

Send this file to Cursor (or Perplexity) to implement the voice feature in the PitLane dashboard.

---

## Context

`pitlane-voice` is a running microservice that connects ElevenLabs AI to CDK/Fortellis customer data.
It emits real-time WebSocket events when calls come in or go out.
PitLane needs to:
1. Connect to the WebSocket and show a "screen pop" when a customer calls
2. Show a call history log
3. Add an outbound "Call Customer" button

The microservice URL will be set in the environment variable `NEXT_PUBLIC_VOICE_SERVICE_URL`.

---

## 1. Environment Variable

Add to `.env.local`:
```
NEXT_PUBLIC_VOICE_SERVICE_URL=https://pitlane-voice.up.railway.app
```

---

## 2. WebSocket Provider

Create `src/providers/VoiceProvider.tsx`:

```tsx
'use client'
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'

export type ScreenPopEvent =
  | { type: 'INCOMING_CALL'; callId: string; caller: { phone: string; customer: CustomerSummary | null }; timestamp: string }
  | { type: 'CALL_ENDED'; callId: string; duration: number; summary: string; timestamp: string }
  | { type: 'OUTBOUND_INITIATED'; callId: string; customer: CustomerSummary; callType: string; timestamp: string }
  | { type: 'CONNECTED'; message: string; timestamp: string }

export interface CustomerSummary {
  id: string
  firstName: string
  lastName: string
  loyaltyTier?: string
  vehicles: Array<{ id: string; display: string; mileage: number }>
  openRepairOrders: Array<{ roNumber: string; status: string; description: string; estimatedCompletion?: string }>
  nextAppointment?: { date: string; time: string; serviceType: string; advisorName: string } | null
  openRecalls: boolean
  lastVisit?: string
}

interface VoiceContextValue {
  lastEvent: ScreenPopEvent | null
  activeCall: (ScreenPopEvent & { type: 'INCOMING_CALL' }) | null
  isConnected: boolean
  clearActiveCall: () => void
}

const VoiceContext = createContext<VoiceContextValue>({
  lastEvent: null,
  activeCall: null,
  isConnected: false,
  clearActiveCall: () => {},
})

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [lastEvent, setLastEvent] = useState<ScreenPopEvent | null>(null)
  const [activeCall, setActiveCall] = useState<(ScreenPopEvent & { type: 'INCOMING_CALL' }) | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const voiceUrl = process.env.NEXT_PUBLIC_VOICE_SERVICE_URL
    if (!voiceUrl) return

    const wsUrl = voiceUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws'
    const connect = () => {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => setIsConnected(true)
      ws.onclose = () => {
        setIsConnected(false)
        // Auto-reconnect after 5 seconds
        setTimeout(connect, 5000)
      }
      ws.onerror = () => ws.close()

      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as ScreenPopEvent
          setLastEvent(event)
          if (event.type === 'INCOMING_CALL') {
            setActiveCall(event)
          } else if (event.type === 'CALL_ENDED') {
            setActiveCall(null)
          }
        } catch {}
      }
    }

    connect()
    return () => wsRef.current?.close()
  }, [])

  return (
    <VoiceContext.Provider value={{
      lastEvent,
      activeCall,
      isConnected,
      clearActiveCall: () => setActiveCall(null),
    }}>
      {children}
    </VoiceContext.Provider>
  )
}

export const useVoice = () => useContext(VoiceContext)
```

Wrap the root layout with `<VoiceProvider>`:
```tsx
// app/layout.tsx
import { VoiceProvider } from '@/providers/VoiceProvider'
// ...
<VoiceProvider>
  {children}
</VoiceProvider>
```

---

## 3. IncomingCallPopup Component

Create `src/components/IncomingCallPopup.tsx`:

```tsx
'use client'
import { useVoice } from '@/providers/VoiceProvider'
import { Phone, X, User, Car, Wrench, Calendar } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function IncomingCallPopup() {
  const { activeCall, clearActiveCall } = useVoice()
  if (!activeCall) return null

  const { caller } = activeCall
  const c = caller.customer

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 rounded-xl border border-zinc-200 bg-white shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between rounded-t-xl bg-zinc-900 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
          </span>
          <span className="text-sm font-semibold text-white">Incoming Call — Aria Handling</span>
        </div>
        <button onClick={clearActiveCall} className="text-zinc-400 hover:text-white transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="p-4">
        {c ? (
          <>
            {/* Customer identity */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100">
                  <User size={20} className="text-zinc-600" />
                </div>
                <div>
                  <p className="font-semibold text-zinc-900">{c.firstName} {c.lastName}</p>
                  <p className="text-xs text-zinc-500">{caller.phone}</p>
                </div>
              </div>
              {c.loyaltyTier && (
                <Badge variant="outline" className={tierColor(c.loyaltyTier)}>
                  {c.loyaltyTier}
                </Badge>
              )}
            </div>

            {/* Vehicles */}
            {c.vehicles.length > 0 && (
              <div className="mb-2 rounded-lg bg-zinc-50 px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                  <Car size={12} /> Vehicles
                </div>
                {c.vehicles.map(v => (
                  <p key={v.id} className="text-sm text-zinc-800">{v.display} — {v.mileage.toLocaleString()} km</p>
                ))}
              </div>
            )}

            {/* Open ROs */}
            {c.openRepairOrders.length > 0 && (
              <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-amber-700 mb-1">
                  <Wrench size={12} /> Open Repair Order
                </div>
                {c.openRepairOrders.map(ro => (
                  <div key={ro.roNumber}>
                    <p className="text-sm font-medium text-zinc-900">{ro.roNumber}</p>
                    <p className="text-xs text-zinc-600 truncate">{ro.description}</p>
                    <p className="text-xs text-amber-700 capitalize">Status: {ro.status.replace('_', ' ')}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Next appointment */}
            {c.nextAppointment && (
              <div className="mb-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-blue-700 mb-1">
                  <Calendar size={12} /> Next Appointment
                </div>
                <p className="text-sm text-zinc-900">{c.nextAppointment.date} at {c.nextAppointment.time}</p>
                <p className="text-xs text-zinc-600">{c.nextAppointment.serviceType}</p>
              </div>
            )}

            {/* Recalls warning */}
            {c.openRecalls && (
              <div className="mb-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                ⚠️ Open recall on file — Aria will inform customer
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100">
              <Phone size={20} className="text-zinc-600" />
            </div>
            <div>
              <p className="font-semibold text-zinc-900">Unknown Caller</p>
              <p className="text-xs text-zinc-500">{caller.phone}</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-4 py-3 flex gap-2">
        <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={clearActiveCall}>
          Dismiss
        </Button>
        {c && (
          <Button size="sm" className="flex-1 text-xs bg-zinc-900 hover:bg-zinc-700">
            View Full Profile
          </Button>
        )}
      </div>
    </div>
  )
}

function tierColor(tier: string) {
  const map: Record<string, string> = {
    Platinum: 'border-purple-300 text-purple-700 bg-purple-50',
    Gold: 'border-yellow-300 text-yellow-700 bg-yellow-50',
    Silver: 'border-zinc-300 text-zinc-600 bg-zinc-50',
    Bronze: 'border-orange-300 text-orange-700 bg-orange-50',
  }
  return map[tier] ?? ''
}
```

Add to the root layout (inside `<VoiceProvider>`):
```tsx
import { IncomingCallPopup } from '@/components/IncomingCallPopup'
// Inside layout body:
<IncomingCallPopup />
```

---

## 4. Call History Panel

Create `src/components/CallHistory.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { Phone, PhoneOutgoing, PhoneIncoming, Clock } from 'lucide-react'

interface CallEntry {
  id: string
  direction: 'inbound' | 'outbound'
  callType?: string
  customerName?: string
  phone: string
  status: 'initiated' | 'completed' | 'failed' | 'no_answer'
  duration?: number
  summary?: string
  timestamp: string
}

export function CallHistory() {
  const [calls, setCalls] = useState<CallEntry[]>([])

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_VOICE_SERVICE_URL
    if (!url) return

    fetch(`${url}/calls/history`)
      .then(r => r.json())
      .then(d => setCalls(d.calls ?? []))
      .catch(() => {})

    const interval = setInterval(() => {
      fetch(`${url}/calls/history`)
        .then(r => r.json())
        .then(d => setCalls(d.calls ?? []))
        .catch(() => {})
    }, 10_000) // refresh every 10s

    return () => clearInterval(interval)
  }, [])

  if (calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-zinc-400">
        <Phone size={24} className="mb-2" />
        <p className="text-sm">No calls yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {calls.map(call => (
        <div key={call.id} className="rounded-lg border border-zinc-100 bg-white px-3 py-2.5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              {call.direction === 'inbound'
                ? <PhoneIncoming size={14} className="text-green-600" />
                : <PhoneOutgoing size={14} className="text-blue-600" />}
              <span className="text-sm font-medium text-zinc-900">
                {call.customerName ?? call.phone}
              </span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor(call.status)}`}>
              {call.status.replace('_', ' ')}
            </span>
          </div>
          {call.summary && <p className="text-xs text-zinc-500 truncate">{call.summary}</p>}
          <div className="flex items-center gap-2 mt-1 text-xs text-zinc-400">
            <Clock size={10} />
            {call.duration ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : '—'}
            <span>·</span>
            {new Date(call.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      ))}
    </div>
  )
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    completed: 'bg-green-50 text-green-700',
    initiated: 'bg-blue-50 text-blue-700',
    failed: 'bg-red-50 text-red-700',
    no_answer: 'bg-zinc-100 text-zinc-500',
  }
  return map[status] ?? 'bg-zinc-100 text-zinc-500'
}
```

---

## 5. Outbound Call Button (on Customer Profile)

Add this to the customer profile page wherever the customer's details are shown:

```tsx
'use client'
import { useState } from 'react'
import { Phone, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

const CALL_TYPES = [
  { value: 'appointment_reminder', label: 'Appointment Reminder' },
  { value: 'service_follow_up', label: 'Service Follow-up' },
  { value: 'recall_notification', label: 'Recall Notification' },
  { value: 'parts_ready', label: 'Parts Ready Notification' },
]

export function OutboundCallButton({ customerId }: { customerId: string }) {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const triggerCall = async (callType: string) => {
    const url = process.env.NEXT_PUBLIC_VOICE_SERVICE_URL
    if (!url) return
    setLoading(true)
    try {
      await fetch(`${url}/calls/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId, call_type: callType }),
      })
      setSent(true)
      setTimeout(() => setSent(false), 3000)
    } finally {
      setLoading(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={loading} className="gap-1.5">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
          {sent ? 'Call Initiated' : 'AI Call'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {CALL_TYPES.map(t => (
          <DropdownMenuItem key={t.value} onClick={() => triggerCall(t.value)}>
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

---

## 6. Voice Status Indicator (optional, for the header)

Add a small dot indicator in the top nav to show if the voice service is connected:

```tsx
'use client'
import { useVoice } from '@/providers/VoiceProvider'

export function VoiceStatusDot() {
  const { isConnected } = useVoice()
  return (
    <div className="flex items-center gap-1.5" title={isConnected ? 'Voice service connected' : 'Voice service disconnected'}>
      <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-zinc-300'}`} />
      <span className="text-xs text-zinc-500">{isConnected ? 'Voice' : 'Voice offline'}</span>
    </div>
  )
}
```

---

## Summary of Changes

| File | Action |
|------|--------|
| `src/providers/VoiceProvider.tsx` | Create — WebSocket client + state |
| `src/components/IncomingCallPopup.tsx` | Create — screen pop UI |
| `src/components/CallHistory.tsx` | Create — call log panel |
| `src/components/OutboundCallButton.tsx` | Create — outbound trigger |
| `src/components/VoiceStatusDot.tsx` | Create — connection indicator |
| `app/layout.tsx` | Edit — add VoiceProvider + IncomingCallPopup |
| `.env.local` | Edit — add NEXT_PUBLIC_VOICE_SERVICE_URL |
