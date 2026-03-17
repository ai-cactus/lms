import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import stripe from '@/lib/stripe';

// POST /api/billing/subscription/cancel — cancels subscription at end of current period
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    console.error('[POST /api/billing/subscription/cancel]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
