import React from 'react';
import { getStaffDetails } from '@/app/actions/staff';
import StaffProfileClient from '@/components/dashboard/staff/StaffProfileClient';
import { requirePermissionWithFacilityScope } from '@/lib/rbac/require-permission';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffProfilePage({ params }: PageProps) {
  const { id } = await params;

  // D-01: `onDeny: 'notFound'` rather than a redirect — this URL is addressed by
  // someone else's id, so a 403 would confirm that the id exists. A caller
  // without `user.read` must not be able to tell a real member from a fiction.
  const ctx = await requirePermissionWithFacilityScope('user.read', undefined, {
    onDeny: 'notFound',
  });

  const staff = await getStaffDetails(id);
  if (!staff) {
    notFound();
  }

  return (
    <StaffProfileClient staff={staff} viewerRole={ctx.role} facilities={ctx.accessibleFacilities} />
  );
}
