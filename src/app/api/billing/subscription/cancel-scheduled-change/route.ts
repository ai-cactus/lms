import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/rbac/authorize';
import { apiError } from '@/lib/api-response';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { guardApiSession } from '@/lib/auth-guard';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';

// POST /api/billing/subscription/cancel-scheduled-change — releases a pending
// subscription-schedule plan change and clears the local scheduled* columns.
// The live plan/cycle is untouched (it always represented what stays live).
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

    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
      select: { id: true, stripeScheduleId: true },
    });

    if (!subscription) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }

    if (!subscription.stripeScheduleId) {
      return NextResponse.json(
        { error: 'There is no scheduled plan change to cancel.' },
        { status: 409 },
      );
    }

    // `release` ends the schedule but keeps the underlying subscription running
    // on its current plan — exactly what "cancel the scheduled change" means.
    await stripe.subscriptionSchedules.release(subscription.stripeScheduleId);

    await prisma.subscription.update({
      where: { organizationId },
      data: {
        scheduledPlan: null,
        scheduledBillingCycle: null,
        scheduledPriceId: null,
        scheduledEffectiveAt: null,
        stripeScheduleId: null,
      },
    });

    logger.info({
      msg: '[billing] Cancelled scheduled plan change',
      organizationId,
    });

    // F-001: record the sensitive billing mutation on the authorized path.
    await audit({
      action: 'billing.subscription.cancel_scheduled_change',
      actorId: ctx.userId,
      actorRole: ctx.role,
      organizationId,
      targetType: 'subscription',
      targetId: subscription.id,
      ...getClientContext(request.headers),
    });

    return NextResponse.json({
      message: 'Your scheduled plan change has been canceled.',
      success: true,
    });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/subscription/cancel-scheduled-change]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
