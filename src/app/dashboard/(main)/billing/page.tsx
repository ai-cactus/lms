import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { auth } from '@/auth';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import BillingPage from '@/components/billing/BillingPage';
import { BILLING_PLANS } from '@/lib/billing-plans';
import { getPlanPrices } from '@/lib/billing-prices';
import type { Role } from '@/types/next-auth';

export const metadata = {
  title: 'Billing & Subscription | Theraptly',
  description: 'Manage your subscription plan, billing history, and payment methods.',
};

export default async function BillingPageRoute() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, organizationId: true },
  });

  if (!user) {
    redirect('/login');
  }

  // Billing is reserved for roles holding `billing.read` (owner, finance).
  // Other admins (e.g. supervisor) reaching this URL get a proper access-denied
  // state instead of the raw "Forbidden" the billing APIs would otherwise return.
  if (!can(dbRoleToRoleKey(user.role as Role), 'billing.read')) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-error/10 text-error">
          <ShieldAlert className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-foreground">
          You don&apos;t have access to Billing
        </h1>
        <p className="mt-2 max-w-md text-sm text-text-secondary">
          Billing and subscription management is limited to your organization&apos;s owner and
          finance roles.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  // Fetch org staff count + active subscription plan for the UI, plus live
  // Stripe plan prices — independent reads, so run them concurrently.
  const [organization, planPrices] = await Promise.all([
    user.organizationId
      ? prisma.organization.findUnique({
          where: { id: user.organizationId },
          select: {
            facilities: { select: { staffCount: true }, take: 1 },
            subscription: {
              select: {
                plan: true,
                status: true,
                pausedAt: true,
                pauseEndsAt: true,
                cancelAtPeriodEnd: true,
                billingCycle: true,
                currentPeriodEnd: true,
                stripeSubscriptionId: true,
                scheduledPlan: true,
                scheduledEffectiveAt: true,
              },
            },
          },
        })
      : null,
    getPlanPrices(),
  ]);

  const sub = organization?.subscription;
  const staffCount = organization?.facilities[0]?.staffCount ?? null;

  // Expose the plan key only when the subscription is in a billable state.
  // A paused subscription keeps a Stripe status of `active`, so it still counts
  // as having a plan — the paused state is conveyed separately below.
  const activePlan =
    sub?.status === 'active' || sub?.status === 'trialing'
      ? sub.plan // 'starter' | 'professional' | 'enterprise'
      : null;

  // Whether the org has a live Stripe subscription that a plan change would swap
  // in place (rather than opening a fresh Checkout). Mirrors the checkout route's
  // `hasLiveSubscription` so the UI can warn before an immediate in-place swap.
  const hasLiveSubscription = !!sub && sub.status !== 'canceled' && !!sub.stripeSubscriptionId;

  // Resolve the pending scheduled change (if any) for the banner. Only surfaced
  // when both the target plan and its effective date are known.
  const scheduledPlanName =
    sub?.scheduledPlan && sub.scheduledEffectiveAt
      ? (BILLING_PLANS.find((p) => p.key === sub.scheduledPlan)?.name ?? null)
      : null;

  return (
    <BillingPage
      staffCount={staffCount}
      currentPlan={activePlan}
      planPrices={planPrices}
      hasLiveSubscription={hasLiveSubscription}
      pausedAt={sub?.pausedAt ? sub.pausedAt.toISOString() : null}
      pauseEndsAt={sub?.pauseEndsAt ? sub.pauseEndsAt.toISOString() : null}
      cancelAtPeriodEnd={sub?.cancelAtPeriodEnd ?? false}
      billingCycle={sub?.billingCycle ?? null}
      currentPeriodEnd={sub?.currentPeriodEnd?.toISOString() ?? null}
      scheduledPlanName={scheduledPlanName}
      scheduledEffectiveAt={sub?.scheduledEffectiveAt?.toISOString() ?? null}
    />
  );
}
