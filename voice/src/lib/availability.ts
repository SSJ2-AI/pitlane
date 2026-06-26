import { getSupabase } from './supabase'

export interface AvailableSlot {
  date: string
  time: string
  label: string
}

interface ServiceScheduleRow {
  day_of_week: number
  open_time: string
  close_time: string
  slot_duration_mins: number
  max_concurrent_bookings: number
  is_active: boolean
}

interface ScheduleOverrideRow {
  override_date: string
  is_blocked: boolean
  open_time: string | null
  close_time: string | null
  max_concurrent_bookings: number | null
}

interface AppointmentTimeRow {
  time: string
}

interface LoanerVehicleRow {
  id: string
}

interface LoanerAllocationRow {
  loaner_vehicle_id: string | null
}

export interface SlotCapacityCheck {
  has_schedule: boolean
  slot_full: boolean
  reason?: 'blocked' | 'outside_hours' | 'slot_full'
  slot_count?: number
  max_concurrent_bookings?: number
}

function addDaysIso(baseIso: string, days: number): string {
  const date = new Date(`${baseIso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function dayOfWeekFromIso(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay()
}

function parseTimeToMinutes(input: string | null | undefined): number | null {
  if (!input) return null
  const [h, m] = input.split(':')
  const hh = Number(h)
  const mm = Number(m)
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  return hh * 60 + mm
}

function minutesToTime(mins: number): string {
  const hh = Math.floor(mins / 60).toString().padStart(2, '0')
  const mm = Math.floor(mins % 60).toString().padStart(2, '0')
  return `${hh}:${mm}`
}

function normaliseTime(input: string): string {
  const mins = parseTimeToMinutes(input)
  if (mins === null) return input.slice(0, 5)
  return minutesToTime(mins)
}

function formatLabel(date: string, time: string): string {
  const dt = new Date(`${date}T${time}:00`)
  return dt.toLocaleString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export async function fetchAvailableSlots(params: {
  dealerId: string
  dateFrom: string
  days: number
}): Promise<{ slots: AvailableSlot[]; noSchedule: boolean }> {
  const client = getSupabase()
  if (!client) throw new Error('Supabase not configured')

  const dayCount = Math.max(1, Math.min(params.days, 31))
  const dateTo = addDaysIso(params.dateFrom, dayCount - 1)

  const [scheduleResult, overrideResult, appointmentsResult] = await Promise.all([
    client
      .from('service_schedule')
      .select('day_of_week,open_time,close_time,slot_duration_mins,max_concurrent_bookings,is_active')
      .eq('dealer_id', params.dealerId)
      .eq('is_active', true),
    client
      .from('schedule_overrides')
      .select('override_date,is_blocked,open_time,close_time,max_concurrent_bookings')
      .eq('dealer_id', params.dealerId)
      .gte('override_date', params.dateFrom)
      .lte('override_date', dateTo),
    client
      .from('appointments')
      .select('date,time,status')
      .eq('dealer_id', params.dealerId)
      .gte('date', params.dateFrom)
      .lte('date', dateTo)
      .neq('status', 'cancelled'),
  ])

  if (scheduleResult.error) throw scheduleResult.error
  if (overrideResult.error) throw overrideResult.error
  if (appointmentsResult.error) throw appointmentsResult.error

  const scheduleRows = (scheduleResult.data ?? []) as ServiceScheduleRow[]
  if (scheduleRows.length === 0) {
    return { slots: [], noSchedule: true }
  }

  const overrides = new Map<string, ScheduleOverrideRow>()
  for (const row of (overrideResult.data ?? []) as ScheduleOverrideRow[]) {
    overrides.set(row.override_date, row)
  }

  const counts = new Map<string, number>()
  for (const appt of (appointmentsResult.data ?? []) as Array<{ date: string; time: string }>) {
    const key = `${appt.date}|${normaliseTime(appt.time)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const scheduleByDay = new Map<number, ServiceScheduleRow>()
  for (const row of scheduleRows) {
    scheduleByDay.set(row.day_of_week, row)
  }

  const slots: AvailableSlot[] = []
  for (let offset = 0; offset < dayCount; offset += 1) {
    const date = addDaysIso(params.dateFrom, offset)
    const override = overrides.get(date)
    if (override?.is_blocked) continue

    const schedule = scheduleByDay.get(dayOfWeekFromIso(date))
    if (!schedule) continue

    const openTime = override?.open_time ?? schedule.open_time
    const closeTime = override?.close_time ?? schedule.close_time
    const maxConcurrent = override?.max_concurrent_bookings ?? schedule.max_concurrent_bookings
    const slotMins = schedule.slot_duration_mins

    const openMins = parseTimeToMinutes(openTime)
    const closeMins = parseTimeToMinutes(closeTime)
    if (openMins === null || closeMins === null || closeMins <= openMins || maxConcurrent <= 0 || slotMins <= 0) {
      continue
    }

    for (let t = openMins; t + slotMins <= closeMins; t += slotMins) {
      const time = minutesToTime(t)
      const count = counts.get(`${date}|${time}`) ?? 0
      if (count < maxConcurrent) {
        slots.push({ date, time, label: formatLabel(date, time) })
      }
      if (slots.length >= 10) return { slots, noSchedule: false }
    }
  }

  return { slots, noSchedule: false }
}

export async function checkSlotCapacity(params: {
  dealerId: string
  date: string
  time: string
}): Promise<SlotCapacityCheck> {
  const client = getSupabase()
  if (!client) return { has_schedule: false, slot_full: false }

  const day = dayOfWeekFromIso(params.date)
  const [scheduleResult, overrideResult, apptResult] = await Promise.all([
    client
      .from('service_schedule')
      .select('open_time,close_time,slot_duration_mins,max_concurrent_bookings,is_active')
      .eq('dealer_id', params.dealerId)
      .eq('day_of_week', day)
      .eq('is_active', true)
      .maybeSingle(),
    client
      .from('schedule_overrides')
      .select('is_blocked,open_time,close_time,max_concurrent_bookings')
      .eq('dealer_id', params.dealerId)
      .eq('override_date', params.date)
      .maybeSingle(),
    client
      .from('appointments')
      .select('time')
      .eq('dealer_id', params.dealerId)
      .eq('date', params.date)
      .neq('status', 'cancelled'),
  ])

  if (scheduleResult.error) throw scheduleResult.error
  if (overrideResult.error) throw overrideResult.error
  if (apptResult.error) throw apptResult.error

  const schedule = scheduleResult.data as ServiceScheduleRow | null
  if (!schedule) return { has_schedule: false, slot_full: false }

  const override = (overrideResult.data ?? null) as ScheduleOverrideRow | null
  if (override?.is_blocked) {
    return { has_schedule: true, slot_full: true, reason: 'blocked' }
  }

  const openTime = override?.open_time ?? schedule.open_time
  const closeTime = override?.close_time ?? schedule.close_time
  const maxConcurrent = override?.max_concurrent_bookings ?? schedule.max_concurrent_bookings

  const slotMins = parseTimeToMinutes(params.time)
  const openMins = parseTimeToMinutes(openTime)
  const closeMins = parseTimeToMinutes(closeTime)
  if (
    slotMins === null
    || openMins === null
    || closeMins === null
    || slotMins < openMins
    || slotMins >= closeMins
  ) {
    return { has_schedule: true, slot_full: true, reason: 'outside_hours' }
  }

  const targetTime = normaliseTime(params.time)
  const count = ((apptResult.data ?? []) as AppointmentTimeRow[])
    .filter((row) => normaliseTime(row.time) === targetTime)
    .length

  if (count >= maxConcurrent) {
    return {
      has_schedule: true,
      slot_full: true,
      reason: 'slot_full',
      slot_count: count,
      max_concurrent_bookings: maxConcurrent,
    }
  }

  return {
    has_schedule: true,
    slot_full: false,
    slot_count: count,
    max_concurrent_bookings: maxConcurrent,
  }
}

export async function hasAvailableLoaner(params: {
  dealerId: string
  startDate: string
  endDate: string
}): Promise<boolean> {
  const client = getSupabase()
  if (!client) return true

  const [vehicleResult, allocationResult] = await Promise.all([
    client
      .from('loaner_vehicles')
      .select('id')
      .eq('dealer_id', params.dealerId)
      .eq('is_available', true),
    client
      .from('loaner_requests')
      .select('loaner_vehicle_id')
      .eq('dealer_id', params.dealerId)
      .not('loaner_vehicle_id', 'is', null)
      .neq('status', 'declined')
      .lte('start_date', params.endDate)
      .gte('end_date', params.startDate),
  ])

  if (vehicleResult.error) throw vehicleResult.error
  if (allocationResult.error) throw allocationResult.error

  const vehicleIds = new Set(((vehicleResult.data ?? []) as LoanerVehicleRow[]).map((row) => row.id))
  if (vehicleIds.size === 0) return false

  for (const row of (allocationResult.data ?? []) as LoanerAllocationRow[]) {
    if (row.loaner_vehicle_id) vehicleIds.delete(row.loaner_vehicle_id)
  }

  return vehicleIds.size > 0
}
