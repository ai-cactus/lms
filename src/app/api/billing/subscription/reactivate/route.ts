import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { guardApiSession } from '@/lib/auth-guard';
import { authorize } from '@/lib/rbac/authorize';
import { apiError } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import { headers } from 'next/headers';
import { releasePendingSchedule } from '@/lib/billing-schedule';

// POST /api/billing/subscription/reactivate — clears a scheduled cancellation
// (the "Resume subscription" action). Reverses a soft cancel by turning off
// `cancel_at_period_end` while the subscription is still billable. A pending
// plan-change schedule is released first rather than blocking the request:
// Stripe refuses cancellation-behaviour updates while a schedule wraps the
// subscription.
export async function POST() {
  try {
    const session = await auth();
    // F-012: enforce authentication + MFA step-up at the data layer. RBAC (the
    // billing permission) is enforced by authorize() below against the registry.
    const denied = guardApiSession(session);
    if (denied) return denied;

    const authResult = await authorize('billing.edit');
    if (!authResult.ok) return authResult.response;
    const { ctx } = authResult;

    if (!ctx.organizationId) {
      return apiError('No organization found', 404);
    }
    const organizationId = ctx.organizationId;

    const stripe = getStripeClient();

    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }

    if (!subscription.cancelAtPeriodEnd) {
      return NextResponse.json(
        { error: 'Subscription is not scheduled for cancellation.' },
        { status: 409 },
      );
    }

    // Only a subscription Stripe still considers billable can clear its
    // scheduled cancellation; a fully-canceled sub must resubscribe instead.
    if (subscription.status !== 'active' && subscription.status !== 'trialing') {
      return NextResponse.json(
        { error: 'Subscription can no longer be reactivated.' },
        { status: 409 },
      );
    }

    // Released only once every other precondition has passed, so a rejected
    // request never tears down a schedule the customer still has.
    let releasedSchedule = false;
    if (subscription.stripeScheduleId) {
      try {
        ({ released: releasedSchedule } = await releasePendingSchedule(
          organizationId,
          subscription.stripeScheduleId,
        ));
      } catch (err) {
        logger.error({
          msg: '[billing] Failed to auto-release pending schedule',
          err,
          organizationId,
        });
        return NextResponse.json(
          {
            error:
              'Unable to update your subscription right now. Please try again in a moment or contact support.',
          },
          { status: 502 },
        );
      }
    }

    // Clearing `cancel_at_period_end` tells Stripe to keep the subscription
    // renewing. A cancel-scheduled sub never lost access, so there is no
    // auditor-access restore to perform (unlike resume).
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await prisma.subscription.update({
      where: { organizationId },
      data: { cancelAtPeriodEnd: false },
    });

    logger.info({
      msg: '[POST /api/billing/subscription/reactivate] Cancellation cleared',
      organizationId,
    });

    // F-001: record the sensitive billing mutation on the authorized path.
    await audit({
      action: 'billing.subscription.reactivate',
      actorId: ctx.userId,
      actorRole: ctx.role,
      organizationId,
      targetType: 'subscription',
      targetId: subscription.id,
      metadata: { releasedSchedule },
      ...getClientContext(await headers()),
    });

    return NextResponse.json({ message: 'Subscription has been reactivated.', success: true });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/subscription/reactivate]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
