import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { auth } from '@/auth';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import BillingPage from '@/components/billing/BillingPage';
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

  // Fetch org staff count + active subscription plan for the UI
  const organization = user.organizationId
    ? await prisma.organization.findUnique({
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
            },
          },
        },
      })
    : null;

  const sub = organization?.subscription;
  const staffCount = organization?.facilities[0]?.staffCount ?? null;

  // Expose the plan key only when the subscription is in a billable state.
  // A paused subscription keeps a Stripe status of `active`, so it still counts
  // as having a plan — the paused state is conveyed separately below.
  const activePlan =
    sub?.status === 'active' || sub?.status === 'trialing'
      ? sub.plan // 'starter' | 'professional' | 'enterprise'
      : null;

  return (
    <BillingPage
      staffCount={staffCount}
      currentPlan={activePlan}
      pausedAt={sub?.pausedAt ? sub.pausedAt.toISOString() : null}
      pauseEndsAt={sub?.pauseEndsAt ? sub.pauseEndsAt.toISOString() : null}
      cancelAtPeriodEnd={sub?.cancelAtPeriodEnd ?? false}
      billingCycle={sub?.billingCycle ?? null}
      currentPeriodEnd={sub?.currentPeriodEnd?.toISOString() ?? null}
    />
  );
}
