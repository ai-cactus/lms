import { NextResponse } from 'next/server';
import { authorize } from '@/lib/rbac/authorize';
import { apiError } from '@/lib/api-response';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { guardApiSession } from '@/lib/auth-guard';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import { headers } from 'next/headers';
import { releasePendingSchedule } from '@/lib/billing-schedule';

// POST /api/billing/subscription/resume — resumes a paused subscription
// (the "Continue Plan" action). Clears the pause window and restores access.
// A pending plan-change schedule is released first rather than blocking the
// request: Stripe refuses subscription updates while a schedule wraps it, and
// a paused org can reach this state without ever seeing the pause guard.
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

    if (!subscription.pausedAt) {
      return NextResponse.json({ error: 'Subscription is not paused.' }, { status: 409 });
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

    // Clearing `pause_collection` tells Stripe to resume collecting payment.
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      pause_collection: null,
    });

    // Clear the pause locally and restore auditor access when billable.
    const billable = subscription.status === 'active' || subscription.status === 'trialing';
    await Promise.all([
      prisma.subscription.update({
        where: { organizationId },
        data: { pausedAt: null, pauseEndsAt: null },
      }),
      prisma.organization.update({
        where: { id: organizationId },
        data: { hasAuditorAccess: billable },
      }),
    ]);

    logger.info({
      msg: '[POST /api/billing/subscription/resume] Subscription resumed',
      organizationId,
    });

    // F-001: record the sensitive billing mutation on the authorized path.
    await audit({
      action: 'billing.subscription.resume',
      actorId: ctx.userId,
      actorRole: ctx.role,
      organizationId,
      targetType: 'subscription',
      targetId: subscription.id,
      metadata: { releasedSchedule },
      ...getClientContext(await headers()),
    });

    return NextResponse.json({ message: 'Subscription has been resumed.', success: true });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/subscription/resume]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
