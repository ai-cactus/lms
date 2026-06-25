import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import stripe from '@/lib/stripe';
import { logger } from '@/lib/logger';

// POST /api/billing/subscription/resume — resumes a paused subscription
// (the "Continue Plan" action). Clears the pause window and restores access.
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
        where: { organizationId: user.organizationId },
        data: { pausedAt: null, pauseEndsAt: null },
      }),
      prisma.organization.update({
        where: { id: user.organizationId },
        data: { hasAuditorAccess: billable },
      }),
    ]);

    logger.info({
      msg: '[POST /api/billing/subscription/resume] Subscription resumed',
      organizationId: user.organizationId,
    });

    return NextResponse.json({ message: 'Subscription has been resumed.', success: true });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/subscription/resume]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
