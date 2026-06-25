// ─── PitLane Phase 11: role + dealer resolution ─────────────────────────────
//
// Real auth sessions land here via headers set by src/middleware.ts:
//
//   x-pitlane-role     -> service_advisor | service_manager | group_manager
//   x-pitlane-dealer   -> UUID of the staff row's dealer, empty for group_manager
//   x-pitlane-user-id  -> auth.users.id for audit logging
//
// In USE_MOCK_DATA mode the middleware short-circuits and lets the
// pre-existing ?role= URL hint + x-pitlane-role header through, so the
// dev environment still works without real Supabase accounts.

export type PitLaneRole = 'service_advisor' | 'service_manager' | 'group_manager';

export interface PitLaneSession {
    role: PitLaneRole;
    /** Empty string when group_manager (sees all dealers). */
    dealerId: string;
    userId: string | null;
    fullName: string | null;
    email: string | null;
}

export const ROLE_HIERARCHY: Record<PitLaneRole, number> = {
    service_advisor: 1,
    service_manager: 2,
    group_manager: 3,
};

const ROLE_VALUES = new Set<PitLaneRole>(['service_advisor', 'service_manager', 'group_manager']);

function normaliseRole(input: string | null | undefined): PitLaneRole {
    const v = input?.trim().toLowerCase();
    return v && (ROLE_VALUES as Set<string>).has(v) ? (v as PitLaneRole) : 'service_advisor';
}

/**
 * Read the staff session that the middleware attached to this request.
 * Falls back to mock-mode hints (URL query string OR plain x-pitlane-role
 * header) when USE_MOCK_DATA is true so the dev environment doesn't need
 * real accounts.
 */
export function readSessionFromRequest(request: Request): PitLaneSession {
    const mockMode = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';

    const headerRole = request.headers.get('x-pitlane-role');
    const headerDealer = request.headers.get('x-pitlane-dealer');
    const headerUser = request.headers.get('x-pitlane-user-id');
    const headerName = request.headers.get('x-pitlane-name');
    const headerEmail = request.headers.get('x-pitlane-email');

    if (headerRole) {
        return {
            role: normaliseRole(headerRole),
            dealerId: headerDealer ?? '',
            userId: headerUser,
            fullName: headerName,
            email: headerEmail,
        };
    }

    if (mockMode) {
        // Mock-mode fallback: honour the pre-Phase-11 ?role= URL hint so
        // the dev environment doesn't need real auth accounts. Defaults
        // to service_manager so all surfaces are reachable.
        const url = new URL(request.url);
        const queryRole = url.searchParams.get('role');
        return {
            role: normaliseRole(queryRole ?? 'service_manager'),
            dealerId: '',
            userId: null,
            fullName: 'Demo Manager',
            email: 'demo@pitlane.ai',
        };
    }

    // No header AND not in mock mode -> unauthenticated. API routes that
    // care should reject; callers can detect via dealerId === '' && userId === null.
    return { role: 'service_advisor', dealerId: '', userId: null, fullName: null, email: null };
}

// Back-compat shim — existing call sites used the simpler
// readRoleFromRequest(request). Keep the helper around but always source
// from the same session resolver.
export function readRoleFromRequest(request: Request): PitLaneRole {
    return readSessionFromRequest(request).role;
}

export function canEditDepartments(role: PitLaneRole): boolean {
    return role === 'service_manager';
}

export function canManageStaff(role: PitLaneRole): boolean {
    return role === 'service_manager';
}

export function canViewAnalytics(role: PitLaneRole): boolean {
    return role === 'service_manager' || role === 'group_manager';
}

export function canViewGroupConsole(role: PitLaneRole): boolean {
    return role === 'group_manager';
}

/**
 * Returns the dealer-scope filter to apply to a Supabase query for this
 * session. group_manager returns null (no filter — see all dealers).
 * Other roles return their dealer_id; empty string is treated as null so
 * an unset dealer doesn't accidentally surface another rooftop's data —
 * those callers should be gated upstream anyway.
 */
export function dealerFilter(session: PitLaneSession): string | null {
    if (session.role === 'group_manager') return null;
    return session.dealerId || null;
}

/** Landing page after login per the spec. */
export function landingPathForRole(role: PitLaneRole): string {
    if (role === 'group_manager') return '/group';
    return '/calls';
}
