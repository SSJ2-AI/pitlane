// ─── Shared domain types for PitLane Voice ───────────────────────────────────

export interface Vehicle {
  id: string
  vin: string
  year: number
  make: string
  model: string
  trim: string
  color: string
  mileage: number
  licensePlate: string
}

export interface RepairOrder {
  roNumber: string
  vehicleId: string
  status: 'open' | 'in_progress' | 'completed' | 'awaiting_parts'
  description: string
  openedDate: string
  estimatedCompletion?: string
  advisorName: string
  totalEstimate?: number
}

export interface Appointment {
  id: string
  customerId: string
  vehicleId: string
  date: string
  time: string
  serviceType: string
  advisorName: string
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled'
  notes?: string
}

export interface Recall {
  nhtsa_id: string
  description: string
  component: string
  remedy: string
  status: 'open' | 'completed'
}

export interface Customer {
  id: string
  firstName: string
  lastName: string
  phone: string           // E.164 format: +16475550101
  altPhone?: string
  email: string
  address: string
  city: string
  province: string
  postalCode: string
  preferredLanguage: string
  vehicles: Vehicle[]
  openRepairOrders: RepairOrder[]
  upcomingAppointments: Appointment[]
  openRecalls: Recall[]
  lastVisit?: string
  lifetimeValue?: number
  loyaltyTier?: 'Bronze' | 'Silver' | 'Gold' | 'Platinum'
  notes?: string
}

// ─── WebSocket events sent to PitLane dashboard ──────────────────────────────

export type ScreenPopEvent =
  | {
      type: 'INCOMING_CALL'
      callId: string
      caller: {
        phone: string
        customer: Customer | null   // null = unknown number
      }
      timestamp: string
    }
  | {
      type: 'CALL_ENDED'
      callId: string
      duration: number   // seconds
      summary: string
      transcript?: string
      timestamp: string
    }
  | {
      type: 'OUTBOUND_INITIATED'
      callId: string
      customer: Customer
      callType: OutboundCallType
      timestamp: string
    }
  | {
      // Phase 9a — Aria collected a callback request from the caller.
      // Service desk surfaces it in the Callback Queue panel.
      type: 'CALLBACK_REQUESTED'
      callId: string | null
      callback: {
        id: string | null
        phone: string
        name: string | null
        reason: string | null
        sentiment: string | null
      }
      timestamp: string
    }

export type OutboundCallType =
  | 'appointment_reminder'
  | 'recall_notification'
  | 'service_follow_up'
  | 'parts_ready'

// ─── ElevenLabs tool request/response shapes ─────────────────────────────────

export interface ToolRequest {
  agent_id?: string
  call_id?: string
  [key: string]: unknown
}

export interface CustomerLookupRequest extends ToolRequest {
  phone_number: string
}

export interface BookAppointmentRequest extends ToolRequest {
  customer_id: string
  vehicle_id: string
  service_type: string
  preferred_date: string
  preferred_time?: string
  loaner_requested?: boolean
  needs_loaner?: boolean
  start_date?: string
  end_date?: string
}

export interface CheckROStatusRequest extends ToolRequest {
  ro_number?: string
  customer_id?: string
}

// ─── ElevenLabs post-call webhook ────────────────────────────────────────────

export interface ElevenLabsCallEvent {
  type: 'call_ended'
  event_id: string
  agent_id: string
  call_id: string
  start_time_unix: number
  end_time_unix: number
  duration_seconds: number
  summary?: string
  transcript?: Array<{
    role: 'agent' | 'user'
    message: string
    timestamp: number
  }>
  status: 'completed' | 'failed' | 'no_answer'
  caller_phone?: string
}
