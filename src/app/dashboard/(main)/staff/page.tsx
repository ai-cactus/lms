import React from 'react';
import { getStaffUsers } from '@/app/actions/user';
import StaffListClient from '@/components/dashboard/staff/StaffListClient';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
    const users = await getStaffUsers();

    return <StaffListClient users={users} />;
}
