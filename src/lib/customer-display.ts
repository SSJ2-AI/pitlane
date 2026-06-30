export const TIER_STYLES: Record<'Bronze' | 'Silver' | 'Gold' | 'Platinum', string> = {
    Bronze: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
    Silver: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-200',
    Gold: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    Platinum: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200',
};

export type CustomerTierLabel = keyof typeof TIER_STYLES;

export function normalizeCustomerTier(value: string | null | undefined): CustomerTierLabel | null {
    const normalized = (value ?? '').trim().toLowerCase();
    if (normalized === 'bronze') return 'Bronze';
    if (normalized === 'silver') return 'Silver';
    if (normalized === 'gold') return 'Gold';
    if (normalized === 'platinum') return 'Platinum';
    return null;
}

export function formatCustomerPhone(value: string | null | undefined): string {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return 'Phone unavailable';
    const digits = trimmed.replace(/\D/g, '');
    const usCaDigits = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (usCaDigits.length === 10) {
        const area = usCaDigits.slice(0, 3);
        const prefix = usCaDigits.slice(3, 6);
        const line = usCaDigits.slice(6);
        return `+1 (${area}) ${prefix}-${line}`;
    }
    if (digits.length > 0 && trimmed.startsWith('+')) return trimmed;
    if (digits.length > 0) return `+${digits}`;
    return trimmed;
}
