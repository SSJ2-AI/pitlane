'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { PitLaneRole } from '@/lib/role';
import { ROLE_HIERARCHY } from '@/lib/role';

// Phase 11 — shared nav row with role-gated entries + logout button.
//
// The component is mounted by every dashboard page's <header>. It pulls
// the caller's role from a tiny /api/session GET so the rendered nav is
// always honest about what the user can actually open. In mock mode the
// ?role=… URL query is honoured the same way the role helper honours it.

const ALL_LINKS: Array<{
    href: string;
    label: string;
    minRole?: PitLaneRole;
    rolesOnly?: PitLaneRole[];
}> = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/calls', label: 'Calls' },
    { href: '/customers', label: 'Customers' },
    { href: '/schedule', label: 'Schedule' },
    { href: '/service-desk', label: 'Service desk' },
    { href: '/analytics', label: 'Analytics', minRole: 'service_manager' },
    { href: '/manager/departments', label: 'Departments', rolesOnly: ['service_manager'] },
    { href: '/manager/staff', label: 'Staff', rolesOnly: ['service_manager'] },
    { href: '/group', label: 'Group', rolesOnly: ['group_manager'] },
];

interface SessionPayload {
    role: PitLaneRole;
    dealerId: string;
    fullName: string | null;
    email: string | null;
}

export function RoleNav() {
    return (
        <Suspense fallback={null}>
            <RoleNavInner />
        </Suspense>
    );
}

function RoleNavInner() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [session, setSession] = useState<SessionPayload | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const r = await fetch('/api/session', { cache: 'no-store' });
                if (!r.ok) return;
                const payload = (await r.json()) as SessionPayload;
                if (!cancelled) setSession(payload);
            } catch {
                /* nav stays in fallback state */
            }
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    // Preserve ?role= query through nav links in mock mode so the demo
    // role flag carries between pages.
    const roleQuery = searchParams.get('role');
    function hrefWithRole(href: string): string {
        if (!roleQuery) return href;
        const sep = href.includes('?') ? '&' : '?';
        return `${href}${sep}role=${encodeURIComponent(roleQuery)}`;
    }

    const role = session?.role ?? 'service_advisor';

    const visibleLinks = ALL_LINKS.filter((link) => {
        if (link.rolesOnly && !link.rolesOnly.includes(role)) return false;
        if (link.minRole && ROLE_HIERARCHY[role] < ROLE_HIERARCHY[link.minRole]) return false;
        return true;
    });

    return (
        <div className="flex flex-wrap items-center gap-2">
            {visibleLinks.map((link) => {
                const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
                return active ? (
                    <span key={link.href} className="inline-flex items-center rounded-full border border-red-500/40 bg-red-600/15 px-3 py-1.5 text-xs font-semibold text-red-200">
                        {link.label}
                    </span>
                ) : (
                    <Link
                        key={link.href}
                        href={hrefWithRole(link.href)}
                        className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:border-red-500 hover:text-white"
                    >
                        {link.label}
                    </Link>
                );
            })}
            <form action="/api/auth/signout" method="post" className="inline">
                <button
                    type="submit"
                    className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:border-red-500 hover:text-white"
                >
                    {session?.email ? `Sign out · ${session.email}` : 'Sign out'}
                </button>
            </form>
        </div>
    );
}
