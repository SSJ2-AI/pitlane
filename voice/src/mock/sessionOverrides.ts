/**
 * sessionOverrides.ts
 * In-memory test override system for demos.
 *
 * Usage: POST /demo/set-next-caller { as_customer_id: "cust_002" }
 * The NEXT customer_lookup call will return that customer, regardless of caller phone.
 * Clears itself after one use.
 */

interface Override {
  customerId: string
  expiresAt: number // epoch ms
}

// Maps real caller phone → mock customer ID for testing
const phoneOverrides = new Map<string, Override>()

// Global "next caller" override — applies to ANY phone for one call
let globalNextCaller: Override | null = null

const TTL_MS = 5 * 60 * 1000 // 5-minute TTL

export function setPhoneOverride(callerPhone: string, customerId: string): void {
  phoneOverrides.set(callerPhone, { customerId, expiresAt: Date.now() + TTL_MS })
  console.log(`[Override] ${callerPhone} → ${customerId} (expires in 5min)`)
}

export function setGlobalNextCaller(customerId: string): void {
  globalNextCaller = { customerId, expiresAt: Date.now() + TTL_MS }
  console.log(`[Override] Global next caller → ${customerId}`)
}

/**
 * Check if there's an active override for a given phone number.
 * Returns the overridden customer ID if found (and clears global override).
 */
export function checkOverride(callerPhone: string): string | null {
  // Phone-specific override takes priority
  const phoneOverride = phoneOverrides.get(callerPhone)
  if (phoneOverride) {
    if (Date.now() < phoneOverride.expiresAt) {
      phoneOverrides.delete(callerPhone)
      return phoneOverride.customerId
    }
    phoneOverrides.delete(callerPhone)
  }

  // Global next-caller override
  if (globalNextCaller && Date.now() < globalNextCaller.expiresAt) {
    const id = globalNextCaller.customerId
    globalNextCaller = null
    return id
  }
  if (globalNextCaller) globalNextCaller = null

  return null
}

export function listOverrides() {
  const active = Array.from(phoneOverrides.entries())
    .filter(([, o]) => Date.now() < o.expiresAt)
    .map(([phone, o]) => ({ phone, customerId: o.customerId }))
  return {
    phoneOverrides: active,
    globalNextCaller: globalNextCaller && Date.now() < globalNextCaller.expiresAt ? globalNextCaller.customerId : null,
  }
}
