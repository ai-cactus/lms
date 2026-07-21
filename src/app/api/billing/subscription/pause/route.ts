import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/rbac/authorize';
import { apiError } from '@/lib/api-response';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { guardApiSession } from '@/lib/auth-guard';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import { MAX_PAUSE_MONTHS, pauseEndDate } from '@/lib/billing';

// POST /api/billing/subscription/pause — pauses subscription for 1–3 months
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

    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }

    // A pending plan-change schedule wraps the subscription; pausing it while a
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
        where: { organizationId },
        data: { pausedAt, pauseEndsAt },
      }),
      prisma.organization.update({
        where: { id: organizationId },
        data: { hasAuditorAccess: false },
      }),
    ]);

    logger.info({
      msg: '[POST /api/billing/subscription/pause] Subscription paused via native pause_collection',
      organizationId,
      months,
      pauseEndsAt,
    });

    // F-001: record the sensitive billing mutation on the authorized path.
    await audit({
      action: 'billing.subscription.pause',
      actorId: ctx.userId,
      actorRole: ctx.role,
      organizationId,
      targetType: 'subscription',
      targetId: subscription.id,
      metadata: { months },
      ...getClientContext(request.headers),
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
