// In-memory call & event store
//
// Captures everything that flows through Aria for a given call so the PitLane
// advisor dashboard can render a full timeline per call AND a per-customer
// activity timeline (every call Aria has had with this customer, summaries,
// notes, etc.). This is the foundation for Phase 2 write-back to CDK — when
// CDK credentials are configured, the same writes will go through to CDK in
// addition to this in-memory store.

import { Customer, OutboundCallType } from '../types'

export type CallDirection = 'inbound' | 'outbound'

export type CallEventKind =
  | 'INCOMING_CALL'
  | 'OUTBOUND_INITIATED'
  | 'CUSTOMER_IDENTIFIED'
  | 'UNKNOWN_CALLER'
  | 'APPOINTMENT_REQUESTED'
  | 'APPOINTMENT_CONFIRMED'
  | 'LOANER_REQUESTED'
  | 'NOTE_ADDED'
  | 'TRANSCRIPT_RECEIVED'
  | 'CALL_ENDED'

export interface CallEvent {
  id: string
  callId: string
  customerId?: string
  kind: CallEventKind
  payload: Record<string, unknown>
  timestamp: string
}

export interface CallRecord {
  callId: string
  direction: CallDirection
  customerId?: string
  customerName?: string
  phone: string
  callType?: OutboundCallType
  status: 'initiated' | 'in_progress' | 'completed' | 'failed' | 'no_answer'
  startedAt: string
  endedAt?: string
  durationSeconds?: number
  summary?: string
  transcript?: string
  events: CallEvent[]
}

const calls = new Map<string, CallRecord>()
const customerCallIndex = new Map<string, string[]>() // customerId -> [callId]

function indexCustomer(customerId: string | undefined, callId: string) {
  if (!customerId) return
  const list = customerCallIndex.get(customerId) ?? []
  if (!list.includes(callId)) {
    list.unshift(callId)
    customerCallIndex.set(customerId, list)
  }
}

export function startInboundCall(input: {
  callId: string
  phone: string
  customer: Customer | null
}): CallRecord {
  const existing = calls.get(input.callId)
  if (existing) return existing

  const record: CallRecord = {
    callId: input.callId,
    direction: 'inbound',
    customerId: input.customer?.id,
    customerName: input.customer ? `${input.customer.firstName} ${input.customer.lastName}` : undefined,
    phone: input.phone,
    status: 'in_progress',
    startedAt: new Date().toISOString(),
    events: [],
  }
  calls.set(input.callId, record)
  indexCustomer(record.customerId, record.callId)

  pushEvent(record, {
    kind: input.customer ? 'CUSTOMER_IDENTIFIED' : 'UNKNOWN_CALLER',
    payload: input.customer
      ? { customerId: input.customer.id, name: record.customerName }
      : { phone: input.phone },
  })

  return record
}

export function startOutboundCall(input: {
  callId: string
  customer: Customer
  callType: OutboundCallType
}): CallRecord {
  const existing = calls.get(input.callId)
  if (existing) return existing

  const record: CallRecord = {
    callId: input.callId,
    direction: 'outbound',
    customerId: input.customer.id,
    customerName: `${input.customer.firstName} ${input.customer.lastName}`,
    phone: input.customer.phone,
    callType: input.callType,
    status: 'initiated',
    startedAt: new Date().toISOString(),
    events: [],
  }
  calls.set(input.callId, record)
  indexCustomer(record.customerId, record.callId)

  pushEvent(record, {
    kind: 'OUTBOUND_INITIATED',
    payload: { callType: input.callType, customerId: input.customer.id },
  })

  return record
}

function pushEvent(record: CallRecord, input: { kind: CallEventKind; payload?: Record<string, unknown> }) {
  const event: CallEvent = {
    id: `evt_${record.callId}_${record.events.length + 1}`,
    callId: record.callId,
    customerId: record.customerId,
    kind: input.kind,
    payload: input.payload ?? {},
    timestamp: new Date().toISOString(),
  }
  record.events.push(event)
  return event
}

export function recordEvent(
  callId: string,
  kind: CallEventKind,
  payload: Record<string, unknown> = {},
): CallEvent | null {
  const record = calls.get(callId)
  if (!record) return null
  return pushEvent(record, { kind, payload })
}

export function endCall(input: {
  callId: string
  status: CallRecord['status']
  durationSeconds?: number
  summary?: string
  transcript?: string
}): CallRecord | null {
  const record = calls.get(input.callId)
  if (!record) return null
  record.status = input.status
  record.endedAt = new Date().toISOString()
  if (input.durationSeconds !== undefined) record.durationSeconds = input.durationSeconds
  if (input.summary) record.summary = input.summary
  if (input.transcript) record.transcript = input.transcript

  pushEvent(record, {
    kind: 'CALL_ENDED',
    payload: {
      status: input.status,
      durationSeconds: input.durationSeconds,
      summary: input.summary,
    },
  })

  if (input.transcript) {
    pushEvent(record, {
      kind: 'TRANSCRIPT_RECEIVED',
      payload: { length: input.transcript.length },
    })
  }

  return record
}

export function getCall(callId: string): CallRecord | null {
  return calls.get(callId) ?? null
}

export function listCalls(limit = 50): CallRecord[] {
  return Array.from(calls.values())
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit)
}

export function getCustomerTimeline(customerId: string): {
  customerId: string
  calls: CallRecord[]
  events: CallEvent[]
} {
  const callIds = customerCallIndex.get(customerId) ?? []
  const records = callIds
    .map((id) => calls.get(id))
    .filter((c): c is CallRecord => Boolean(c))
  const events = records
    .flatMap((c) => c.events)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return { customerId, calls: records, events }
}

export function attachCustomer(callId: string, customer: Customer) {
  const record = calls.get(callId)
  if (!record) return
  record.customerId = customer.id
  record.customerName = `${customer.firstName} ${customer.lastName}`
  indexCustomer(customer.id, callId)
}
