import { auth } from '@/auth';
import { isAdminRole } from '@/lib/rbac/role-utils';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { BILLING_PLANS } from '@/lib/billing-plans';
import CancelSubscriptionClient from '@/components/billing/CancelSubscriptionClient';

export const metadata = {
  title: 'Cancel Subscription | Theraptly',
  description: 'Pause or cancel your Theraptly subscription.',
};

export default async function CancelSubscriptionPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const { role, organizationId } = session.user;
  if (!isAdminRole(role)) {
    redirect('/dashboard');
  }

  const organization = organizationId
    ? await prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          subscription: {
            select: {
              plan: true,
              status: true,
              currentPeriodEnd: true,
              cancelAtPeriodEnd: true,
              pausedAt: true,
              pauseEndsAt: true,
            },
          },
        },
      })
    : null;

  const sub = organization?.subscription;

  // Cancelling requires a subscription that Stripe still considers billable
  // (paused subscriptions keep a status of `active`). Already-scheduled
  // cancellations have nothing left to cancel, so send them back to billing.
  if (!sub || (sub.status !== 'active' && sub.status !== 'trialing') || sub.cancelAtPeriodEnd) {
    redirect('/dashboard/billing');
  }

  const planName = BILLING_PLANS.find((p) => p.key === sub.plan)?.name ?? 'Theraptly';

  return (
    <CancelSubscriptionClient
      planName={planName}
      periodEnd={sub.currentPeriodEnd.toISOString()}
      pausedAt={sub.pausedAt ? sub.pausedAt.toISOString() : null}
      pauseEndsAt={sub.pauseEndsAt ? sub.pauseEndsAt.toISOString() : null}
    />
  );
}
