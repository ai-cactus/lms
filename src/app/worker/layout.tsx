import React from 'react';
import { auth } from '@/auth.worker';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import WorkerDashboardLayout from '@/components/worker/WorkerDashboardLayout';
import WorkerBillingBlockedScreen from '@/components/worker/WorkerBillingBlockedScreen';
import { WorkerSessionProvider } from '@/components/providers/WorkerSessionProvider';
import { hasActiveBilling } from '@/lib/billing';
import { logger, maskEmail } from '@/lib/logger';

export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user?.email) {
    redirect('/login');
  }

  // Fetch profile for full name
  const profile = await prisma.profile.findUnique({
    where: { id: session.user.id },
    select: { fullName: true },
  });

  // Fetch fresh user data + the org's subscription so we can gate on billing.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      organizationId: true,
      role: true,
      organization: { select: { subscription: { select: { status: true, pausedAt: true } } } },
    },
  });

  const fullName = profile?.fullName || session.user.name || session.user.email || 'User';
  const role = user?.role || session.user.role;
  logger.info({
    msg: '[WorkerLayout] Rendering for user:',
    data: { email: maskEmail(session.user.email), role },
  });
  const organizationId = user?.organizationId;

  if (!organizationId) {
    redirect('/onboarding-worker');
  }

  // Billing gate (TC-041-B): workers must not reach the portal while the org's
  // billing is paused/inactive. Mirrors the assignment gate's exact semantics
  // (hasActiveBilling treats a missing subscription row as inactive). Rendered
  // in place — never redirected — to avoid a loop with the login guard.
  if (!hasActiveBilling(user?.organization?.subscription)) {
    logger.warn({
      msg: '[WorkerLayout] Portal blocked — organization lacks active billing',
      organizationId,
      userId: session.user.id,
    });
    return <WorkerBillingBlockedScreen />;
  }

  return (
    <WorkerSessionProvider>
      <WorkerDashboardLayout fullName={fullName} role={role ?? undefined}>
        {children}
      </WorkerDashboardLayout>
    </WorkerSessionProvider>
  );
}
