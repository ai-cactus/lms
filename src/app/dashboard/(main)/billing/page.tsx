import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
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
            select: { plan: true, status: true },
          },
        },
      })
    : null;

  // Expose the plan key only when the subscription is in a billable state
  const activePlan =
    organization?.subscription?.status === 'active' ||
    organization?.subscription?.status === 'trialing'
      ? organization.subscription.plan // 'starter' | 'professional' | 'enterprise'
      : null;

  return <BillingPage staffCount={organization?.staffCount ?? null} currentPlan={activePlan} />;
}
