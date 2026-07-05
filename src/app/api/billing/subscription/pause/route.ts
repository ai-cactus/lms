import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { guardApiSession } from '@/lib/auth-guard';
import { logger } from '@/lib/logger';
import { MAX_PAUSE_MONTHS, pauseEndDate } from '@/lib/billing';

// POST /api/billing/subscription/pause — pauses subscription for 1–3 months
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

    // Pause duration in months (1–3). Defaults to the max if not provided.
    let months = MAX_PAUSE_MONTHS;
    try {
      const body = await request.json();
      if (typeof body?.months === 'number') months = body.months;
    } catch {
      /* empty body — fall back to the default */
    }
    if (months < 1 || months > MAX_PAUSE_MONTHS) {
      return NextResponse.json(
        { error: `Pause duration must be between 1 and ${MAX_PAUSE_MONTHS} months.` },
        { status: 400 },
      );
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

    if (subscription.pausedAt) {
      return NextResponse.json({ error: 'Subscription is already paused.' }, { status: 409 });
    }

    const pausedAt = new Date();
    const pauseEndsAt = pauseEndDate(pausedAt, months);

    // Pause collection on Stripe. The app enforces the 1–3 month limit and
    // prompts the admin to continue or cancel once it elapses, so we deliberately
    // do NOT set `resumes_at` (which would silently auto-resume billing).
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      pause_collection: { behavior: 'void' },
    });

    // Reflect the pause locally right away so the billing gate is restored
    // without waiting for the Stripe webhook to round-trip. Stripe keeps the
    // status as `active` while paused, so `pausedAt` is what gates access.
    await Promise.all([
      prisma.subscription.update({
        where: { organizationId: user.organizationId },
        data: { pausedAt, pauseEndsAt },
      }),
      prisma.organization.update({
        where: { id: user.organizationId },
        data: { hasAuditorAccess: false },
      }),
    ]);

    logger.info({
      msg: '[POST /api/billing/subscription/pause] Subscription paused via native pause_collection',
      organizationId: user.organizationId,
      months,
      pauseEndsAt,
    });

    return NextResponse.json({
      message: 'Subscription has been paused.',
      success: true,
      pausedAt,
      pauseEndsAt,
    });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/subscription/pause]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
