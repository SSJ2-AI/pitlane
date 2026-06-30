import { Customer } from '../types'

// Mock Porsche dealer customers — realistic demo data for POC
// Phone numbers in E.164 format for Twilio/ElevenLabs matching

export const MOCK_CUSTOMERS: Customer[] = [
  {
    id: 'cust_001',
    firstName: 'James',
    lastName: 'Whitfield',
    phone: '+16475550101',
    email: 'james.whitfield@gmail.com',
    address: '142 Rosedale Valley Rd',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M4W 1P9',
    preferredLanguage: 'en',
    lastVisit: '2026-04-12',
    lifetimeValue: 48200,
    loyaltyTier: 'Gold',
    vehicles: [
      {
        id: 'veh_001a',
        vin: 'WP1AB2A2XMLA12345',
        year: 2021,
        make: 'Porsche',
        model: 'Cayenne',
        trim: 'S AWD',
        color: 'Mahogany Metallic',
        mileage: 42800,
        licensePlate: 'JTXW 812',
      },
      {
        id: 'veh_001b',
        vin: 'WP0AB2A97MS220876',
        year: 2020,
        make: 'Porsche',
        model: '911',
        trim: 'Carrera S Cabriolet',
        color: 'GT Silver Metallic',
        mileage: 18300,
        licensePlate: 'KPRS 002',
      },
    ],
    openRepairOrders: [
      {
        roNumber: 'RO-2026-4471',
        vehicleId: 'veh_001a',
        status: 'awaiting_parts',
        description: 'Air suspension compressor replacement — part on order from Germany',
        openedDate: '2026-06-01',
        estimatedCompletion: '2026-06-14',
        advisorName: 'Michael Chen',
        totalEstimate: 3850,
      },
    ],
    upcomingAppointments: [
      {
        id: 'appt_001a',
        customerId: 'cust_001',
        vehicleId: 'veh_001b',
        date: '2026-06-18',
        time: '10:00',
        serviceType: 'Annual Service B + Brake Fluid Exchange',
        advisorName: 'Michael Chen',
        status: 'confirmed',
      },
    ],
    openRecalls: [],
    notes: 'Prefers loaner vehicle for any service over 4 hours. Long-term client since 2018.',
  },
  {
    id: 'cust_002',
    firstName: 'Priya',
    lastName: 'Mehta',
    phone: '+14165550202',
    altPhone: '+14165550203',
    email: 'priya.mehta@nexuslaw.ca',
    address: '55 Bloor St W, Suite 1200',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M4W 1A5',
    preferredLanguage: 'en',
    lastVisit: '2026-05-03',
    lifetimeValue: 62500,
    loyaltyTier: 'Platinum',
    vehicles: [
      {
        id: 'veh_002a',
        vin: 'WP0ZZZ97ZNS140022',
        year: 2022,
        make: 'Porsche',
        model: 'Taycan',
        trim: '4S Cross Turismo',
        color: 'Frozen Blue Metallic',
        mileage: 31200,
        licensePlate: 'CHRG 922',
      },
    ],
    openRepairOrders: [],
    upcomingAppointments: [
      {
        id: 'appt_002a',
        customerId: 'cust_002',
        vehicleId: 'veh_002a',
        date: '2026-06-11',
        time: '08:30',
        serviceType: 'Taycan Annual Inspection + Software Update',
        advisorName: 'Sarah Kowalski',
        status: 'confirmed',
      },
    ],
    openRecalls: [
      {
        nhtsa_id: 'NHTSA-2025-0188',
        description: 'High-voltage battery management software — rare overcharge condition',
        component: 'Battery Management System',
        remedy: 'Software update — 45 min, no charge',
        status: 'open',
      },
    ],
    notes: 'Platinum client. Always requests Sarah K. as advisor. Interested in 2026 Taycan Turbo GT when available.',
  },
  {
    id: 'cust_003',
    firstName: 'David',
    lastName: 'Okafor',
    phone: '+14375550303',
    email: 'd.okafor@capitalgroupca.com',
    address: '98 Prince Arthur Ave',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M5R 1B4',
    preferredLanguage: 'en',
    lastVisit: '2026-03-22',
    lifetimeValue: 29800,
    loyaltyTier: 'Silver',
    vehicles: [
      {
        id: 'veh_003a',
        vin: 'WP0AA2A74NS810034',
        year: 2022,
        make: 'Porsche',
        model: 'Macan',
        trim: 'GTS',
        color: 'Carmine Red',
        mileage: 55600,
        licensePlate: 'MCGTS 7',
      },
    ],
    openRepairOrders: [
      {
        roNumber: 'RO-2026-4490',
        vehicleId: 'veh_003a',
        status: 'in_progress',
        description: 'PDK transmission service + rear differential fluid',
        openedDate: '2026-06-09',
        estimatedCompletion: '2026-06-09',
        advisorName: 'Tom Reeves',
        totalEstimate: 1240,
      },
    ],
    upcomingAppointments: [],
    openRecalls: [],
    notes: 'Vehicle currently in shop today.',
  },
  {
    id: 'cust_004',
    firstName: 'Sophie',
    lastName: 'Tremblay',
    phone: '+15145550404',
    email: 'sophie.tremblay@outlook.com',
    address: '3200 Rue de la Montagne',
    city: 'Montreal',
    province: 'QC',
    postalCode: 'H3G 2A4',
    preferredLanguage: 'fr',
    lastVisit: '2026-02-14',
    lifetimeValue: 18500,
    loyaltyTier: 'Bronze',
    vehicles: [
      {
        id: 'veh_004a',
        vin: 'WP0CA2985NS610087',
        year: 2022,
        make: 'Porsche',
        model: '718 Cayman',
        trim: 'GTS 4.0',
        color: 'Shark Blue',
        mileage: 22100,
        licensePlate: 'JWZ 6412',
      },
    ],
    openRepairOrders: [],
    upcomingAppointments: [],
    openRecalls: [],
    notes: 'Bilingual — français preferred. Track day enthusiast.',
  },
  {
    id: 'cust_005',
    firstName: 'Sulaim',
    lastName: 'Siddiqi',
    phone: '+16475457709',
    email: 'sulaim91@googlemail.com',
    address: '15 Murray Drive',
    city: 'Aurora',
    province: 'ON',
    postalCode: 'L4G 2C2',
    preferredLanguage: 'en',
    lastVisit: '2026-06-01',
    lifetimeValue: 94500,
    loyaltyTier: 'Platinum',
    vehicles: [
      {
        id: 'veh_005a',
        vin: 'WP0AA2A98NS820011',
        year: 2023,
        make: 'Porsche',
        model: '911',
        trim: 'GT3 RS',
        color: 'Shark Blue',
        mileage: 8200,
        licensePlate: 'GT3 RSS',
      },
    ],
    openRepairOrders: [],
    upcomingAppointments: [
      {
        id: 'appt_005a',
        customerId: 'cust_005',
        vehicleId: 'veh_005a',
        date: '2026-06-20',
        time: '09:00',
        serviceType: 'Track Preparation Service + PCCB Inspection',
        advisorName: 'Michael Chen',
        status: 'confirmed',
      },
    ],
    openRecalls: [],
    notes: 'Platinum client. Frequent track use — Mosport CTMP. Prefer early morning appointments.',
  },
]

// Phone number index for fast lookup
const PHONE_INDEX = new Map<string, Customer>()
MOCK_CUSTOMERS.forEach(c => {
  PHONE_INDEX.set(c.phone, c)
  if (c.altPhone) PHONE_INDEX.set(c.altPhone, c)
})

export function lookupByPhone(phone: string): Customer | null {
  // Normalize: strip spaces and dashes, ensure +1 prefix
  const normalized = phone.replace(/[\s\-().]/g, '')
  const withCountry = normalized.startsWith('+') ? normalized : `+1${normalized}`
  return PHONE_INDEX.get(withCountry) ?? null
}

export function lookupById(id: string): Customer | null {
  return MOCK_CUSTOMERS.find(c => c.id === id) ?? null
}

export function getCustomerWithROToday(): Customer | null {
  return MOCK_CUSTOMERS.find(c => c.openRepairOrders.some(ro => ro.status === 'in_progress')) ?? null
}

// ─── PitLane API Integration ──────────────────────────────────────────────────
// When PITLANE_API_URL env var is set, fetch real CDK data from PitLane.
// Falls back to internal mock data when not set (dev/demo mode).

export async function lookupByPhoneWithCDK(phone: string): Promise<Customer | null> {
  const pitlaneUrl = process.env.PITLANE_API_URL
  const pitlaneKey = process.env.PITLANE_VOICE_API_KEY

  if (pitlaneUrl) {
    try {
      const res = await fetch(
        `${pitlaneUrl}/api/voice/customer-lookup?phone=${encodeURIComponent(phone)}`,
        {
          headers: {
            'x-pitlane-voice-key': pitlaneKey ?? '',
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        }
      )
      if (res.ok) {
        const data = await res.json() as any
        if (data.found && data.customer) {
          console.log(`[CDK] Real PitLane data fetched for ${phone}: ${data.customer.firstName} ${data.customer.lastName}`)
          return mapPitlaneCustomer(data, phone)
        }
        return null
      }
    } catch (err) {
      console.error('[CDK] PitLane API call failed, falling back to mock:', err)
    }
  }

  // Fallback to internal mock data
  return lookupByPhone(phone)
}

function mapPitlaneCustomer(data: any, phone: string): Customer {
  const c = data.customer
  return {
    id: c.id ?? 'pitlane-' + phone,
    firstName: c.firstName,
    lastName: c.lastName,
    phone,
    altPhone: undefined,
    email: c.email ?? '',
    address: '',
    city: '',
    province: '',
    postalCode: '',
    preferredLanguage: c.preferredLanguage ?? 'en',
    lastVisit: data.lastVisit,
    lifetimeValue: undefined,
    loyaltyTier: c.loyaltyTier,
    vehicles: (data.vehicles ?? []).map((v: any) => ({
      id: v.id,
      vin: v.vin ?? '',
      year: parseInt(v.display?.split(' ')[0]) || 2024,
      make: 'Porsche',
      model: (v.display?.split(' ').slice(2) ?? []).join(' '),
      trim: '',
      color: '',
      mileage: v.mileage ?? 0,
      licensePlate: v.licensePlate ?? '',
    })),
    openRepairOrders: (data.openRepairOrders ?? []).map((ro: any) => ({
      roNumber: ro.roNumber ?? 'RO-' + Date.now(),
      vehicleId: ro.vehicleId ?? '',
      status: ro.status ?? 'open',
      description: ro.description ?? '',
      openedDate: new Date().toISOString().split('T')[0],
      estimatedCompletion: ro.estimatedCompletion,
      advisorName: ro.advisorName ?? 'Service Advisor',
      totalEstimate: ro.totalEstimate,
    })),
    upcomingAppointments: data.nextAppointment ? [{
      id: 'appt-next',
      customerId: c.id,
      vehicleId: (data.vehicles?.[0]?.id) ?? '',
      date: data.nextAppointment.date,
      time: data.nextAppointment.time,
      serviceType: data.nextAppointment.serviceType,
      advisorName: data.nextAppointment.advisorName ?? 'Service Advisor',
      status: 'confirmed' as const,
    }] : [],
    openRecalls: data.openRecalls ? [{
      nhtsa_id: 'recall-open',
      description: 'Open safety recall',
      component: 'See dealership',
      remedy: 'Contact dealership to schedule',
      status: 'open' as const,
    }] : [],
    notes: c.notes,
  }
}
