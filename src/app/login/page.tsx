'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase-client';
import { landingPathForRole, type PitLaneRole } from '@/lib/role';

// /login — email + password sign-in form. Routes to the role-appropriate
// landing page on success. "Forgot password" triggers Supabase's reset-
// password email flow (the email link bounces back to /auth/callback).
//
// In USE_MOCK_DATA mode the page still renders, but a banner explains
// that mock mode bypasses auth and the form is a no-op pointer to the
// real role.

export default function LoginPage() {
    return (
        <Suspense fallback={<LoginFallback />}>
            <LoginInner />
        </Suspense>
    );
}

function LoginFallback() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-[#09090b] text-zinc-100">
            <p className="text-sm text-zinc-400">Loading…</p>
        </main>
    );
}

function LoginInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const next = searchParams.get('next') ?? null;
    const initialError = searchParams.get('error');

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(decodeInitialError(initialError));
    const [info, setInfo] = useState<string | null>(null);

    const mockMode = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        setInfo(null);
        setSubmitting(true);
        try {
            const client = getSupabaseBrowserClient();
            if (!client) {
                setError('Supabase auth is not configured on this deploy.');
                return;
            }
            const { error: signInError, data } = await client.auth.signInWithPassword({ email, password });
            if (signInError) {
                setError(signInError.message);
                return;
            }
            // Pull role for the landing redirect. We could let the
            // middleware bounce us, but doing it here avoids a flash of
            // /login. Fallback: just go to /calls.
            const { data: staffRow } = await client
                .from('staff')
                .select('role')
                .eq('id', data.user?.id ?? '')
                .maybeSingle();
            const role = (staffRow?.role as PitLaneRole | undefined) ?? 'service_advisor';
            router.replace(next ?? landingPathForRole(role));
            router.refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Sign-in failed');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleForgotPassword() {
        setError(null);
        setInfo(null);
        if (!email.trim()) {
            setError('Enter your email above first.');
            return;
        }
        const client = getSupabaseBrowserClient();
        if (!client) {
            setError('Supabase auth is not configured on this deploy.');
            return;
        }
        const redirectTo =
            typeof window === 'undefined' ? undefined : `${window.location.origin}/auth/callback?reset=1`;
        const { error: resetError } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (resetError) {
            setError(resetError.message);
            return;
        }
        setInfo('Password reset email sent. Check your inbox.');
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-[#09090b] px-4 text-zinc-100">
            <div className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl shadow-black/40">
                <Link href="/" className="mb-6 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-600/15 text-sm font-black text-red-100">PL</div>
                    <div>
                        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">PitLane</p>
                        <p className="text-lg font-black tracking-tight text-white">Sign in</p>
                    </div>
                </Link>

                {mockMode && (
                    <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
                        Mock mode — auth is bypassed for dev. Append <code className="rounded bg-amber-500/20 px-1.5">?role=service_manager</code> or <code className="rounded bg-amber-500/20 px-1.5">?role=group_manager</code> on any URL to preview a different role.
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Email</span>
                        <input
                            type="email"
                            required
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="mt-2 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                        />
                    </label>
                    <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Password</span>
                        <input
                            type="password"
                            required
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="mt-2 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                        />
                    </label>

                    {error && (
                        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>
                    )}
                    {info && (
                        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{info}</div>
                    )}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full rounded-2xl bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-[0.22em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-900 disabled:text-zinc-400"
                    >
                        {submitting ? 'Signing in…' : 'Sign in'}
                    </button>
                </form>

                <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400 transition hover:text-red-300"
                >
                    Forgot password?
                </button>
            </div>
        </main>
    );
}

function decodeInitialError(code: string | null): string | null {
    if (!code) return null;
    switch (code) {
        case 'no-staff-row':
            return 'Your account is signed in but has no PitLane staff row. Contact your service manager.';
        case 'account-disabled':
            return 'Your PitLane account has been deactivated. Contact your service manager.';
        case 'auth-not-configured':
            return 'Supabase auth is not configured on this deploy.';
        default:
            return decodeURIComponent(code);
    }
}
