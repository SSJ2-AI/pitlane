import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { readSessionFromRequest } from '@/lib/role';
import { getSupabase, type LoanerRequestRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type CreateLoanerRequestBody = {
    customer_id?: string;
    dealer_id?: string;
    vehicle_id?: string | null;
    loaner_vehicle_id?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    notes?: string | null;
};

function isIsoDate(value: string | null | undefined): value is string {
    return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function POST(request: Request) {
    const session = readSessionFromRequest(request);
    if (!session.userId && process.env.NEXT_PUBLIC_USE_MOCK_DATA !== 'true') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!['service_advisor', 'service_manager'].includes(session.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body: CreateLoanerRequestBody;
    try {
        body = (await request.json()) as CreateLoanerRequestBody;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const customerId = body.customer_id?.trim();
    const dealerId = body.dealer_id?.trim() || session.dealerId || null;
    if (!customerId || !dealerId) {
        return NextResponse.json({ error: 'customer_id and dealer_id are required.' }, { status: 400 });
    }
    if (session.dealerId && dealerId !== session.dealerId) {
        return NextResponse.json({ error: 'Forbidden for this dealer.' }, { status: 403 });
    }
    if ((body.start_date || body.end_date) && (!isIsoDate(body.start_date) || !isIsoDate(body.end_date))) {
        return NextResponse.json({ error: 'start_date and end_date must both be YYYY-MM-DD.' }, { status: 400 });
    }

    const startDate = body.start_date ?? null;
    const endDate = body.end_date ?? null;
    const row = {
        customer_id: customerId,
        dealer_id: dealerId,
        vehicle_id: body.vehicle_id || null,
        loaner_vehicle_id: body.loaner_vehicle_id || null,
        start_date: startDate,
        end_date: endDate,
        requested_date: startDate,
        loaner_preferred: body.loaner_vehicle_id ? 'specific_vehicle' : null,
        notes: body.notes?.trim() || null,
    };

    const supabase = getSupabase();
    if (!supabase || process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
        return NextResponse.json({
            loaner_request: {
                id: `loaner_request_mock_${Date.now().toString(36)}`,
                call_log_id: null,
                appointment_id: null,
                status: 'pending',
                resolved_by: null,
                resolved_at: null,
                created_at: new Date().toISOString(),
                ...row,
            } satisfies LoanerRequestRow,
            persistence: 'mock',
        });
    }

    const { data, error } = await supabase
        .from('loaner_requests')
        .insert(row)
        .select('*')
        .single();

    if (error) {
        const code = (error as { code?: string }).code;
        if (code === '42703') {
            return NextResponse.json({ error: 'loaner_requests needs migration 0014 columns.' }, { status: 503 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void recordAudit(request, session, {
        action: 'loaner_request_created',
        resourceType: 'loaner_request',
        resourceId: (data as LoanerRequestRow | null)?.id ?? null,
    });

    return NextResponse.json({ loaner_request: data as LoanerRequestRow, persistence: 'supabase' });
}
