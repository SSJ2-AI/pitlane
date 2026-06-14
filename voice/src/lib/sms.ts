// ─── PitLane × SMS dispatcher ────────────────────────────────────────────────
//
// Wraps the Twilio client + template renderer + Supabase log + consent check
// behind a single dispatch function. Everything that sends SMS — the
// /sms/send route, the /tools/send-sms Aria tool, and the auto-confirmation
// path on /tools/book-appointment — calls dispatchSms() so we have exactly
// one consent gate and one audit trail.

import { Customer } from '../types'
import { lookupById } from '../mock/customers'
import { sendSms, getDefaultFromPhone, isTwilioConfigured } from './twilio'
import { hasSmsConsent, insertSmsLog, isSupabaseConfigured, type SmsStatus } from './supabase'
import { DEFAULT_DEALER, type Dealer } from './dealer'

export type SmsMessageType =
    | 'appointment_confirmation'
    | 'appointment_reminder'
    | 'loaner_confirmed'
    | 'car_ready'
    | 'parts_arrived'
    | 'update'
    | 'custom'

export interface DispatchInput {
    /** Required when message_type !== 'custom' (template needs the customer context). */
    customer_id?: string | null
    /** Required when customer_id is omitted. */
    to_phone?: string | null
    message_type: SmsMessageType
    /** Overrides the rendered template. For 'custom', this is required. */
    custom_text?: string | null
    /** Free-form bag of variables fed to the templates (date, time, loaner, vehicle, ...). */
    context?: Record<string, string | number | undefined | null>
    /** Optional FK back-refs so the audit log can join to the originating call / appointment / loaner. */
    call_log_id?: string | null
    appointment_id?: string | null
    loaner_request_id?: string | null
    /** Multi-tenancy: the dealer this message belongs to. Defaults to DEFAULT_DEALER. */
    dealer?: Dealer | null
}

export interface DispatchResult {
    sent: boolean
    status: SmsStatus
    message_type: SmsMessageType
    to_phone: string | null
    twilio_sid?: string | null
    sms_log_id?: string | null
    dry_run: boolean
    failure_reason?: string
    rendered_message?: string
}

// ─── Templates ──────────────────────────────────────────────────────────────

function signOff(dealer: Dealer): string {
    return `\n— ${dealer.name}${dealer.location ? ` (${dealer.location})` : ''}`
}

function renderTemplate(
    type: SmsMessageType,
    customer: Customer | null,
    dealer: Dealer,
    context: Record<string, string | number | undefined | null>,
    customText?: string | null,
): string {
    if (customText && customText.trim().length > 0) {
        return customText.trim()
    }

    const firstName = customer?.firstName ?? (context.first_name as string | undefined) ?? 'there'
    const vehicle =
        (context.vehicle as string | undefined) ??
        (customer?.vehicles[0]
            ? `${customer.vehicles[0].year} Porsche ${customer.vehicles[0].model}`.trim()
            : 'your vehicle')

    switch (type) {
        case 'appointment_confirmation': {
            const date = (context.date as string | undefined) ?? customer?.upcomingAppointments[0]?.date ?? 'soon'
            const time = (context.time as string | undefined) ?? customer?.upcomingAppointments[0]?.time ?? ''
            const service =
                (context.service_type as string | undefined) ??
                customer?.upcomingAppointments[0]?.serviceType ??
                'service'
            const advisor =
                (context.advisor as string | undefined) ?? customer?.upcomingAppointments[0]?.advisorName
            const confirmation = context.confirmation_number as string | undefined
            const lines = [
                `Hi ${firstName}, your ${service} appointment for the ${vehicle} is confirmed for ${date}${time ? ` at ${time}` : ''}.`,
                advisor ? `Advisor: ${advisor}.` : null,
                confirmation ? `Confirmation: ${confirmation}.` : null,
                'Reply STOP to opt out.',
            ].filter(Boolean)
            return lines.join(' ') + signOff(dealer)
        }
        case 'appointment_reminder': {
            const date = (context.date as string | undefined) ?? 'tomorrow'
            const time = (context.time as string | undefined) ?? ''
            return (
                `Hi ${firstName}, friendly reminder of your service appointment ${date}${time ? ` at ${time}` : ''} for the ${vehicle}. ` +
                `Reply RESCHEDULE if you need to change it.` +
                signOff(dealer)
            )
        }
        case 'loaner_confirmed': {
            const loaner = (context.loaner as string | undefined) ?? 'your loaner vehicle'
            const date = (context.date as string | undefined) ?? customer?.upcomingAppointments[0]?.date ?? 'your appointment day'
            const time = (context.time as string | undefined) ?? customer?.upcomingAppointments[0]?.time ?? ''
            return (
                `Hi ${firstName}, ${loaner} will be ready for you on ${date}${time ? ` at ${time}` : ''}. ` +
                `See you then.` +
                signOff(dealer)
            )
        }
        case 'car_ready': {
            const pickupHours = (context.pickup_hours as string | undefined) ?? 'our service hours'
            return (
                `Hi ${firstName}, great news — your ${vehicle} is ready for pickup. ` +
                `Stop by during ${pickupHours} and we will have everything set.` +
                signOff(dealer)
            )
        }
        case 'parts_arrived': {
            const part = (context.part as string | undefined) ?? 'the part for your service'
            return (
                `Hi ${firstName}, update on your ${vehicle}: ${part} has arrived. ` +
                `We are scheduling the repair now and will follow up to confirm timing.` +
                signOff(dealer)
            )
        }
        case 'update': {
            const note = (context.note as string | undefined) ?? 'we have an update on your service.'
            return `Hi ${firstName}, ${note}` + signOff(dealer)
        }
        case 'custom':
        default:
            return customText ?? `Hi ${firstName}, this is ${dealer.name}.`
    }
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export async function dispatchSms(input: DispatchInput): Promise<DispatchResult> {
    const customer = input.customer_id ? lookupById(input.customer_id) : null
    const dealer = input.dealer ?? DEFAULT_DEALER
    const toPhone = (input.to_phone ?? customer?.phone ?? '').trim()
    const context = input.context ?? {}
    const renderedMessage = renderTemplate(input.message_type, customer, dealer, context, input.custom_text ?? undefined)

    if (!toPhone) {
        return {
            sent: false,
            status: 'failed',
            message_type: input.message_type,
            to_phone: null,
            dry_run: !isTwilioConfigured(),
            failure_reason: 'No to_phone — provide customer_id with a known phone, or to_phone directly',
            rendered_message: renderedMessage,
        }
    }

    if (input.customer_id) {
        const consented = await hasSmsConsent(input.customer_id)
        if (!consented) {
            const smsLogId = await insertSmsLog({
                customer_id: input.customer_id,
                dealer_id: dealer.id,
                to_phone: toPhone,
                from_phone: getDefaultFromPhone(),
                message: renderedMessage,
                message_type: input.message_type,
                status: 'skipped',
                failure_reason: 'customer opted out of SMS',
                call_log_id: input.call_log_id ?? null,
                appointment_id: input.appointment_id ?? null,
                loaner_request_id: input.loaner_request_id ?? null,
            })
            return {
                sent: false,
                status: 'skipped',
                message_type: input.message_type,
                to_phone: toPhone,
                sms_log_id: smsLogId,
                dry_run: !isTwilioConfigured(),
                failure_reason: 'customer opted out of SMS',
                rendered_message: renderedMessage,
            }
        }
    }

    const result = await sendSms({ to: toPhone, body: renderedMessage })

    const smsLogId = isSupabaseConfigured()
        ? await insertSmsLog({
              customer_id: input.customer_id ?? null,
              dealer_id: dealer.id,
              to_phone: toPhone,
              from_phone: getDefaultFromPhone(),
              message: renderedMessage,
              message_type: input.message_type,
              twilio_sid: result.twilio_sid ?? null,
              status: result.ok ? (result.status as SmsStatus) : 'failed',
              failure_reason: result.failure_reason ?? null,
              call_log_id: input.call_log_id ?? null,
              appointment_id: input.appointment_id ?? null,
              loaner_request_id: input.loaner_request_id ?? null,
          })
        : null

    return {
        sent: result.ok,
        status: result.ok ? (result.status as SmsStatus) : 'failed',
        message_type: input.message_type,
        to_phone: toPhone,
        twilio_sid: result.twilio_sid,
        sms_log_id: smsLogId,
        dry_run: result.dry_run,
        failure_reason: result.failure_reason,
        rendered_message: renderedMessage,
    }
}
