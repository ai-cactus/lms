import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { guardApiSession } from '@/lib/auth-guard';
import { isAdminRole } from '@/lib/rbac/role-utils';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import { headers } from 'next/headers';

// POST /api/billing/subscription/reactivate — clears a scheduled cancellation
// (the "Resume subscription" action). Reverses a soft cancel by turning off
// `cancel_at_period_end` while the subscription is still billable.
export async function POST() {
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

    const subscription = await prisma.subscription.findUnique({
      where: { organizationId: user.organizationId },
    });

    if (!subscription) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }

    // A pending plan-change schedule wraps the subscription; mutating it while a
    // schedule is active would conflict with the Schedule API, so require the
    // scheduled change to be cancelled first.
    if (subscription.stripeScheduleId) {
      const when = subscription.scheduledEffectiveAt
        ? new Date(subscription.scheduledEffectiveAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : 'the end of your billing period';
      return NextResponse.json(
        { error: `You have a pending plan change scheduled for ${when}. Cancel it first.` },
        { status: 409 },
      );
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

    // Clearing `cancel_at_period_end` tells Stripe to keep the subscription
    // renewing. A cancel-scheduled sub never lost access, so there is no
    // auditor-access restore to perform (unlike resume).
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await prisma.subscription.update({
      where: { organizationId: user.organizationId },
      data: { cancelAtPeriodEnd: false },
    });

    logger.info({
      msg: '[POST /api/billing/subscription/reactivate] Cancellation cleared',
      organizationId: user.organizationId,
    });

    // F-001: record the sensitive billing mutation on the authorized path.
    await audit({
      action: 'billing.subscription.reactivate',
      actorId: session.user.id,
      actorRole: user.role,
      organizationId: user.organizationId,
      targetType: 'subscription',
      targetId: subscription.id,
      ...getClientContext(await headers()),
    });

    return NextResponse.json({ message: 'Subscription has been reactivated.', success: true });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/subscription/reactivate]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
