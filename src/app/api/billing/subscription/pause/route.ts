import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import stripe from '@/lib/stripe';
import { logger } from '@/lib/logger';

// POST /api/billing/subscription/pause — pauses subscription
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

    // Since a specific $9.90/mo Pause Price ID isn't available, we'll use Stripe's native pause_collection for now.
    // In a full production implementation with a fee, you would update the subscription item to a Pause Price ID.
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      pause_collection: {
        behavior: 'void',
      },
    });

    logger.info({
      msg: '[POST /api/billing/subscription/pause] Subscription paused via native pause_collection',
      organizationId: user.organizationId,
    });

    return NextResponse.json({
      message: 'Subscription has been paused.',
      success: true,
    });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/subscription/pause]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
