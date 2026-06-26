import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ManagerCalendarClient } from './page-client';

export const dynamic = 'force-dynamic';

export default function ManagerCalendarPage() {
    const headerStore = headers();
    const role = headerStore.get('x-pitlane-role')?.trim().toLowerCase()
        ?? (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true' ? 'service_manager' : 'service_advisor');

    if (role !== 'service_manager') {
        redirect('/calls');
    }

    return <ManagerCalendarClient />;
}
