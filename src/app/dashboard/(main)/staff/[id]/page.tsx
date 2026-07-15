import React from 'react';
import { getStaffDetails } from '@/app/actions/staff';
import StaffProfileClient from '@/components/dashboard/staff/StaffProfileClient';
import { auth } from '@/auth';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffProfilePage({ params }: PageProps) {
  const { id } = await params;
  const [session, staff] = await Promise.all([auth(), getStaffDetails(id)]);

  if (!session?.user?.id || !staff) {
    notFound();
  }

  return (
    <StaffProfileClient
      staff={staff}
      viewerRole={session.user.role}
      viewerUserId={session.user.id}
    />
  );
}
