import React from 'react';
import { getAllUsers, checkSystemAuth } from '@/app/actions/system-admin';
import { redirect } from 'next/navigation';
import SystemUsersClient from '@/components/system/SystemUsersClient';

export const dynamic = 'force-dynamic';

export default async function SystemPage() {
  const authenticated = await checkSystemAuth();
  if (!authenticated) {
    redirect('/system');
  }

  const result = await getAllUsers({ page: 1, limit: 20 });

  return (
    <SystemUsersClient
      initialUsers={result.users}
      initialTotal={result.total}
      initialPage={result.page}
      initialTotalPages={result.totalPages}
      organizations={result.organizations}
    />
  );
}
