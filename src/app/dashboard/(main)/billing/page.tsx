import { requirePermission } from '@/lib/rbac/require-permission';
import prisma from '@/lib/prisma';
import BillingPage from '@/components/billing/BillingPage';
import { countBillableStaff } from '@/lib/seat-limits';
import { BILLING_PLANS } from '@/lib/billing-plans';
import { getPlanPrices } from '@/lib/billing-prices';

export const metadata = {
  title: 'Billing & Subscription | Theraptly',
  description: 'Manage your subscription plan, billing history, and payment methods.',
};

export default async function BillingPageRoute() {
  // Billing is reserved for roles holding `billing.read` (owner, finance).
  //
  // Q26: this used to render an in-page access-denied card naming the module.
  // An unauthorised module is hidden from the nav AND answers a typed URL with
  // "Page not found", so a role with no billing remit never learns it exists.
  const { organizationId } = await requirePermission('billing.read', { onDeny: 'notFound' });

  // Fetch org staff count + active subscription plan for the UI, plus live
  // Stripe plan prices — independent reads, so run them concurrently.
  const [organization, planPrices, orgStaffCount] = await Promise.all([
    organizationId
      ? prisma.organization.findUnique({
          where: { id: organizationId },
          select: {
            subscription: {
              select: {
                plan: true,
                status: true,
                pauseStartsAt: true,
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
    // Org-wide headcount from real membership rows — never a facility's
    // self-declared string, which under-counts multi-facility orgs (P3-001).
    // Must match the checkout route exactly, or the picker offers a plan the
    // server then refuses.
    organizationId ? countBillableStaff(organizationId) : 0,
  ]);

  const sub = organization?.subscription;

  // Expose the plan key only when the subscription is in a billable state.
  // A paused subscription keeps a Stripe status of `active`, so it still counts
  // as having a plan — the paused state is conveyed separately below.
  const activePlan =
    sub?.status === 'active' || sub?.status === 'trialing'
      ? sub.plan // 'starter' | 'growth' | 'pro' | 'enterprise'
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
      orgStaffCount={orgStaffCount}
      currentPlan={activePlan}
      planPrices={planPrices}
      hasLiveSubscription={hasLiveSubscription}
      pauseStartsAt={sub?.pauseStartsAt ? sub.pauseStartsAt.toISOString() : null}
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
