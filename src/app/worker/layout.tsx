import React from 'react';
import { auth } from '@/auth.worker';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import WorkerDashboardLayout from '@/components/worker/WorkerDashboardLayout';
import WorkerBillingBlockedScreen from '@/components/worker/WorkerBillingBlockedScreen';
import { WorkerSessionProvider } from '@/components/providers/WorkerSessionProvider';
import { hasActiveBilling } from '@/lib/billing';
import { logger, maskEmail } from '@/lib/logger';
import { resolveMembershipForActiveSession } from '@/lib/auth/membership';

export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
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
  // global resolver (which consults User.lastActiveOrganizationId). Only a
  // genuinely org-less session (just finished join-by-code) falls back to the
  // global pick.
  const membership = await resolveMembershipForActiveSession(
    session.user.id,
    session.user.organizationId,
  );
  const role = membership?.role ?? session.user.role;

  const fullName = user?.fullName || session.user.name || session.user.email || 'User';
  logger.info({
    msg: '[WorkerLayout] Rendering for user:',
    data: { email: maskEmail(session.user.email), role },
  });
  const organizationId = membership?.organizationId;

  if (!organizationId) {
    redirect('/onboarding-worker');
  }

  // Fetch the org's subscription so we can gate on billing.
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { subscription: { select: { status: true, pausedAt: true } } },
  });

  // Billing gate (TC-041-B): workers must not reach the portal while the org's
  // billing is paused/inactive. Mirrors the assignment gate's exact semantics
  // (hasActiveBilling treats a missing subscription row as inactive). Rendered
  // in place — never redirected — to avoid a loop with the login guard.
  if (!hasActiveBilling(organization?.subscription)) {
    logger.warn({
      msg: '[WorkerLayout] Portal blocked — organization lacks active billing',
      organizationId,
      userId: session.user.id,
    });
    return <WorkerBillingBlockedScreen />;
  }

  return (
    <WorkerSessionProvider currentUserId={session.user.id} currentUserName={fullName}>
      <WorkerDashboardLayout fullName={fullName} role={role ?? undefined}>
        {children}
      </WorkerDashboardLayout>
    </WorkerSessionProvider>
  );
}
