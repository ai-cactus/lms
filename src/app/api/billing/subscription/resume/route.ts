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

// POST /api/billing/subscription/resume — resumes a paused subscription
// (the "Continue Plan" action). Clears the pause window and restores access.
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

    if (!subscription.pausedAt) {
      return NextResponse.json({ error: 'Subscription is not paused.' }, { status: 409 });
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
      ...getClientContext(await headers()),
    });

    return NextResponse.json({ message: 'Subscription has been resumed.', success: true });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/subscription/resume]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
