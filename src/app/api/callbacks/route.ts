// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSupabase, type CallbackRequestRow } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';

// GET /api/callbacks
//   ?status=pending|acknowledged|completed (default: pending,acknowledged)
//
// Returns the callback queue for the dealer, sorted: frustrated first,
// then negative, then by created_at ASC (oldest pending bubbles up).
//
// Mock-mode synthesises a few rows so the demo deploy has something to
// click on.

export const dynamic = 'force-dynamic';

const SENTIMENT_PRIORITY: Record<string, number> = {
    frustrated: 0,
    negative: 1,
    neutral: 2,
    positive: 3,
};

function compareForQueue(a: CallbackRequestRow, b: CallbackRequestRow): number {
    const sa = SENTIMENT_PRIORITY[a.sentiment ?? 'neutral'] ?? 2;
    const sb = SENTIMENT_PRIORITY[b.sentiment ?? 'neutral'] ?? 2;
    if (sa !== sb) return sa - sb;
    if (a.created_at === b.created_at) return 0;
    return a.created_at < b.created_at ? -1 : 1;
}

function getMockCallbacks(): CallbackRequestRow[] {
    const now = Date.now();
    return [
        {
            id: 'cb_mock_001',
            dealer_id: 'aaaaaaaa-0000-0000-0000-000000000001',
            customer_phone: '+14165550202',
            customer_name: 'Priya Mehta',
            call_log_id: 'call_007',
            reason: 'Wants to speak with Sarah about Taycan recall timeline.',
            sentiment: 'frustrated',
            sentiment_score: 0.86,
            status: 'pending',
            assigned_advisor_id: null,
            created_at: new Date(now - 12 * 60_000).toISOString(),
            acknowledged_at: null,
            completed_at: null,
        },
        {
            id: 'cb_mock_002',
            dealer_id: 'aaaaaaaa-0000-0000-0000-000000000001',
            customer_phone: '+14375550303',
            customer_name: 'David Okafor',
            call_log_id: 'call_003',
            reason: 'Loaner confirmation for tomorrow 9am drop-off.',
            sentiment: 'neutral',
            sentiment_score: 0.6,
            status: 'pending',
            assigned_advisor_id: null,
            created_at: new Date(now - 45 * 60_000).toISOString(),
            acknowledged_at: null,
            completed_at: null,
        },
        {
            id: 'cb_mock_003',
            dealer_id: 'aaaaaaaa-0000-0000-0000-000000000001',
            customer_phone: '+16475550101',
            customer_name: 'James Whitfield',
            call_log_id: 'call_001',
            reason: 'Wanted Marco to call back about brake quote.',
            sentiment: 'positive',
            sentiment_score: 0.78,
            status: 'acknowledged',
            assigned_advisor_id: 'marco_a',
            created_at: new Date(now - 3 * 3_600_000).toISOString(),
            acknowledged_at: new Date(now - 2 * 3_600_000).toISOString(),
            completed_at: null,
        },
    ];
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status');

    const useMock = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';
    const supabase = useMock ? null : getSupabase();

    let rows: CallbackRequestRow[];
    let persistence: 'supabase' | 'mock';

    if (!supabase) {
        rows = getMockCallbacks();
        persistence = 'mock';
    } else {
        const dealer = await resolveDealerForRequest(request);
        let q = supabase
            .from('callback_requests')
            .select('*')
            .eq('dealer_id', dealer.id)
            .order('created_at', { ascending: false })
            .limit(200);
        if (statusFilter) q = q.in('status', statusFilter.split(','));
        else q = q.in('status', ['pending', 'acknowledged']);
        const { data, error } = await q;
        if (error) {
            const code = (error as { code?: string }).code;
            if (code === '42P01') {
                console.warn('[/api/callbacks] callback_requests missing — apply migration 0007');
                return NextResponse.json({ callbacks: [], persistence: 'mock' });
            }
            console.error('[/api/callbacks] query failed:', error.message);
            return NextResponse.json({ callbacks: [], persistence: 'mock', error: error.message });
        }
        rows = (data ?? []) as CallbackRequestRow[];
        persistence = 'supabase';
    }

    // Apply the queue sort client-side (Supabase can't easily express
    // "frustrated first then oldest" in a single ORDER BY).
    rows = [...rows].sort(compareForQueue);
    if (statusFilter) {
        const allowed = new Set(statusFilter.split(','));
        rows = rows.filter((r) => allowed.has(r.status));
    }

    return NextResponse.json({ callbacks: rows, persistence });
}
