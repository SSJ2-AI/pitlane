'use client';

// Browser-side Supabase client. Used by /login + the sidebar logout button.
// Reads NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY from the
// build-time env so it can run in the browser.

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
    if (cached) return cached;
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
    const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
    if (!url || !key) {
        console.warn('[Supabase] browser client missing NEXT_PUBLIC_SUPABASE_URL/ANON_KEY — auth is disabled');
        return null;
    }
    cached = createBrowserClient(url, key);
    return cached;
}
