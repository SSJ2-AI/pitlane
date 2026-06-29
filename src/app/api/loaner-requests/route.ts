import { NextResponse } from 'next/server';
import { getSupabase, type LoanerRequestRow } from '@/lib/supabase';
import { resolveScopeForRequest } from '@/lib/dealer';
import { readSessionFromRequest } from '@/lib/role';
import { recordAudit } from '@/lib/audit';

// POST /api/loaner-requests
//
// Phase 13 — staff-initiated loaner request (the customer profile's
// "Request Loaner" button submits here). The voice service still
// inserts loaner_requests directly via insertLoanerRequest() from
// Aria's request_loaner tool; this route is the dashboard equivalent.
//
// Body: { customer_id, vehicle_id?, loaner_vehicle_id?, start_date?,
//         end_date?, notes?, loaner_preferred? }
//
// Auth: any authenticated staff role. Server-side role validation: we
// require a non-empty role header (the middleware sets it). Group
// managers in mock dev mode are allowed for parity; in production their
// dealerId is empty so the insert would be rejected with a 400.

export const dynamic = 'force-dynamic';

interface LoanerCreateBody {
    customer_id?: string;
    vehicle_id?: string | null;
    loaner_vehicle_id?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    notes?: string | null;
    loaner_preferred?: string | null;
    requested_date?: string | null;
}

export async function POST(request: Request) {
    const session = readSessionFromRequest(request);
    // Server-side role check: must be a recognised role and not an
    // unauthenticated default landing. service_advisor + service_manager
    // can submit; group_manager is read-only across the org.
    if (session.role !== 'service_advisor' && session.role !== 'service_manager') {
        return NextResponse.json(
            { error: 'Forbidden — loaner requests must be initiated by service staff.' },
            { status: 403 },
        );
    }

    let body: LoanerCreateBody;
    try {
        body = (await request.json()) as LoanerCreateBody;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const customerId = body.customer_id?.trim();
    if (!customerId) {
        return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
    }

    const scope = await resolveScopeForRequest(request);
    const dealerId = scope.dealerId ?? scope.dealer.id;
    if (!dealerId) {
        return NextResponse.json({ error: 'No dealer scope for this session.' }, { status: 400 });
    }

    const row = {
        customer_id: customerId,
        dealer_id: dealerId,
        loaner_vehicle_id: body.loaner_vehicle_id ?? null,
        start_date: body.start_date ?? null,
        end_date: body.end_date ?? null,
        requested_date: body.requested_date ?? body.start_date ?? null,
        loaner_preferred: body.loaner_preferred ?? null,
        notes: body.notes ?? null,
        status: 'pending',
    };

    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        const now = new Date().toISOString();
        return NextResponse.json({
            loaner_request: {
                ...row,
                id: `loaner_req_mock_${Date.now().toString(36)}`,
                call_log_id: null,
                appointment_id: null,
                resolved_by: null,
                resolved_at: null,
                created_at: now,
            } satisfies LoanerRequestRow,
            persistence: 'mock',
        });
    }

    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

    const { data, error } = await supabase
        .from('loaner_requests')
        .insert(row)
        .select('*')
        .single();

    if (error) {
        // 42703 = column missing (loaner_vehicle_id / start_date / end_date
        // before migration 0014 applied). Retry without the new columns
        // so the existing service-desk flow keeps working until the
        // migration lands.
        const code = (error as { code?: string }).code;
        if (code === '42703') {
            const fallback = {
                customer_id: row.customer_id,
                dealer_id: row.dealer_id,
                requested_date: row.requested_date,
                loaner_preferred: row.loaner_preferred,
                notes: row.notes,
                status: row.status,
            };
            const retry = await supabase
                .from('loaner_requests')
                .insert(fallback)
                .select('*')
                .single();
            if (retry.error) {
                return NextResponse.json({ error: retry.error.message }, { status: 500 });
            }
            void recordAudit(request, session, {
                action: 'loaner_request_created',
                resourceType: 'loaner_request',
                resourceId: (retry.data as { id?: string } | null)?.id ?? null,
            });
            return NextResponse.json({
                loaner_request: retry.data as LoanerRequestRow,
                persistence: 'supabase',
                fallback: 'pre_migration_0014',
            });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'loaner_request_created',
        resourceType: 'loaner_request',
        resourceId: (data as { id?: string } | null)?.id ?? null,
    });

    return NextResponse.json({
        loaner_request: data as LoanerRequestRow,
        persistence: 'supabase',
    });
}
