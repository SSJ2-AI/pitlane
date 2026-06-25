// ─── PitLane Phase 11: server-side Supabase Auth client ─────────────────────
//
// Built on @supabase/ssr's createServerClient. Reads / writes session
// cookies via Next.js's cookies() API so the middleware + server
// components + API routes all see the same auth session.
//
// Two flavors:
//
//   getSupabaseServerClient()  -> for App Router server components +
//                                 route handlers. Uses cookies() from
//                                 next/headers.
//
//   getSupabaseMiddlewareClient(req, res)
//                              -> for src/middleware.ts. Reads from the
//                                 incoming NextRequest cookies and writes
//                                 to the outgoing NextResponse so refresh-
//                                 token rotation actually persists.

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';

function getSupabaseUrl(): string | null {
    return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim() || null;
}

function getAnonKey(): string | null {
    return (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '').trim() || null;
}

export function isSupabaseAuthConfigured(): boolean {
    return Boolean(getSupabaseUrl() && getAnonKey());
}

/**
 * Server-component / route-handler Supabase client. Reads + writes auth
 * cookies via next/headers' cookies() so getUser() / getSession() work in
 * server-side render and API handlers.
 */
export function getSupabaseServerClient() {
    const url = getSupabaseUrl();
    const key = getAnonKey();
    if (!url || !key) return null;

    const cookieStore = cookies();
    return createServerClient(url, key, {
        cookies: {
            getAll() {
                return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
            },
            setAll(cookiesToSet) {
                try {
                    for (const { name, value, options } of cookiesToSet) {
                        cookieStore.set({ name, value, ...(options as CookieOptions) });
                    }
                } catch {
                    // setAll throws when called from a server component context
                    // (Next allows it only in route handlers / server actions).
                    // The middleware client is responsible for actually
                    // persisting the rotation — this swallow is safe.
                }
            },
        },
    });
}

/**
 * Middleware-aware Supabase client. Reads incoming request cookies and
 * writes refreshed cookies back onto the response so the session keeps
 * rotating without re-login.
 */
export function getSupabaseMiddlewareClient(request: NextRequest, response: NextResponse) {
    const url = getSupabaseUrl();
    const key = getAnonKey();
    if (!url || !key) return null;

    return createServerClient(url, key, {
        cookies: {
            getAll() {
                return request.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
            },
            setAll(cookiesToSet) {
                for (const { name, value, options } of cookiesToSet) {
                    response.cookies.set({ name, value, ...(options as CookieOptions) });
                }
            },
        },
    });
}
