'use client';

// ─── PitLane Phase 14: shared customer-context bar for upsell list cards ────
//
// Mounted at the top of every upsell card in a LIST VIEW (i.e. /service-desk
// and /group, where the user is browsing pending upsells across multiple
// customers and needs to know whose upsell each one is). Deliberately NOT
// used on /customers/[customerId] — that surface is already scoped to one
// customer and showing this bar would be redundant noise.
//
// Renders:
//   - tier badge (Bronze / Silver / Gold / Platinum, color-coded), if known
//   - customer display name (mock fallback) + formatted phone
//   - vehicle summary line (e.g. "2023 Porsche 911 GT3 RS"), if known
//   - "View profile →" link straight into /customers/[customer_id]

import Link from 'next/link';
import type { UpsellWithContext } from '@/lib/upsell-context';

export const TIER_STYLES: Record<string, string> = {
    Bronze: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
    Silver: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-200',
    Gold: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    Platinum: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200',
};

/**
 * Render a North-American phone number as "+1 (647) 545-7709". Falls back
 * to the raw string when it doesn't look like an 11-digit NANP number so
 * we don't mangle international or test numbers.
 */
export function formatPhone(phone: string | null | undefined): string {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
        return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10) {
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
}

export function UpsellCustomerBar({ upsell }: { upsell: UpsellWithContext }) {
    const tier = upsell.customer_tier;
    const tierCls = tier ? (TIER_STYLES[tier] ?? TIER_STYLES.Bronze) : null;
    const phone = formatPhone(upsell.customer_phone);
    // We only have a customer_id to deep-link to — display label prefers
    // the resolved mock name and falls back to the formatted phone, then
    // the raw id so the card is never blank.
    const displayName =
        upsell.customer_name ??
        (phone || upsell.customer_id || 'Unknown customer');

    return (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
            {tier && tierCls && (
                <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${tierCls}`}
                    title={`${tier} tier customer`}
                >
                    {tier}
                </span>
            )}
            <span className="text-sm font-black text-white">{displayName}</span>
            {phone && upsell.customer_name && (
                <span className="text-xs text-zinc-400">{phone}</span>
            )}
            {upsell.vehicle_summary && (
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-300">
                    {upsell.vehicle_summary}
                </span>
            )}
            {upsell.customer_id && (
                <Link
                    href={`/customers/${encodeURIComponent(upsell.customer_id)}`}
                    onClick={(e) => e.stopPropagation()}
                    className="ml-auto rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-red-200 transition hover:border-red-300 hover:bg-red-500/20 hover:text-white"
                >
                    View profile →
                </Link>
            )}
        </div>
    );
}
