import { NextResponse } from 'next/server';
import { DEFAULT_DEALER_ID } from '@/lib/dealer';
import { recordAudit } from '@/lib/audit';
import { readSessionFromRequest } from '@/lib/role';
import { getSupabase, type LoanerRequestRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface CreateLoanerRequestBody {
    call_log_id?: string | null;
    appointment_id?: string | null;
    customer_id?: string;
    dealer_id?: string;
    vehicle_id?: string;
    requested_date?: string | null;
    loaner_preferred?: string | null;
    loaner_vehicle_id?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    notes?: string | null;
}

function resolveScopedDealerId(request: Request): string | null {
    const headerDealer = request.headers.get('x-pitlane-dealer');
    if (headerDealer && headerDealer.trim().length > 0) return headerDealer.trim();
    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') return DEFAULT_DEALER_ID;
    return null;
}

function hasRoleHeader(request: Request): boolean {
    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') return true;
    return Boolean(request.headers.get('x-pitlane-role'));
}

function isIsoDate(value: string | null | undefined): boolean {
    if (!value) return true;
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(request: Request) {
    if (!hasRoleHeader(request)) {
        return NextResponse.json({ error: 'Unauthorized — missing x-pitlane-role header' }, { status: 401 });
    }

    const session = readSessionFromRequest(request);
    if (!['service_advisor', 'service_manager', 'group_manager'].includes(session.role)) {
        return NextResponse.json({ error: 'Forbidden — invalid staff role' }, { status: 403 });
    }

    let body: CreateLoanerRequestBody;
    try {
        body = await request.json() as CreateLoanerRequestBody;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.customer_id) {
        return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
    }
    if (!isIsoDate(body.start_date) || !isIsoDate(body.end_date)) {
        return NextResponse.json({ error: 'start_date/end_date must be YYYY-MM-DD' }, { status: 400 });
    }

    const scopedDealerId = resolveScopedDealerId(request);
    const dealerId = (body.dealer_id && body.dealer_id.trim()) || scopedDealerId;
    if (!dealerId) {
        return NextResponse.json({ error: 'dealer_id is required' }, { status: 400 });
    }
    if (session.role !== 'group_manager' && scopedDealerId && dealerId !== scopedDealerId) {
        return NextResponse.json({ error: 'dealer_id mismatch for current session scope' }, { status: 403 });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const augmentedNotes = body.vehicle_id
        ? `${body.notes ? `${body.notes}\n` : ''}Customer vehicle: ${body.vehicle_id}`
        : (body.notes ?? null);

    const { data, error } = await supabase
        .from('loaner_requests')
        .insert({
            call_log_id: body.call_log_id ?? null,
            appointment_id: body.appointment_id ?? null,
            customer_id: body.customer_id,
            dealer_id: dealerId,
            requested_date: body.requested_date ?? body.start_date ?? null,
            loaner_preferred: body.loaner_preferred ?? null,
            loaner_vehicle_id: body.loaner_vehicle_id ?? null,
            start_date: body.start_date ?? null,
            end_date: body.end_date ?? null,
            notes: augmentedNotes,
            status: 'pending',
        })
        .select('*')
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'loaner_request_created',
        resourceType: 'loaner_request',
        resourceId: (data as { id?: string } | null)?.id ?? null,
    });

    return NextResponse.json({ loaner_request: data as LoanerRequestRow, persistence: 'supabase' }, { status: 201 });
}
