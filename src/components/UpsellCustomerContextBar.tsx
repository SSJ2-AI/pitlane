'use client';

import Link from 'next/link';
import type { UpsellWithCustomerContext } from '@/lib/upsell-context';

const TIER_STYLES: Record<string, string> = {
    Bronze: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
    Silver: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-200',
    Gold: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    Platinum: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200',
};

function formatPhone(phone: string | null | undefined): string {
    const raw = (phone ?? '').trim();
    if (!raw) return 'Phone unavailable';

    const digits = raw.replace(/\D/g, '');
    const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (national.length === 10) {
        return `+1 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
    }
    return raw;
}

export function UpsellCustomerContextBar({ upsell }: { upsell: UpsellWithCustomerContext }) {
    const tier = upsell.customer_tier?.trim() || 'Tier unknown';
    const tierClass = TIER_STYLES[tier] ?? 'border-zinc-700 bg-zinc-900 text-zinc-300';

    return (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${tierClass}`}>
                {tier}
            </span>
            <span className="font-semibold text-zinc-200">{formatPhone(upsell.customer_phone)}</span>
            {upsell.vehicle_summary && (
                <span className="text-zinc-400">{upsell.vehicle_summary}</span>
            )}
            <Link
                href={`/customers/${encodeURIComponent(upsell.customer_id)}`}
                className="ml-auto rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:border-red-500 hover:text-white"
            >
                View Profile
            </Link>
        </div>
    );
}
