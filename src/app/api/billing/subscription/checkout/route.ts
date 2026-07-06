import { NextRequest, NextResponse } from 'next/server';
import { isAdminRole } from '@/lib/rbac/role-utils';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import stripe from '@/lib/stripe';
import { BILLING_PLANS, BillingCycle } from '@/lib/billing-plans';
import { logger } from '@/lib/logger';
import type { SubscriptionPlan, SubscriptionBillingCycle } from '@/generated/prisma/enums';

// POST /api/billing/subscription/checkout — creates a Checkout session for a new
// subscription, or swaps the price on an existing live subscription in place.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, organizationId: true },
    });

    if (!user || !isAdminRole(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!user.organizationId) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 });
    }

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

    const organization = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: {
        name: true,
        primaryEmail: true,
        stripeCustomerId: true,
        facilities: { select: { staffCount: true }, take: 1 },
      },
    });

    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Enforce plan restriction: orgs with more staff cannot downgrade
    const orgStaffNum = parseInt(organization.facilities[0]?.staffCount ?? '0', 10);
    if (plan.staffMax !== null && orgStaffNum > plan.staffMax) {
      return NextResponse.json(
        { error: 'Your organization has too many staff members for this plan.' },
        { status: 422 },
      );
    }

    let customerId = organization.stripeCustomerId ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: organization.name,
        email: organization.primaryEmail ?? undefined,
        metadata: { organizationId: user.organizationId },
      });
      customerId = customer.id;
      await prisma.organization.update({
        where: { id: user.organizationId },
        data: { stripeCustomerId: customerId },
      });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

    // ── THER-001: never create a second live subscription ──────────────────────
    // If this org already has a non-canceled Stripe subscription, a plan change
    // must SWAP the price on that subscription rather than opening a new Checkout
    // session (which would create a duplicate live subscription — both then fight
    // over the single subscription row, see THER-010). We only fall through to
    // Checkout when there is no live subscription to modify.
    const existingSubscription = await prisma.subscription.findUnique({
      where: { organizationId: user.organizationId },
    });

    const hasLiveSubscription =
      !!existingSubscription &&
      existingSubscription.status !== 'canceled' &&
      !!existingSubscription.stripeSubscriptionId;

    if (existingSubscription && hasLiveSubscription) {
      // Retrieve the live subscription to find the item whose price we swap.
      const liveSub = await stripe.subscriptions.retrieve(
        existingSubscription.stripeSubscriptionId,
      );
      const currentItem = liveSub.items.data[0];

      if (!currentItem) {
        logger.error({
          msg: '[billing] Live subscription has no line items — cannot swap plan',
          organizationId: user.organizationId,
        });
        return NextResponse.json(
          { error: 'Your subscription is in an invalid state. Please contact support.' },
          { status: 409 },
        );
      }

      // Idempotency: already on the requested price and not scheduled to cancel.
      if (currentItem.price.id === priceId && !liveSub.cancel_at_period_end) {
        logger.info({
          msg: '[billing] Plan change requested but already active — no-op',
          organizationId: user.organizationId,
          planKey,
          billingCycle,
        });
        return NextResponse.json({ updated: true, message: 'You are already on this plan.' });
      }

      // Swap the price in place. `create_prorations` bills/credits the difference
      // immediately. `cancel_at_period_end: false` re-commits a subscription that
      // was scheduled to cancel, since the admin is actively choosing a plan.
      // Metadata is refreshed so the `customer.subscription.updated` webhook
      // reconciles the row to the correct plan/cycle.
      await stripe.subscriptions.update(existingSubscription.stripeSubscriptionId, {
        items: [{ id: currentItem.id, price: priceId }],
        proration_behavior: 'create_prorations',
        cancel_at_period_end: false,
        metadata: {
          organizationId: user.organizationId,
          planKey,
          billingCycle,
        },
      });

      // Update the local row immediately (mirrors the cancel/pause/resume routes)
      // so the UI reflects the new plan without waiting on the webhook; the
      // webhook upsert later reconciles the same values idempotently.
      await prisma.subscription.update({
        where: { organizationId: user.organizationId },
        data: {
          plan: planKey as SubscriptionPlan,
          billingCycle: billingCycle as SubscriptionBillingCycle,
          stripePriceId: priceId,
          cancelAtPeriodEnd: false,
        },
      });

      logger.info({
        msg: '[billing] Swapped subscription plan in place',
        organizationId: user.organizationId,
        planKey,
        billingCycle,
      });

      return NextResponse.json({ updated: true, message: 'Your plan has been updated.' });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/dashboard/billing?tab=overview&checkout=success`,
      cancel_url: `${appUrl}/dashboard/billing?tab=subscription`,
      metadata: {
        organizationId: user.organizationId,
        planKey,
        billingCycle,
      },
      subscription_data: {
        metadata: {
          organizationId: user.organizationId,
          planKey,
          billingCycle,
        },
      },
    });

    logger.info({
      msg: '[billing] Created Checkout session for new subscription',
      organizationId: user.organizationId,
      planKey,
      billingCycle,
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/subscription/checkout]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
