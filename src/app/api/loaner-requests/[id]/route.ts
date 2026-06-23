import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveDealerForRequest } from '@/lib/dealer';

// PATCH /api/loaner-requests/:id
//   body: {
//     status:           'approved' | 'declined' | 'denied' | 'fulfilled' | 'pending',
//     pickup_date?:     'YYYY-MM-DD',   // Phase 10 task 2 — set on approve
//     loaner_vehicle?:  string,         // e.g. 'Cayenne — STD-001'
//     resolved_by?:     string,
//     notes?:           string,
//   }
//
// Used by the /service-desk loaner queue. Stamps resolved_at when the
// status moves out of 'pending'. Returns the updated row.
//
// Mock-mode branch: when NEXT_PUBLIC_USE_MOCK_DATA=true OR Supabase is not
// configured we echo back a synthetic row instead of 503ing — the demo
// flow needs to be able to click Approve without a database.

const ALLOWED_STATUSES = new Set(['approved', 'declined', 'denied', 'fulfilled', 'pending']);

interface RouteContext {
    params: { id: string };
}

interface PatchBody {
    status?: string;
    pickup_date?: string | null;
    loaner_vehicle?: string | null;
    resolved_by?: string;
    notes?: string;
}

const DEMO_DEALER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

export async function PATCH(request: Request, context: RouteContext) {
    const id = context.params.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    let body: PatchBody;
    try {
        body = (await request.json()) as PatchBody;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.status || !ALLOWED_STATUSES.has(body.status)) {
        return NextResponse.json(
            { error: `status must be one of ${Array.from(ALLOWED_STATUSES).join(', ')}` },
            { status: 400 },
        );
    }

    // Normalise 'denied' → 'declined' so we keep a single canonical status
    // value in the database. The UI uses 'denied' wording per spec; the
    // schema uses 'declined' from migration 0001.
    const status = body.status === 'denied' ? 'declined' : body.status;

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        const now = new Date().toISOString();
        return NextResponse.json({
            loaner_request: {
                id,
                call_log_id: null,
                appointment_id: null,
                customer_id: 'cust_unknown',
                dealer_id: DEMO_DEALER_ID,
                requested_date: null,
                loaner_preferred: null,
                status,
                notes: body.notes ?? null,
                resolved_by: status !== 'pending' ? body.resolved_by ?? 'service_desk' : null,
                resolved_at: status !== 'pending' ? now : null,
                created_at: now,
                pickup_date: body.pickup_date ?? null,
                loaner_vehicle: body.loaner_vehicle ?? null,
            },
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const update: Record<string, unknown> = { status };
    if (status !== 'pending') {
        update.resolved_by = body.resolved_by ?? 'service_desk';
        update.resolved_at = new Date().toISOString();
    } else {
        update.resolved_by = null;
        update.resolved_at = null;
    }
    if (typeof body.notes === 'string') update.notes = body.notes;
    if (typeof body.pickup_date === 'string') update.pickup_date = body.pickup_date;
    if (body.pickup_date === null) update.pickup_date = null;
    if (typeof body.loaner_vehicle === 'string') update.loaner_vehicle = body.loaner_vehicle;
    if (body.loaner_vehicle === null) update.loaner_vehicle = null;

    const dealer = await resolveDealerForRequest(request);

    const { data, error } = await supabase
        .from('loaner_requests')
        .update(update)
        .eq('id', id)
        .eq('dealer_id', dealer.id)
        .select('*')
        .single();

    if (error) {
        // pickup_date / loaner_vehicle columns come from migration 0008.
        // Pre-0008 deploys will trip 42703 (undefined_column) on those
        // fields. Retry without them so the status flip still lands.
        const code = (error as { code?: string }).code;
        const message = error.message ?? '';
        const undefinedColumn =
            code === '42703' ||
            /column "(pickup_date|loaner_vehicle)" of relation "loaner_requests" does not exist/i.test(message);
        if (undefinedColumn) {
            console.warn(
                '[/api/loaner-requests] pickup_date/loaner_vehicle columns missing — apply migration 0008. Retrying without.',
            );
            delete update.pickup_date;
            delete update.loaner_vehicle;
            const retry = await supabase
                .from('loaner_requests')
                .update(update)
                .eq('id', id)
                .eq('dealer_id', dealer.id)
                .select('*')
                .single();
            if (retry.error) {
                return NextResponse.json({ error: retry.error.message }, { status: 500 });
            }
            if (!retry.data) {
                return NextResponse.json({ error: 'Loaner request not found' }, { status: 404 });
            }
            return NextResponse.json({
                loaner_request: retry.data,
                persistence: 'supabase_pending_migration',
            });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
        return NextResponse.json({ error: 'Loaner request not found' }, { status: 404 });
    }
    return NextResponse.json({ loaner_request: data, persistence: 'supabase' });
}
