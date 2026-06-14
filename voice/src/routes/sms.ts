import { Router, Request, Response } from 'express'
import { dispatchSms, type SmsMessageType } from '../lib/sms'
import { isTwilioConfigured } from '../lib/twilio'

const router = Router()

const ALLOWED_TYPES: SmsMessageType[] = [
    'appointment_confirmation',
    'appointment_reminder',
    'loaner_confirmed',
    'car_ready',
    'parts_arrived',
    'update',
    'custom',
]

interface SendSmsBody {
    customer_id?: string
    to_phone?: string
    phone?: string
    message_type?: string
    custom_text?: string
    message?: string
    context?: Record<string, string | number | undefined | null>
    call_log_id?: string
    appointment_id?: string
    loaner_request_id?: string
}

/**
 * POST /sms/send
 *
 * Generic SMS endpoint. Used by the PitLane dashboard's loaner approval flow
 * and the eventual scheduled-reminder cron. The Aria mid-call equivalent is
 * POST /tools/send-sms (in routes/tools.ts) — that path has a tighter request
 * shape suited to ElevenLabs tool configuration.
 *
 * Body:
 *   {
 *     customer_id?: string,
 *     to_phone?: string,           // E.164. Defaults to customer's phone
 *     message_type?: SmsMessageType,  // default 'custom'
 *     custom_text?: string,        // overrides the rendered template
 *     message?: string,            // alias for custom_text
 *     context?: { [k: string]: ... } // free-form variables for templates
 *     call_log_id?: string,
 *     appointment_id?: string,
 *     loaner_request_id?: string,
 *   }
 */
router.post('/send', async (req: Request, res: Response): Promise<Response> => {
    const body = (req.body ?? {}) as SendSmsBody
    const messageType = (body.message_type ?? 'custom') as SmsMessageType

    if (!ALLOWED_TYPES.includes(messageType)) {
        return res.status(400).json({
            sent: false,
            error: `message_type must be one of ${ALLOWED_TYPES.join(', ')}`,
        })
    }

    if (!body.customer_id && !body.to_phone && !body.phone) {
        return res.status(400).json({
            sent: false,
            error: 'Either customer_id or to_phone is required',
        })
    }

    if (messageType === 'custom' && !body.custom_text && !body.message) {
        return res.status(400).json({
            sent: false,
            error: 'custom_text (or message) is required when message_type = custom',
        })
    }

    const result = await dispatchSms({
        customer_id: body.customer_id,
        to_phone: body.to_phone ?? body.phone,
        message_type: messageType,
        custom_text: body.custom_text ?? body.message,
        context: body.context,
        call_log_id: body.call_log_id,
        appointment_id: body.appointment_id,
        loaner_request_id: body.loaner_request_id,
    })

    if (!result.sent) {
        return res.status(result.status === 'skipped' ? 200 : 502).json({
            ...result,
            sent: false,
            twilio_configured: isTwilioConfigured(),
        })
    }

    return res.json({ ...result, sent: true, twilio_configured: isTwilioConfigured() })
})

export default router
