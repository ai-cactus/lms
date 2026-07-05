import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { guardApiSession } from '@/lib/auth-guard';
import { logger } from '@/lib/logger';

// POST /api/billing/subscription/cancel — cancels subscription at end of current period
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

    // Optional cancellation reason captured from the survey.
    let reason: string | undefined;
    try {
      const body = await request.json();
      if (typeof body?.reason === 'string' && body.reason.trim()) reason = body.reason.trim();
    } catch {
      /* no body — reason is optional */
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, organizationId: true },
    });

    if (!user || user.role !== 'admin') {
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
      where: { organizationId: user.organizationId },
      data: { cancelAtPeriodEnd: true },
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
