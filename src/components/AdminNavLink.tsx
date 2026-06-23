'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

/**
 * Renders the "Admin" nav pill on every dashboard surface — but only
 * when the URL carries ?admin=true. Phase 10 fix 3 (dealer onboarding
 * portal) uses this as a lightweight gate before the dedicated
 * role-based auth lands in Phase 11.
 *
 * Pages mount this inside their <nav> next to the static nav links so
 * it appears in the same position consistently. The internal Suspense
 * boundary means consumer pages don't have to wrap themselves to satisfy
 * Next.js' useSearchParams + static-prerender contract.
 */
export function AdminNavLink() {
    return (
        <Suspense fallback={null}>
            <AdminNavLinkInner />
        </Suspense>
    );
}

function AdminNavLinkInner() {
    const searchParams = useSearchParams();
    if (searchParams.get('admin') !== 'true') return null;
    return (
        <Link
            href="/admin/dealers?admin=true"
            className="rounded-full border border-red-500/40 bg-red-600/15 px-4 py-2 text-sm font-semibold text-red-200 transition hover:border-red-400 hover:text-white"
        >
            Admin
        </Link>
    );
}
