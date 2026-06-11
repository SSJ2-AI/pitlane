import { getSupabase } from './supabase';

// ─── PitLane multi-tenancy (dashboard) ───────────────────────────────────────
//
// Mirror of voice/src/lib/dealer.ts. The dashboard resolves "which dealer
// am I serving?" once per request — by subdomain (porsche-toronto.pitlane.ai),
// by header (X-Dealer-Id), or by query param (?dealer_id=...). Falls back to
// DEFAULT_DEALER_ID so today's single-tenant deploy continues to work.

export interface Dealer {
    id: string;
    name: string;
    brand: string;
    location: string;
    phone_number: string | null;
    elevenlabs_agent_id: string | null;
    fortellis_subscription_id: string | null;
    subdomain: string | null;
    timezone: string;
    active: boolean;
}

// Matches the seed row inserted by 0003_multi_tenancy.sql AND
// voice/src/lib/dealer.ts.
export const DEFAULT_DEALER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

export const DEFAULT_DEALER: Dealer = {
    id: DEFAULT_DEALER_ID,
    name: 'Porsche Toronto',
    brand: 'porsche',
    location: 'Don Mills Road',
    phone_number: '+19063760066',
    elevenlabs_agent_id: 'agent_2701ktpgkyr7f37vq8dmgxjw4bkt',
    fortellis_subscription_id: null,
    subdomain: 'porsche-toronto',
    timezone: 'America/Toronto',
    active: true,
};

const SUBDOMAIN_PATTERN = /^([a-z0-9-]+)\.(?:pitlane\.ai|pitlane\.app|localhost|.*\.up\.railway\.app)/i;

/**
 * Resolve the active dealer for a Next.js API request. Order of precedence:
 *   1. `?dealer_id=<uuid>` query param (used by admin tools).
 *   2. `x-dealer-id` request header (used by internal services).
 *   3. `host` header → subdomain → `dealers.subdomain` lookup.
 *   4. DEFAULT_DEALER (legacy single-tenant fallback).
 *
 * Returns DEFAULT_DEALER when Supabase isn't configured or the lookup misses,
 * so the page renders rather than 500-ing during a misconfiguration.
 */
export async function resolveDealerForRequest(request: Request): Promise<Dealer> {
    const url = new URL(request.url);

    // Path 1: explicit dealer_id query param.
    const queryId = url.searchParams.get('dealer_id');
    if (queryId) {
        const byId = await fetchDealerById(queryId);
        if (byId) return byId;
    }

    // Path 2: x-dealer-id header.
    const headerId = request.headers.get('x-dealer-id');
    if (headerId) {
        const byId = await fetchDealerById(headerId);
        if (byId) return byId;
    }

    // Path 3: subdomain.
    const host = request.headers.get('host') ?? '';
    const match = host.match(SUBDOMAIN_PATTERN);
    if (match) {
        const subdomain = match[1].toLowerCase();
        // Skip the bare app hostnames where the first label IS the app.
        if (!['pitlane', 'pitlane-production-3a47', 'www'].includes(subdomain)) {
            const bySubdomain = await fetchDealerBySubdomain(subdomain);
            if (bySubdomain) return bySubdomain;
        }
    }

    return DEFAULT_DEALER;
}

async function fetchDealerById(id: string): Promise<Dealer | null> {
    const supabase = getSupabase();
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('dealers')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (error || !data) return null;
        return data as Dealer;
    } catch {
        return null;
    }
}

async function fetchDealerBySubdomain(subdomain: string): Promise<Dealer | null> {
    const supabase = getSupabase();
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('dealers')
            .select('*')
            .eq('subdomain', subdomain)
            .maybeSingle();
        if (error || !data) return null;
        return data as Dealer;
    } catch {
        return null;
    }
}
