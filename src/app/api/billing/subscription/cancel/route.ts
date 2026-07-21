import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/rbac/authorize';
import { apiError } from '@/lib/api-response';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { guardApiSession } from '@/lib/auth-guard';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';

// POST /api/billing/subscription/cancel — cancels subscription at end of current period
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

    // A pending plan-change schedule wraps the subscription; cancelling it while
    // a schedule is active would conflict with the Schedule API, so require the
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

    if (subscription.cancelAtPeriodEnd) {
      return NextResponse.json(
        { error: 'Subscription is already scheduled for cancellation.' },
        { status: 409 },
      );
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
      metadata: { cancelAtPeriodEnd: true },
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
