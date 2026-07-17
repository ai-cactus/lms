import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { isAdminRole } from '@/lib/rbac/role-utils';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { guardApiSession } from '@/lib/auth-guard';
import { BILLING_PLANS, BillingCycle } from '@/lib/billing-plans';
import { classifyPlanChange, CYCLE_DURATION } from '@/lib/billing-plan-change';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import type { SubscriptionPlan, SubscriptionBillingCycle } from '@/generated/prisma/enums';

// The five columns that describe a pending scheduled change; cleared together.
const CLEARED_SCHEDULE_FIELDS = {
  scheduledPlan: null,
  scheduledBillingCycle: null,
  scheduledPriceId: null,
  scheduledEffectiveAt: null,
  stripeScheduleId: null,
} as const;

/**
 * True when a Stripe error indicates the immediate proration charge could not
 * be collected (declined card or an otherwise incomplete payment) under
 * `payment_behavior: 'error_if_incomplete'`. Such a change must be rejected with
 * the subscription left untouched.
 */
function isPaymentFailure(err: unknown): boolean {
  if (err instanceof Stripe.errors.StripeCardError) return true;
  if (err instanceof Stripe.errors.StripeInvalidRequestError) {
    return (
      err.code === 'subscription_payment_intent_requires_action' ||
      err.code === 'invoice_payment_intent_requires_action'
    );
  }
  return false;
}

// POST /api/billing/subscription/checkout — creates a Checkout session for a new
// subscription, or swaps the price on an existing live subscription in place.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    // F-012: enforce authentication + MFA step-up + admin role at the data
    // layer, consistent with the shared guard used across billing routes.
    const denied = guardApiSession(session, { role: 'admin' });
    if (denied) return denied;
    // The guard guarantees an authenticated session past this point; narrow the
    // id for the DB lookup (guardApiSession does not narrow the session type).
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const stripe = getStripeClient();

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
      select: {
        id: true,
        status: true,
        stripeSubscriptionId: true,
        plan: true,
        billingCycle: true,
        currentPeriodEnd: true,
        stripeScheduleId: true,
        scheduledPlan: true,
        scheduledBillingCycle: true,
        scheduledEffectiveAt: true,
        updatedAt: true,
      },
    });

    const hasLiveSubscription =
      !!existingSubscription &&
      existingSubscription.status !== 'canceled' &&
      !!existingSubscription.stripeSubscriptionId;

    if (existingSubscription && hasLiveSubscription) {
      const organizationId = user.organizationId;
      // Retrieve the live subscription to find the item whose price we swap.
      const liveSub = await stripe.subscriptions.retrieve(
        existingSubscription.stripeSubscriptionId,
      );
      const currentItem = liveSub.items.data[0];

      if (!currentItem) {
        logger.error({
          msg: '[billing] Live subscription has no line items — cannot swap plan',
          organizationId,
        });
        return NextResponse.json(
          { error: 'Your subscription is in an invalid state. Please contact support.' },
          { status: 409 },
        );
      }

      // Reconcile the schedule id from the live subscription when the local row
      // has not caught up yet (e.g. a schedule created out-of-band).
      const scheduleId =
        existingSubscription.stripeScheduleId ??
        (typeof liveSub.schedule === 'string' ? liveSub.schedule : (liveSub.schedule?.id ?? null));

      const result = classifyPlanChange({
        currentPlanKey: existingSubscription.plan,
        currentCycle: existingSubscription.billingCycle,
        targetPlanKey: plan.key,
        targetCycle: billingCycle,
        currentPeriodEnd: existingSubscription.currentPeriodEnd,
      });

      // ── no_op: target equals the live plan/cycle ────────────────────────────
      if (result.classification === 'no_op') {
        // Re-selecting the live plan while a change was scheduled is a revert:
        // release the schedule and clear the pending columns (decision #5).
        if (scheduleId) {
          await stripe.subscriptionSchedules.release(scheduleId);
          await prisma.subscription.update({
            where: { organizationId },
            data: { ...CLEARED_SCHEDULE_FIELDS },
          });
          logger.info({
            msg: '[billing] Released scheduled plan change (reverted to current plan)',
            organizationId,
            planKey,
            billingCycle,
          });
          await audit({
            action: 'billing.subscription.checkout',
            actorId: session.user.id,
            actorRole: user.role,
            organizationId,
            targetType: 'subscription',
            targetId: existingSubscription.id,
            metadata: { planKey, billingCycle, mode: 'schedule-release' },
            ...getClientContext(request.headers),
          });
          return NextResponse.json({
            updated: true,
            message: 'Your scheduled plan change has been canceled.',
          });
        }
        logger.info({
          msg: '[billing] Plan change requested but already active — no-op',
          organizationId,
          planKey,
          billingCycle,
        });
        return NextResponse.json({ updated: true, message: 'You are already on this plan.' });
      }

      // Target already matches the pending scheduled change — nothing to do.
      if (
        existingSubscription.scheduledPlan === plan.key &&
        existingSubscription.scheduledBillingCycle === billingCycle
      ) {
        logger.info({
          msg: '[billing] Plan change already scheduled — no-op',
          organizationId,
          planKey,
          billingCycle,
        });
        return NextResponse.json({
          scheduled: true,
          effectiveAt: existingSubscription.scheduledEffectiveAt?.toISOString() ?? null,
          message: 'This plan change is already scheduled.',
        });
      }

      // ── scheduled: defer the change to the current period end, no charge ─────
      if (result.classification === 'scheduled') {
        // Update an existing schedule's future phase in place, or create one
        // wrapping the live subscription (THER-001: schedules never open a
        // second subscription). Either way we end up with a two-phase schedule
        // whose phase 2 carries the new price and releases afterwards.
        const schedule = scheduleId
          ? await stripe.subscriptionSchedules.retrieve(scheduleId)
          : await stripe.subscriptionSchedules.create({
              from_subscription: existingSubscription.stripeSubscriptionId,
            });

        const phase0 = schedule.phases[0];
        if (!phase0 || !phase0.items[0]) {
          logger.error({
            msg: '[billing] Subscription schedule has no active phase — cannot schedule change',
            organizationId,
            scheduleId: schedule.id,
          });
          return NextResponse.json(
            { error: 'Your subscription is in an invalid state. Please contact support.' },
            { status: 409 },
          );
        }
        const phase0PriceId =
          typeof phase0.items[0].price === 'string'
            ? phase0.items[0].price
            : phase0.items[0].price.id;

        const duration = CYCLE_DURATION[billingCycle];
        const updatedSchedule = await stripe.subscriptionSchedules.update(schedule.id, {
          end_behavior: 'release',
          phases: [
            {
              items: [{ price: phase0PriceId }],
              start_date: phase0.start_date,
              end_date: phase0.end_date,
            },
            {
              items: [{ price: priceId }],
              duration: { interval: duration.interval, interval_count: duration.intervalCount },
              proration_behavior: 'none',
              metadata: { organizationId, planKey, billingCycle },
            },
          ],
        });

        // Local write touches ONLY the scheduled* columns — plan/billingCycle/
        // stripePriceId keep representing what is LIVE NOW until the schedule
        // transitions and the webhook reconciles them.
        await prisma.subscription.update({
          where: { organizationId },
          data: {
            scheduledPlan: plan.key as SubscriptionPlan,
            scheduledBillingCycle: billingCycle as SubscriptionBillingCycle,
            scheduledPriceId: priceId,
            scheduledEffectiveAt: existingSubscription.currentPeriodEnd,
            stripeScheduleId: updatedSchedule.id,
          },
        });

        const effectiveAt = existingSubscription.currentPeriodEnd.toISOString();
        logger.info({
          msg: '[billing] Scheduled plan change at period end',
          organizationId,
          planKey,
          billingCycle,
          effectiveAt,
        });
        await audit({
          action: 'billing.subscription.checkout',
          actorId: session.user.id,
          actorRole: user.role,
          organizationId,
          targetType: 'subscription',
          targetId: existingSubscription.id,
          metadata: { planKey, billingCycle, mode: 'schedule', effectiveAt },
          ...getClientContext(request.headers),
        });

        return NextResponse.json({
          scheduled: true,
          effectiveAt,
          message: 'Your plan change is scheduled for the end of your current billing period.',
        });
      }

      // ── immediate_prorate: charge the prorated difference now ────────────────
      // A pending schedule must be released first so the immediate swap prorates
      // against the still-active plan (decision #6).
      if (scheduleId) {
        await stripe.subscriptionSchedules.release(scheduleId);
        await prisma.subscription.update({
          where: { organizationId },
          data: { ...CLEARED_SCHEDULE_FIELDS },
        });
      }

      // Swap the price in place. `always_invoice` bills the prorated difference
      // immediately; `error_if_incomplete` makes a declined card fail loudly
      // (rather than leaving an incomplete subscription) so we can reject the
      // change and leave the subscription untouched. NOTHING is written locally
      // before this call succeeds.
      try {
        await stripe.subscriptions.update(
          existingSubscription.stripeSubscriptionId,
          {
            items: [{ id: currentItem.id, price: priceId }],
            proration_behavior: 'always_invoice',
            payment_behavior: 'error_if_incomplete',
            cancel_at_period_end: false,
            metadata: { organizationId, planKey, billingCycle },
          },
          {
            idempotencyKey: `${organizationId}:${planKey}:${billingCycle}:${existingSubscription.updatedAt.getTime()}`,
          },
        );
      } catch (err) {
        if (isPaymentFailure(err)) {
          logger.warn({
            msg: '[billing] Immediate plan-change charge failed — subscription untouched',
            organizationId,
            planKey,
            billingCycle,
          });
          return NextResponse.json(
            {
              error:
                'Your card was declined, so your plan was not changed. Please update your payment method and try again.',
            },
            { status: 402 },
          );
        }
        throw err;
      }

      // Charge succeeded — reflect the new live plan and clear any pending change.
      await prisma.subscription.update({
        where: { organizationId },
        data: {
          plan: plan.key as SubscriptionPlan,
          billingCycle: billingCycle as SubscriptionBillingCycle,
          stripePriceId: priceId,
          cancelAtPeriodEnd: false,
          ...CLEARED_SCHEDULE_FIELDS,
        },
      });

      logger.info({
        msg: '[billing] Swapped subscription plan in place (immediate proration)',
        organizationId,
        planKey,
        billingCycle,
      });
      await audit({
        action: 'billing.subscription.checkout',
        actorId: session.user.id,
        actorRole: user.role,
        organizationId,
        targetType: 'subscription',
        targetId: existingSubscription.id,
        metadata: { planKey, billingCycle, mode: 'immediate-prorate' },
        ...getClientContext(request.headers),
      });

      return NextResponse.json({
        updated: true,
        message: 'Your plan has been updated and the prorated balance was charged.',
      });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Let org admins redeem dashboard-created promotion codes on Stripe's
      // hosted page. Mutually exclusive with the `discounts` param (not used).
      allow_promotion_codes: true,
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

    // F-001: record the sensitive billing action (new subscription checkout).
    await audit({
      action: 'billing.subscription.checkout',
      actorId: session.user.id,
      actorRole: user.role,
      organizationId: user.organizationId,
      targetType: 'subscription',
      metadata: { planKey, billingCycle, mode: 'checkout' },
      ...getClientContext(request.headers),
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/subscription/checkout]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
