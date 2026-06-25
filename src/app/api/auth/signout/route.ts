import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

// POST /api/auth/signout — clears the Supabase session cookie + bounces
// the caller to /login. Used by the sidebar logout button.

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const supabase = getSupabaseServerClient();
    if (supabase) {
        await supabase.auth.signOut();
    }
    return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}

// Also accept GET so a plain anchor link works (graceful fallback when
// JS is unavailable).
export async function GET(request: Request) {
    return POST(request);
}
