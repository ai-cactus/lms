import React from 'react';
import { redirect } from 'next/navigation';
import { checkSystemAuth, getAllOrganizations } from '@/app/actions/system-admin';
import SystemOrganizationsClient from '@/components/system/SystemOrganizationsClient';

export const dynamic = 'force-dynamic';

export default async function SystemOrganizationsPage() {
  const authenticated = await checkSystemAuth();
  if (!authenticated) {
    redirect('/system');
  }

  const result = await getAllOrganizations({ page: 1, limit: 20 });

  return (
    <SystemOrganizationsClient
      initialOrganizations={result.organizations}
      initialTotal={result.total}
      initialPage={result.page}
      initialTotalPages={result.totalPages}
    />
  );
}
