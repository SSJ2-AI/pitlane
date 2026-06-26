// ─── PitLane Phase 13: Aria system-prompt fragments ─────────────────────────
//
// The ElevenLabs Aria agent is configured with a base system prompt in the
// ElevenLabs dashboard. This file exports prompt FRAGMENTS that the voice
// service can splice into ElevenLabs dynamic_variables / overrides at
// session-start time, so we can ship prompt-engineering changes in code
// alongside the matching tool implementations.
//
// The Phase 13 contribution is the BOOKING FLOW section below, which is
// the only change Aria needs to start using /tools/available-slots
// instead of asking open-ended "what time works for you?".
//
// Usage pattern (in voice/src/routes/webhook.ts):
//
//   import { ARIA_BOOKING_FLOW } from '../aria-prompt'
//   ...
//   dynamic_variables: {
//     ...
//     booking_flow_instructions: ARIA_BOOKING_FLOW,
//   }
//
// The base agent prompt is expected to reference the variable like:
//   "{{booking_flow_instructions}}"

/**
 * Prompt fragment that drives Aria's appointment-booking conversation.
 * Append into the agent prompt where booking guidance is needed.
 *
 * Hard rules (in order):
 *  1. ALWAYS call check_available_slots BEFORE proposing any time.
 *  2. Present EXACTLY 3 of the returned slots, in plain language.
 *  3. If the tool returns 0 slots, switch to request_callback with
 *     reason='appointment booking - no availability'.
 *  4. If the tool returns an `error` field (e.g. "Schedule unavailable")
 *     OR a `message` of "No schedule configured", fall back to the
 *     legacy open-ended booking flow — ask the caller for their
 *     preferred date/time and book directly via book_appointment.
 *  5. NEVER ask "what time works for you?" without first attempting
 *     check_available_slots and offering the 3 returned slots.
 */
export const ARIA_BOOKING_FLOW: string = `
BOOKING FLOW (Phase 13 — availability-aware booking):

Step 1 — ALWAYS call check_available_slots FIRST.
  - Tool: GET /tools/available-slots
  - Arguments: dealer_id (from your dynamic_variables), date_from
    (today's date in YYYY-MM-DD), days=7.
  - Wait for the response before proposing any time to the caller.

Step 2 — Present EXACTLY 3 slot options from the returned \`slots\` array.
  - Read them in plain language. Example:
    "I have a few openings: Wednesday at 9 AM, Thursday at 11 AM, or
     Friday at 2 PM. Which works best for you?"
  - If the array has fewer than 3 entries, present whatever was
    returned and offer to look further out: "Those are the next
    openings I have this week — would you like me to check next
    week as well?"

Step 3 — If the response is { slots: [] } AND no error:
  - Call request_callback with:
      reason = "appointment booking - no availability"
      caller_phone = the caller's phone
  - Tell the caller: "We're fully booked over the next week — I'll
    have one of our advisors call you back to find a time that works."

Step 4 — If the response has an \`error\` field OR
         \`message: "No schedule configured"\`:
  - Fall back to the legacy open-ended booking flow:
    "What day and time would you like to come in?"
  - When the caller answers, call book_appointment directly with
    their preferred date / time. (No availability check.)

Step 5 — Once the caller picks a time, call book_appointment with:
    customer_id, vehicle_id, service_type, date (YYYY-MM-DD),
    time (HH:MM), call_id.
  - If book_appointment returns { confirmed: false, reason: "slot_full" }
    that slot was taken between Step 1 and Step 5. Read back the
    \`alternatives\` array (up to 3 entries) and try again.

Step 6 — Loaner check (only when the caller asked about a loaner).
  - Pass loaner_requested=true on the book_appointment call.
  - If the response has loaner_available=false, say: "I've booked
    your service. A loaner isn't guaranteed for that date — I'll
    flag the request and our service desk will confirm shortly."
  - If loaner_available=true, say: "I've booked your service and
    a loaner will be ready when you arrive."

HARD RULES:
  - NEVER ask "what time works for you?" before calling
    check_available_slots at least once.
  - NEVER propose a time that wasn't in the returned \`slots\` list
    unless you've fallen back per Step 4.
  - NEVER make up slot capacity — the tool is the source of truth.
`.trim()

/**
 * Convenience export keyed for the dynamic_variables map. Use this as
 * the value of the variable referenced in the ElevenLabs base prompt.
 */
export const ARIA_PROMPT_FRAGMENTS = {
  booking_flow_instructions: ARIA_BOOKING_FLOW,
} as const

export type AriaPromptFragmentKey = keyof typeof ARIA_PROMPT_FRAGMENTS
