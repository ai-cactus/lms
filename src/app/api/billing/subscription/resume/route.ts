import { NextResponse } from 'next/server';
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

    // F-001: record the sensitive billing mutation on the authorized path.
    await audit({
      action: 'billing.subscription.resume',
      actorId: session.user.id,
      actorRole: user.role,
      organizationId: user.organizationId,
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
