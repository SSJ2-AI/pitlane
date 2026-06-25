import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

// /auth/callback — return URL for Supabase magic links + password-reset
// emails. Exchanges the one-time code in the URL for an actual session,
// then bounces to /login?reset=1 (for resets — user picks a new password
// there) or directly to /calls.

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const isReset = url.searchParams.get('reset') === '1';

    const supabase = getSupabaseServerClient();
    if (code && supabase) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
            const fail = new URL('/login', request.url);
            fail.searchParams.set('error', error.message);
            return NextResponse.redirect(fail);
        }
    }

    // For reset flows we leave the user on /login with a banner asking
    // them to pick a new password (handled in the login page UI later;
    // for now we just route them home and surface a one-liner).
    if (isReset) {
        const target = new URL('/login', request.url);
        target.searchParams.set('error', 'Password reset complete — sign in with your new password.');
        return NextResponse.redirect(target);
    }

    return NextResponse.redirect(new URL('/calls', request.url));
}
