import { NextResponse } from 'next/server';
import { readSessionFromRequest } from '@/lib/role';

// GET /api/session — used by the RoleNav client component to render the
// correct subset of nav links + the signed-in user's email. Reads the
// session that the middleware attached as headers.

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const session = readSessionFromRequest(request);
    return NextResponse.json({
        role: session.role,
        dealerId: session.dealerId,
        userId: session.userId,
        fullName: session.fullName,
        email: session.email,
    });
}
