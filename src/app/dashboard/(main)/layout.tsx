import React from 'react';
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

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user?.email) {
    redirect('/login');
  }

  // Fetch profile role. Note: We use findUnique on email since we added @unique to Profile.email
  // Or we use id if we set user.id in session (which we did in auth.ts callbacks)
  const profile = await prisma.profile.findUnique({
    where: { id: session.user.id },
    select: { fullName: true },
  });

  // Fetch fresh user data from DB to get current organizationId (session may be stale after onboarding)
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      organizationId: true,
      role: true,
      organization: {
        select: { subscription: { select: { pausedAt: true, pauseEndsAt: true } } },
      },
    },
  });

  const fullName = profile?.fullName || session.user.name || session.user.email || 'User';
  // User role should be in session or fetched from User model if needed.
  // For now we rely on session.
  // User role should be in session or fetched from User model if needed.
  // For now we rely on session.
  const role = user?.role || session.user.role;
  const organizationId = user?.organizationId; // Fetch from DB for freshest data

  // Surface a site-wide banner to admins while billing is paused.
  const subscription = user?.organization?.subscription;
  const pauseState = role === 'admin' ? getPauseState(subscription) : 'none';

  // Surface a site-wide status-tracker banner to admins when training is overdue
  // by the hard-escalation threshold. Only queried for admins so non-admin loads
  // are unaffected.
  const hardEscalationCount =
    role === 'admin' && organizationId
      ? (await getStatusTrackerSummaryForOrg(organizationId)).hardEscalationCount
      : 0;

  return (
    <AdminSessionProvider>
      <OrganizationActivationModal hasOrganization={!!organizationId} />
      <ExportJobsProvider>
        <DashboardLayoutClient
          userEmail={session.user.email || ''}
          fullName={fullName}
          role={role || undefined}
        >
          {pauseState !== 'none' && (
            <BillingPausedBanner
              pauseState={pauseState}
              pauseEndsAt={
                subscription?.pauseEndsAt ? subscription.pauseEndsAt.toISOString() : null
              }
            />
          )}
          {role === 'admin' && (
            <StatusTrackerAlertBanner hardEscalationCount={hardEscalationCount} />
          )}
          {children}
        </DashboardLayoutClient>
      </ExportJobsProvider>
    </AdminSessionProvider>
  );
}
