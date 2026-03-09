import React from 'react';
import { getStaffUsers } from '@/app/actions/user';
import StaffListClient from '@/components/dashboard/staff/StaffListClient';

export const dynamic = 'force-dynamic';

import { auth } from '@/auth';

export default async function StaffPage() {
  const session = await auth();
  const sessionUser = session?.user as { organizationId?: string } | undefined;
  const hasOrganization = !!sessionUser?.organizationId;

  const organizationId = sessionUser?.organizationId;

  // Only fetch users if org exists, otherwise empty list
  const users = hasOrganization ? await getStaffUsers() : [];

  return (
    <StaffListClient
      users={users}
      hasOrganization={hasOrganization}
      organizationId={organizationId || ''}
    />
  );
}
