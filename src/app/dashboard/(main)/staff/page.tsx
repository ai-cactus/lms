import React from 'react';
import { getStaffUsers } from '@/app/actions/user';
import StaffListClient from '@/components/dashboard/staff/StaffListClient';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { BILLING_PLANS } from '@/lib/billing-plans';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const session = await auth();
  const sessionUser = session?.user as { organizationId?: string } | undefined;
  const hasOrganization = !!sessionUser?.organizationId;
  const organizationId = sessionUser?.organizationId;

  // Only fetch users if org exists, otherwise return empty list
  const users = hasOrganization ? await getStaffUsers() : [];

  // Fetch plan quota info so the UI can show seat usage and block at-limit invites
  let planLimit: number | null = null;
  let planName: string = '';
  let currentWorkerCount = 0;
  let pendingInviteCount = 0;

  if (organizationId) {
    const [subscription, workerCount, pendingCount] = await Promise.all([
      prisma.subscription.findUnique({
        where: { organizationId },
        select: { plan: true, status: true },
      }),
      prisma.user.count({
        where: { organizationId, role: 'worker' },
      }),
      prisma.invite.count({
        where: {
          organizationId,
          status: 'pending',
          expiresAt: { gt: new Date() },
        },
      }),
    ]);

    if (subscription && subscription.status !== 'canceled') {
      const planConfig = BILLING_PLANS.find((p) => p.key === subscription.plan);
      if (planConfig) {
        planLimit = planConfig.staffMax; // null = unlimited (enterprise)
        planName = planConfig.name;
      }
    }

    currentWorkerCount = workerCount;
    pendingInviteCount = pendingCount;
  }

  return (
    <StaffListClient
      users={users}
      hasOrganization={hasOrganization}
      organizationId={organizationId || ''}
      planLimit={planLimit}
      planName={planName}
      currentWorkerCount={currentWorkerCount}
      pendingInviteCount={pendingInviteCount}
    />
  );
}
