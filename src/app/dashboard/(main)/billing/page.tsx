import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import BillingPage from '@/components/billing/BillingPage';

export const metadata = {
  title: 'Billing & Subscription | Theraptly',
  description: 'Manage your subscription plan, billing history, and payment methods.',
};

export default async function BillingPageRoute() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  // Server-side admin gate — redirect non-admins to dashboard
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, organizationId: true },
  });

  if (!user || user.role !== 'admin') {
    redirect('/dashboard');
  }

  // Fetch org staff count + active subscription plan for the UI
  const organization = user.organizationId
    ? await prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: {
          staffCount: true,
          subscription: {
            select: {
              plan: true,
              status: true,
              pausedAt: true,
              pauseEndsAt: true,
              cancelAtPeriodEnd: true,
              billingCycle: true,
              currentPeriodEnd: true,
            },
          },
        },
      })
    : null;

  const sub = organization?.subscription;

  // Expose the plan key only when the subscription is in a billable state.
  // A paused subscription keeps a Stripe status of `active`, so it still counts
  // as having a plan — the paused state is conveyed separately below.
  const activePlan =
    sub?.status === 'active' || sub?.status === 'trialing'
      ? sub.plan // 'starter' | 'professional' | 'enterprise'
      : null;

  return (
    <BillingPage
      staffCount={organization?.staffCount ?? null}
      currentPlan={activePlan}
      pausedAt={sub?.pausedAt ? sub.pausedAt.toISOString() : null}
      pauseEndsAt={sub?.pauseEndsAt ? sub.pauseEndsAt.toISOString() : null}
      cancelAtPeriodEnd={sub?.cancelAtPeriodEnd ?? false}
      billingCycle={sub?.billingCycle ?? null}
      currentPeriodEnd={sub?.currentPeriodEnd?.toISOString() ?? null}
    />
  );
}
