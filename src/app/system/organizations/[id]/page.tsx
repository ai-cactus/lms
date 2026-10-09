import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { checkSystemAuth, getOrganizationDetail } from '@/app/actions/system-admin';
import OrganizationDetailClient from '@/components/system/OrganizationDetailClient';

export const dynamic = 'force-dynamic';

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const authenticated = await checkSystemAuth();
  if (!authenticated) {
    redirect('/system');
  }

  const { id } = await params;
  const organization = await getOrganizationDetail(id);

  if (!organization) {
    notFound();
  }

  return <OrganizationDetailClient organization={organization} />;
}
