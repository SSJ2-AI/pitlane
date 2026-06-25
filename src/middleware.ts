import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseMiddlewareClient, isSupabaseAuthConfigured } from '@/lib/supabase-server';

// ─── PitLane Phase 11: auth + role middleware ───────────────────────────────
//
// Runs on every dashboard request. Responsibilities:
//
//   1. Keep the Supabase Auth session fresh (refresh-token rotation via
//      @supabase/ssr — cookies are read from the incoming request and
//      written onto the outgoing response).
//   2. Look up the staff row keyed by auth.uid() once per request and
//      stamp { x-pitlane-role, x-pitlane-dealer, x-pitlane-user-id,
//      x-pitlane-name, x-pitlane-email } onto the request headers so
//      downstream route handlers + server components can read the
//      session without hitting Supabase again.
//   3. Bounce unauthenticated requests to /login (except for the
//      /login page itself, /api/voice/* tool endpoints which ElevenLabs
//      calls server-to-server, and static assets).
//   4. Mock mode (NEXT_PUBLIC_USE_MOCK_DATA=true) bypasses the auth gate
//      entirely so the dev environment runs without real Supabase
//      accounts.

const PUBLIC_PATHS = [
    '/login',
    '/api/auth',          // POST /api/auth/signout
    '/api/voice',         // ElevenLabs tools — called server-to-server
    '/api/lookup',        // legacy voice-side lookup
    '/api/voice-status',  // health probe
    '/auth/callback',     // password-reset / magic-link return
];

function isPublicPath(pathname: string): boolean {
    if (pathname === '/' || pathname === '/login') return true;
    for (const prefix of PUBLIC_PATHS) {
        if (pathname.startsWith(prefix)) return true;
    }
    return false;
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Mock-mode short-circuit. Honour the pre-Phase-11 ?role= URL hint by
    // copying it into the x-pitlane-role header so downstream readers
    // (readSessionFromRequest, /api/departments role gate, etc.) keep
    // working without real auth.
    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        const response = NextResponse.next();
        const url = request.nextUrl;
        const queryRole = url.searchParams.get('role');
        if (queryRole) {
            const reqHeaders = new Headers(request.headers);
            reqHeaders.set('x-pitlane-role', queryRole);
            return NextResponse.next({ request: { headers: reqHeaders } });
        }
        return response;
    }

    if (!isSupabaseAuthConfigured()) {
        // Auth not configured (e.g. preview deploy missing env vars).
        // Let public paths through, redirect everything else to /login so
        // it's obvious what's missing rather than silently leaking data.
        if (isPublicPath(pathname)) return NextResponse.next();
        return NextResponse.redirect(new URL('/login?error=auth-not-configured', request.url));
    }

    // Real auth path. Spin up a middleware-scoped Supabase client so the
    // refresh-token rotation writes cookies back onto the outgoing
    // response.
    const response = NextResponse.next();
    const supabase = getSupabaseMiddlewareClient(request, response);
    if (!supabase) {
        if (isPublicPath(pathname)) return response;
        return NextResponse.redirect(new URL('/login', request.url));
    }

    const { data: userResult } = await supabase.auth.getUser();
    const user = userResult.user;

    if (!user) {
        if (isPublicPath(pathname)) return response;
        const redirectUrl = new URL('/login', request.url);
        redirectUrl.searchParams.set('next', pathname);
        return NextResponse.redirect(redirectUrl);
    }

    // Already on /login but already signed in? Bounce to the role landing
    // page so the user doesn't get stuck on the form.
    if (pathname === '/login') {
        const staffRow = await fetchStaffRow(supabase, user.id);
        const landing = staffRow?.role === 'group_manager' ? '/group' : '/calls';
        return NextResponse.redirect(new URL(landing, request.url));
    }

    const staffRow = await fetchStaffRow(supabase, user.id);
    if (!staffRow || !staffRow.is_active) {
        // Authenticated user has no active staff row -> deny.
        const redirectUrl = new URL('/login', request.url);
        redirectUrl.searchParams.set('error', staffRow ? 'account-disabled' : 'no-staff-row');
        return NextResponse.redirect(redirectUrl);
    }

    // Stamp session headers. Downstream handlers read these via
    // readSessionFromRequest() in src/lib/role.ts.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-pitlane-role', staffRow.role);
    requestHeaders.set('x-pitlane-dealer', staffRow.dealer_id ?? '');
    requestHeaders.set('x-pitlane-user-id', user.id);
    requestHeaders.set('x-pitlane-name', staffRow.full_name ?? '');
    requestHeaders.set('x-pitlane-email', staffRow.email ?? user.email ?? '');

    return NextResponse.next({ request: { headers: requestHeaders } });
}

interface StaffSnapshot {
    role: 'service_advisor' | 'service_manager' | 'group_manager';
    dealer_id: string | null;
    is_active: boolean;
    full_name: string | null;
    email: string | null;
}

// We deliberately cast to `unknown` here. The exact SupabaseClient type
// from @supabase/ssr triggers a "type instantiation is excessively deep"
// error when the middleware bundle is compiled, and the row shape we read
// is narrow + stable. Keeping this internal helper untyped at the
// SupabaseClient seam works around the compiler bug without hiding
// anything from the caller — the StaffSnapshot return shape is checked.
async function fetchStaffRow(client: unknown, userId: string): Promise<StaffSnapshot | null> {
    const sb = client as {
        from: (table: string) => {
            select: (cols: string) => {
                eq: (col: string, value: string) => {
                    maybeSingle: () => Promise<{
                        data: StaffSnapshot | null;
                        error: { code?: string; message?: string } | null;
                    }>;
                };
            };
        };
    };
    try {
        const { data, error } = await sb
            .from('staff')
            .select('role,dealer_id,is_active,full_name,email')
            .eq('id', userId)
            .maybeSingle();
        if (error) {
            const code = error.code;
            if (code === '42P01') {
                console.warn('[middleware] staff table missing — apply migration 0010');
            } else {
                console.error('[middleware] staff lookup failed:', error.message);
            }
            return null;
        }
        return data ?? null;
    } catch (err) {
        console.error('[middleware] staff lookup threw:', err instanceof Error ? err.message : err);
        return null;
    }
}

// Match everything except Next internals + static assets. The path-based
// auth gating happens inside the middleware body via isPublicPath().
export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)',
    ],
};
