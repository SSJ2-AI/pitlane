# PitLane Voice ↔ CDK Integration — Cursor Task

## Architecture Overview

```
Customer calls +1 (906) 376-0066
        ↓
Twilio → ElevenLabs Aria (voice AI)
        ↓
POST /tools/customer-lookup (pitlane-voice on Railway)
        ↓
GET {PITLANE_API_URL}/api/voice/customer-lookup?phone=+16475457709
        ↓
PitLane (Next.js) queries Fortellis CDK API
        ↓
Returns: customer name, vehicles, repair orders, appointments, recalls
        ↓
Aria greets customer by name and handles their request
        ↓
WebSocket screen pop → PitLane service advisor dashboard
```

---

## Task 1 — Add Voice Customer Lookup API to PitLane (Next.js)

**File**: `app/api/voice/customer-lookup/route.ts` (or `pages/api/voice/customer-lookup.ts`)

Create a new API endpoint that looks up a customer in Fortellis/CDK by phone number.
This is called by `pitlane-voice` when Aria receives an inbound call.

```typescript
// app/api/voice/customer-lookup/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  // Validate API key from pitlane-voice
  const apiKey = req.headers.get('x-pitlane-voice-key')
  if (process.env.PITLANE_VOICE_API_KEY && apiKey !== process.env.PITLANE_VOICE_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const phone = req.nextUrl.searchParams.get('phone')
  if (!phone) {
    return NextResponse.json({ error: 'phone parameter required' }, { status: 400 })
  }

  // Normalize phone number to E.164 format (+1XXXXXXXXXX)
  const normalized = phone.replace(/[\s\-().]/g, '')
  const e164 = normalized.startsWith('+') ? normalized : `+1${normalized}`

  try {
    // Use existing Fortellis/CDK customer lookup (same as the main PitLane lookup)
    // This should call the same CDK API that PitLane already uses for phone number lookup
    const customer = await lookupCustomerByPhone(e164)

    if (!customer) {
      return NextResponse.json({ found: false }, { status: 200 })
    }

    return NextResponse.json({
      found: true,
      dealership: {
        name: process.env.DEALERSHIP_NAME ?? 'Porsche Toronto',
        branch: process.env.DEALERSHIP_BRANCH ?? 'Don Mills Road',
      },
      customer: {
        id: customer.customerId,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        loyaltyTier: customer.loyaltyTier,    // if available in CDK
        preferredLanguage: 'en',
        notes: customer.advisorNotes ?? '',
      },
      vehicles: customer.vehicles?.map(v => ({
        id: v.vehicleId,
        display: `${v.year} ${v.make} ${v.model} ${v.trim ?? ''}`.trim(),
        mileage: v.currentMileage,
        licensePlate: v.licensePlate,
        vin: v.vin,
      })) ?? [],
      openRepairOrders: customer.openROs?.map(ro => ({
        roNumber: ro.roNumber,
        status: ro.status,
        description: ro.concern ?? ro.description,
        estimatedCompletion: ro.promisedTime,
        advisorName: ro.advisorName,
        totalEstimate: ro.totalEstimate,
      })) ?? [],
      nextAppointment: customer.upcomingAppointments?.[0] ? {
        date: customer.upcomingAppointments[0].date,
        time: customer.upcomingAppointments[0].time,
        serviceType: customer.upcomingAppointments[0].opCode ?? 'Service Appointment',
        advisorName: customer.upcomingAppointments[0].advisorName,
        status: 'confirmed',
      } : null,
      openRecalls: customer.openRecalls?.length > 0,
      lastVisit: customer.lastServiceDate,
      summary: buildSummary(customer),
    })
  } catch (err) {
    console.error('[Voice API] Customer lookup error:', err)
    return NextResponse.json({ found: false, error: 'CDK lookup failed' }, { status: 200 })
  }
}

function buildSummary(customer: any): string {
  const parts: string[] = []
  parts.push(`${customer.firstName} ${customer.lastName}`)
  if (customer.vehicles?.length) {
    parts.push(`owns a ${customer.vehicles[0].year} ${customer.vehicles[0].model}`)
  }
  if (customer.openROs?.length) {
    parts.push(`has an open repair order`)
  }
  if (customer.upcomingAppointments?.length) {
    parts.push(`has an appointment on ${customer.upcomingAppointments[0].date}`)
  }
  return parts.join(', ')
}
```

**IMPORTANT**: Replace `lookupCustomerByPhone(e164)` with PitLane's actual Fortellis CDK query.
PitLane already has the Fortellis OAuth and customer API integration in `src/lib/fortellis.ts` or similar.
Use whatever the existing `GET /api/lookup` master route uses to fetch customer data — just wrap it for phone number lookup.

**Environment variables to add to PitLane (Vercel)**:
```
PITLANE_VOICE_API_KEY=pitlane_voice_secret_2026    # shared secret with pitlane-voice
DEALERSHIP_NAME=Porsche Toronto
DEALERSHIP_BRANCH=Don Mills Road
```

---

## Task 2 — Update pitlane-voice to call PitLane API (not mock)

**File**: `src/mock/customers.ts` in the `SSJ2-AI/pitlane-voice` GitHub repo

Add a function that tries the PitLane API first, falls back to mock:

```typescript
// Add to src/mock/customers.ts

export async function lookupByPhoneWithCDK(phone: string): Promise<Customer | null> {
  const pitlaneApiUrl = process.env.PITLANE_API_URL
  const pitlaneApiKey = process.env.PITLANE_VOICE_API_KEY

  // If PitLane API is configured, use real CDK data
  if (pitlaneApiUrl) {
    try {
      const res = await fetch(
        `${pitlaneApiUrl}/api/voice/customer-lookup?phone=${encodeURIComponent(phone)}`,
        {
          headers: {
            'x-pitlane-voice-key': pitlaneApiKey ?? '',
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(5000) // 5s max
        }
      )
      if (res.ok) {
        const data = await res.json()
        if (data.found) {
          // Map PitLane response to Customer type
          return mapPitlaneResponseToCustomer(data, phone)
        }
        return null
      }
    } catch (err) {
      console.error('[CDK] PitLane API lookup failed, falling back to mock:', err)
    }
  }

  // Fallback to mock data (dev mode)
  return lookupByPhone(phone)
}

function mapPitlaneResponseToCustomer(data: any, phone: string): Customer {
  return {
    id: data.customer.id,
    firstName: data.customer.firstName,
    lastName: data.customer.lastName,
    phone,
    email: data.customer.email ?? '',
    address: '',
    city: 'Toronto',
    province: 'ON',
    postalCode: '',
    preferredLanguage: data.customer.preferredLanguage ?? 'en',
    lastVisit: data.lastVisit,
    lifetimeValue: undefined,
    loyaltyTier: data.customer.loyaltyTier,
    vehicles: data.vehicles?.map((v: any) => ({
      id: v.id,
      vin: v.vin ?? '',
      year: parseInt(v.display?.split(' ')[0]) || 2024,
      make: 'Porsche',
      model: v.display?.split(' ').slice(2).join(' ') || '',
      trim: '',
      color: '',
      mileage: v.mileage ?? 0,
      licensePlate: v.licensePlate ?? '',
    })) ?? [],
    openRepairOrders: data.openRepairOrders ?? [],
    upcomingAppointments: data.nextAppointment ? [data.nextAppointment] : [],
    openRecalls: data.openRecalls ? [{ nhtsa_id: 'recall', description: 'Open recall', component: 'See details', remedy: 'Contact dealership', status: 'open' }] : [],
    notes: data.customer.notes,
  }
}
```

**Update `src/routes/tools.ts`** — change the customer lookup call:
```typescript
// In the POST /tools/customer-lookup and GET /tools/customer-lookup/:phone handlers
// Change: const customer = overrideId ? lookupById(overrideId) : lookupByPhone(phone)
// To:
const customer = overrideId ? lookupById(overrideId) : await lookupByPhoneWithCDK(phone)
```

**Environment variables to add to Railway (pitlane-voice)**:
```
PITLANE_API_URL=https://pitlane.vercel.app      # or wherever PitLane is deployed
PITLANE_VOICE_API_KEY=pitlane_voice_secret_2026
```

---

## Task 3 — Add WebSocket Screen Pop to PitLane Dashboard

See the detailed spec in `PITLANE_UI_SPEC.md` (in this same `SSJ2-AI/pitlane-voice` repo).

Summary of changes to PitLane (Next.js):
1. Create `src/providers/VoiceProvider.tsx` — WebSocket client
2. Create `src/components/IncomingCallPopup.tsx` — screen pop
3. Create `src/components/CallHistory.tsx` — call history panel
4. Create `src/components/OutboundCallButton.tsx` — trigger call from customer profile
5. Wrap `app/layout.tsx` with `<VoiceProvider>` and add `<IncomingCallPopup />`
6. Add to `.env.local`:
   ```
   NEXT_PUBLIC_VOICE_SERVICE_URL=https://pitlane-voice-production.up.railway.app
   ```

When a customer calls and Aria identifies them via CDK, the PitLane dashboard will immediately show:
- Customer name and loyalty tier
- Vehicles on file
- Open repair orders
- Upcoming appointments
- Any open recalls

The service advisor has full context the moment the call connects.

---

## Testing After Integration

1. Set `PITLANE_API_URL` in Railway Variables
2. Call `+1 (906) 376-0066` from a phone number in the CDK system
3. Aria identifies caller by name using real CDK data
4. PitLane dashboard shows screen pop with real customer profile
5. Aria can discuss real repair orders, real appointments, real recalls

---

## Key Files

| Repo | File | Change |
|------|------|--------|
| PitLane (Cursor) | `app/api/voice/customer-lookup/route.ts` | New endpoint — queries Fortellis CDK |
| PitLane (Cursor) | `src/providers/VoiceProvider.tsx` | New — WebSocket client |
| PitLane (Cursor) | `src/components/IncomingCallPopup.tsx` | New — screen pop UI |
| SSJ2-AI/pitlane-voice | `src/mock/customers.ts` | Add `lookupByPhoneWithCDK()` |
| SSJ2-AI/pitlane-voice | `src/routes/tools.ts` | Use `lookupByPhoneWithCDK` instead of `lookupByPhone` |
