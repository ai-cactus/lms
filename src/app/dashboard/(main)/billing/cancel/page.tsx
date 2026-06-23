import { auth } from '@/auth';
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

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      organization: {
        select: {
          subscription: {
            select: {
              plan: true,
              status: true,
              currentPeriodEnd: true,
              pausedAt: true,
              pauseEndsAt: true,
            },
          },
        },
      },
    },
  });

  if (!user || user.role !== 'admin') {
    redirect('/dashboard');
  }

  const sub = user.organization?.subscription;

  // Cancelling requires a subscription that Stripe still considers billable
  // (paused subscriptions keep a status of `active`).
  if (!sub || (sub.status !== 'active' && sub.status !== 'trialing')) {
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
