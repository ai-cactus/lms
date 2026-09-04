import React from 'react';
import { getStaffUsers } from '@/app/actions/user';
import StaffListClient from '@/components/dashboard/staff/StaffListClient';
import prisma from '@/lib/prisma';
import { countBillableStaff } from '@/lib/seat-limits';
import { BILLING_PLANS } from '@/lib/billing-plans';
import { DEFAULT_SELF_SERVE_WORKER_ROLE } from '@/lib/rbac/role-utils';
import { requirePermissionWithFacilityScope } from '@/lib/rbac/require-permission';
import type { AccessibleFacility } from '@/lib/facility/scope';
import type { Role } from '@/types/next-auth';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  // D-01: this page previously called `auth()` and nothing else — no permission
  // check at all. The roster was reachable by anyone who typed the URL, and the
  // sidebar not linking it was doing the work authorization should have done.
  const ctx = await requirePermissionWithFacilityScope('user.read');

  const hasOrganization = !!ctx.organizationId;
  const organizationId = ctx.organizationId ?? undefined;
  const inviterRole: Role = ctx.role ?? DEFAULT_SELF_SERVE_WORKER_ROLE;

  const users = hasOrganization ? await getStaffUsers() : [];

  // Already re-derived per request by the guard, so scope can never go stale.
  const facilities: AccessibleFacility[] = ctx.accessibleFacilities;

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
      // D2: every role except `owner` consumes a plan seat — and only an ACTIVE
      // membership does. This was a hand-rolled copy of `countBillableStaff`
      // that had drifted from it: without `active: true` it kept counting staff
      // who had been removed, so the seat gauge never went down and an org at
      // its cap could not invite anyone again even with room on the roster
      // (staging QA 2026-09-04). `removeStaff` deactivates rather than deletes,
      // precisely so the training record survives.
      countBillableStaff(organizationId),
      prisma.invite.count({
        where: {
          organizationId,
          role: { not: 'owner' },
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
      inviterRole={inviterRole}
      viewerOrganizationUserId={ctx.organizationUserId ?? null}
      facilities={facilities}
    />
  );
}
