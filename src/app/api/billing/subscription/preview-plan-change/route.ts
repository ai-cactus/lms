import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/rbac/authorize';
import { apiError } from '@/lib/api-response';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { guardApiSession } from '@/lib/auth-guard';
import { BILLING_PLANS, BillingCycle } from '@/lib/billing-plans';
import { classifyPlanChange } from '@/lib/billing-plan-change';
import { logger } from '@/lib/logger';

// POST /api/billing/subscription/preview-plan-change — read-only. Classifies a
// prospective plan/cycle change and, for an immediate proration, previews the
// amount Stripe would charge now. Performs NO Stripe write and NO audit
// mutation, so it is safe to call on every plan-card click.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    // F-012: enforce authentication + MFA step-up at the data layer. RBAC (the
    // billing permission) is enforced by authorize() below against the registry.
    const denied = guardApiSession(session);
    if (denied) return denied;

    const authResult = await authorize('billing.read');
    if (!authResult.ok) return authResult.response;
    const { ctx } = authResult;

    if (!ctx.organizationId) {
      return apiError('No organization found', 404);
    }
    const organizationId = ctx.organizationId;

    const stripe = getStripeClient();

    const body = (await request.json()) as { planKey: string; billingCycle: BillingCycle };
    const { planKey, billingCycle } = body;

    if (!planKey || !billingCycle) {
      return NextResponse.json({ error: 'Missing planKey or billingCycle' }, { status: 400 });
    }

    const plan = BILLING_PLANS.find((p) => p.key === planKey);
    if (!plan || plan.isEnterprise) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    const priceId = plan.priceId[billingCycle];
    if (!priceId) {
      return NextResponse.json(
        { error: `No price configured for ${planKey} / ${billingCycle}` },
        { status: 422 },
      );
    }

    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
      select: {
        status: true,
        stripeSubscriptionId: true,
        plan: true,
        billingCycle: true,
        currentPeriodEnd: true,
      },
    });

    const hasLiveSubscription =
      !!subscription && subscription.status !== 'canceled' && !!subscription.stripeSubscriptionId;

    if (!subscription || !hasLiveSubscription) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }

    const result = classifyPlanChange({
      currentPlanKey: subscription.plan,
      currentCycle: subscription.billingCycle,
      targetPlanKey: plan.key,
      targetCycle: billingCycle,
      currentPeriodEnd: subscription.currentPeriodEnd,
    });

    if (result.classification === 'scheduled') {
      return NextResponse.json({
        classification: result.classification,
        effectiveAt: subscription.currentPeriodEnd.toISOString(),
      });
    }

    if (result.classification === 'immediate_prorate') {
      const liveSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
      const currentItem = liveSub.items.data[0];
      if (!currentItem) {
        return NextResponse.json(
          { error: 'Your subscription is in an invalid state. Please contact support.' },
          { status: 409 },
        );
      }

      const preview = await stripe.invoices.createPreview({
        subscription: subscription.stripeSubscriptionId,
        subscription_details: {
          items: [{ id: currentItem.id, price: priceId }],
          proration_behavior: 'always_invoice',
        },
      });

      return NextResponse.json({
        classification: result.classification,
        amountDueCents: preview.amount_due,
        currency: preview.currency,
      });
    }

    return NextResponse.json({ classification: result.classification });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/subscription/preview-plan-change]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
