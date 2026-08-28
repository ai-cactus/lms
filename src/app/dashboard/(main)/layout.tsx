import React, { FC } from 'react';
import { isAdminRole, dbRoleToRoleKey, getRoleDisplayName } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import type { Role } from '@/types/next-auth';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import DashboardLayoutClient from '@/components/dashboard/DashboardLayoutClient';
import OrganizationActivationModal from '@/components/dashboard/OrganizationActivationModal';
import { AdminSessionProvider } from '@/components/providers/AdminSessionProvider';
import { ExportJobsProvider } from '@/components/dashboard/auditor/ExportJobsProvider';
import BillingPausedBanner from '@/components/billing/BillingPausedBanner';
import StatusTrackerAlertBanner from '@/components/dashboard/StatusTrackerAlertBanner';
import { getPauseState } from '@/lib/billing';
import { getStatusTrackerSummaryForOrg } from '@/lib/reminders/status-tracker';
import { resolveMembershipForActiveSession } from '@/lib/auth/membership';
import { isOrgWideFacilityRole } from '@/lib/facility/scope';
import { resolveMemberFacilityId } from '@/lib/facility/member-facility';
import { resolveDataFacilityIds } from '@/lib/facility/staff-where';
import { WithChildren } from '@/types/react';

const DashboardLayout: FC<WithChildren> = async ({ children }) => {
  const session = await auth();

  if (!session?.user?.email) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { fullName: true },
  });

  // Resolve the membership this session is scoped to. When the JWT already names
  // an org, that org is authoritative (point lookup) — never re-derived via the
  // global resolver, which consults User.lastActiveOrganizationId and could bleed
  // a multi-org user's view into a sibling session's org. Only a genuinely
  // org-less session (just finished onboarding) falls back to the global pick.
  const membership = await resolveMembershipForActiveSession(
    session.user.id,
    session.user.organizationId,
  );
  const role = membership?.role ?? session.user.role;
  const organizationId = membership?.organizationId;

  const fullName = user?.fullName || session.user.name || session.user.email || 'User';
  const roleDisplayName = role ? getRoleDisplayName(role as Role) : undefined;

  // Only facility-bound roles (supervisor + workers) have one site to name in the
  // top bar — an org-wide role spans every facility, so naming one would mislead.
  // Facility stays out of the JWT by design (see lib/facility/scope), so it is
  // re-derived here and passed down as a prop.
  const memberFacilityId =
    membership && role && !isOrgWideFacilityRole(role as Role)
      ? await resolveMemberFacilityId(prisma, membership.organizationUserId)
      : null;
  const facilityName = memberFacilityId
    ? ((
        await prisma.facility.findUnique({
          where: { id: memberFacilityId },
          select: { name: true },
        })
      )?.name ?? null)
    : null;

  // Surface a site-wide banner to admins while billing is paused.
  const subscription = organizationId
    ? (
        await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { subscription: { select: { pausedAt: true, pauseEndsAt: true } } },
        })
      )?.subscription
    : null;
  const pauseState = isAdminRole(role) ? getPauseState(subscription) : 'none';

  // Surface a site-wide status-tracker banner when training is overdue by the
  // hard-escalation threshold. Gated on roster-wide assignment visibility so
  // finance (an admin-tier role) never sees worker-training metrics; only queried
  // for eligible roles so other loads are unaffected.
  const canSeeStatusTracker = can(dbRoleToRoleKey(role as Role), 'assignment.read');
  // Scoped like every other roster read: a facility-bound role must not be given
  // an organisation-wide count either. `resolveDataFacilityIds` returns null —
  // meaning no facility predicate — only for org-wide roles.
  const bannerFacilityIds =
    canSeeStatusTracker && organizationId && role
      ? await resolveDataFacilityIds({
          user: {
            id: session.user.id,
            role: role as Role,
            organizationId,
            organizationUserId: membership?.organizationUserId ?? null,
          },
        })
      : null;
  const hardEscalationCount =
    canSeeStatusTracker && organizationId
      ? (
          await getStatusTrackerSummaryForOrg(
            organizationId,
            undefined,
            bannerFacilityIds ?? undefined,
          )
        ).hardEscalationCount
      : 0;

  return (
    <AdminSessionProvider currentUserId={session.user.id} currentUserName={fullName}>
      <OrganizationActivationModal hasOrganization={!!organizationId} />
      <ExportJobsProvider>
        {/* Full-viewport shell: the two dashboard layouts own their own scroll
            container, so the page frame itself never scrolls. */}
        <div className="h-screen w-full overflow-hidden">
          <DashboardLayoutClient
            fullName={fullName}
            role={role || undefined}
            organizationName={membership?.organizationName}
            roleDisplayName={roleDisplayName}
            facilityName={facilityName}
          >
            {pauseState !== 'none' && (
              <BillingPausedBanner
                pauseState={pauseState}
                pauseEndsAt={
                  subscription?.pauseEndsAt ? subscription.pauseEndsAt.toISOString() : null
                }
              />
            )}
            {canSeeStatusTracker && (
              <StatusTrackerAlertBanner hardEscalationCount={hardEscalationCount} />
            )}
            {children}
          </DashboardLayoutClient>
        </div>
      </ExportJobsProvider>
    </AdminSessionProvider>
  );
};

export default DashboardLayout;
