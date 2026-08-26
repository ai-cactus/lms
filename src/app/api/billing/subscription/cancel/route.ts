import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/rbac/authorize';
import { apiError } from '@/lib/api-response';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { guardApiSession } from '@/lib/auth-guard';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import { releasePendingSchedule } from '@/lib/billing-schedule';

// POST /api/billing/subscription/cancel — cancels subscription at end of current
// period. A pending plan-change schedule is released first rather than blocking
// the request: Stripe rejects cancellation-behaviour updates on a scheduled
// subscription, and a customer cancelling no longer wants the queued change.
export async function POST(request: NextRequest) {
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

    // Optional cancellation reason captured from the survey.
    let reason: string | undefined;
    try {
      const body = await request.json();
      if (typeof body?.reason === 'string' && body.reason.trim()) reason = body.reason.trim();
    } catch {
      /* no body — reason is optional */
    }

    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }

    if (subscription.cancelAtPeriodEnd) {
      return NextResponse.json(
        { error: 'Subscription is already scheduled for cancellation.' },
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

    // Cancel at period end — does not stop service immediately
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
      ...(reason ? { cancellation_details: { comment: reason } } : {}),
    });

    await prisma.subscription.update({
      where: { organizationId },
      data: { cancelAtPeriodEnd: true },
    });

    // F-001: record the sensitive billing mutation on the authorized path.
    await audit({
      action: 'billing.subscription.cancel',
      actorId: ctx.userId,
      actorRole: ctx.role,
      organizationId,
      targetType: 'subscription',
      targetId: subscription.id,
      metadata: { cancelAtPeriodEnd: true, releasedSchedule },
      ...getClientContext(request.headers),
    });

    return NextResponse.json({
      message: 'Subscription will be canceled at the end of the billing period.',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: subscription.currentPeriodEnd,
    });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/subscription/cancel]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
