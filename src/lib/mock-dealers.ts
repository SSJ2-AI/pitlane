// ─── PitLane mock dealer roster ─────────────────────────────────────────────
//
// Used by /admin/dealers + /api/admin/dealers when Supabase is not configured
// (Vercel demo, local dev). The first row is the same DEFAULT_DEALER seed
// inserted by supabase/migrations/0003_multi_tenancy.sql so /admin/dealers
// always lists Porsche Toronto first even when Supabase is empty.
//
// In-memory only. Inserts performed against this array during a demo
// session don't persist across process restarts — that's intentional;
// real onboarding lives in the dealers table.

import { DEFAULT_DEALER, type Dealer } from './dealer'

export type DealerStatus = 'live' | 'mock' | 'offline'
export type AriaStatus = 'live' | 'training' | 'offline'

/** Adds dashboard-only operational flags to the canonical Dealer row. */
export interface DealerListRow extends Dealer {
    status: DealerStatus
    aria_status: AriaStatus
    aria_persona: string | null
}

const seed: DealerListRow[] = [
    {
        ...DEFAULT_DEALER,
        status: 'live',
        aria_status: 'live',
        aria_persona: 'Aria',
    },
    {
        id: 'aaaaaaaa-0000-0000-0000-000000000002',
        name: 'Porsche Vancouver',
        brand: 'porsche',
        location: 'West Georgia St',
        phone_number: '+16045550120',
        elevenlabs_agent_id: 'agent_2701ktpgkyr7f37vq8dmgxjw4bkt',
        fortellis_subscription_id: null,
        subdomain: 'porsche-vancouver',
        timezone: 'America/Vancouver',
        active: true,
        status: 'mock',
        aria_status: 'training',
        aria_persona: 'Aria',
    },
    {
        id: 'aaaaaaaa-0000-0000-0000-000000000003',
        name: 'Audi Mississauga',
        brand: 'audi',
        location: 'Hurontario St',
        phone_number: '+19055550221',
        elevenlabs_agent_id: null,
        fortellis_subscription_id: null,
        subdomain: 'audi-mississauga',
        timezone: 'America/Toronto',
        active: false,
        status: 'offline',
        aria_status: 'offline',
        aria_persona: null,
    },
]

// Module-level cache — mutated by the in-memory POST handler so the page
// can show the just-added row without a refresh on the demo deploy.
const inMemoryDealers: DealerListRow[] = [...seed]

export function listMockDealers(): DealerListRow[] {
    return [...inMemoryDealers]
}

export interface CreateDealerInput {
    name: string
    brand: string
    location?: string
    phone_number?: string | null
    fortellis_subscription_id?: string | null
    aria_persona?: string | null
    subdomain?: string | null
    timezone?: string | null
}

/**
 * Append-only insert into the in-process roster. Returns the new row so
 * the dashboard can render it immediately. Validates required fields and
 * generates a uuid client-side; if the caller provides an `id` we accept
 * it for deterministic tests.
 */
export function appendMockDealer(input: CreateDealerInput & { id?: string }): DealerListRow {
    if (!input.name?.trim()) throw new Error('name is required')
    if (!input.brand?.trim()) throw new Error('brand is required')

    const row: DealerListRow = {
        id: input.id ?? generateId(),
        name: input.name.trim(),
        brand: input.brand.trim().toLowerCase(),
        location: input.location?.trim() || '—',
        phone_number: input.phone_number?.trim() || null,
        elevenlabs_agent_id: null,
        fortellis_subscription_id: input.fortellis_subscription_id?.trim() || null,
        subdomain: input.subdomain?.trim() || null,
        timezone: input.timezone?.trim() || 'America/Toronto',
        active: true,
        status: 'mock',
        aria_status: 'training',
        aria_persona: input.aria_persona?.trim() || 'Aria',
    }

    inMemoryDealers.push(row)
    return row
}

function generateId(): string {
    // crypto.randomUUID() is on node 19+ and modern browsers. Next 14 runs
    // node 18 on Railway, where global crypto is available but the runtime
    // type isn't always available — fall back to a v4-ish manual string.
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID()
    }
    const hex = (n: number) => Math.floor(Math.random() * n).toString(16)
    return `${hex(16 ** 8)}-${hex(16 ** 4)}-4${hex(16 ** 3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(16 ** 3)}-${hex(16 ** 12)}`.padStart(36, '0')
}
