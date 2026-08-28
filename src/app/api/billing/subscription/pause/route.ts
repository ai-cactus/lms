import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/rbac/authorize';
import { apiError } from '@/lib/api-response';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { guardApiSession } from '@/lib/auth-guard';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import { MAX_PAUSE_MONTHS, pauseEndDate } from '@/lib/billing';

// POST /api/billing/subscription/pause — SCHEDULES a 1–3 month pause that takes
// effect at the end of the current paid period. Records intent only: the org
// keeps full access until the sweep materializes the pause at the boundary.
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

    if (subscription.pauseStartsAt) {
      const when = new Date(subscription.pauseStartsAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      return NextResponse.json(
        { error: `Your subscription is already scheduled to pause on ${when}.` },
        { status: 409 },
      );
    }

    // The pause lands at the end of the period the org has already paid for
    // (product decision 2026-08-27) — they keep full access until then. The
    // pause window is measured from that boundary, not from now, so the admin
    // gets the full 1–3 months of pause they asked for.
    const pauseStartsAt = subscription.currentPeriodEnd;
    const pauseEndsAt = pauseEndDate(pauseStartsAt, months);

    // Deliberately NO Stripe call: `pause_collection` takes effect immediately
    // and would stop collection mid-period. The sweep
    // (lib/queue/billing-pause-sweep-worker.ts) applies it at the boundary.
    // `pausedAt` and `hasAuditorAccess` are left untouched for the same reason —
    // nothing about the org's access changes today.
    await prisma.subscription.update({
      where: { organizationId },
      data: { pauseStartsAt, pauseEndsAt },
    });

    logger.info({
      msg: '[billing] Pause scheduled for the end of the current period',
      organizationId,
      months,
      pauseStartsAt,
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
      metadata: { months, mode: 'pending', pauseStartsAt: pauseStartsAt.toISOString() },
      ...getClientContext(request.headers),
    });

    return NextResponse.json({
      message: 'Your subscription will pause at the end of your current billing period.',
      success: true,
      pauseStartsAt,
      pauseEndsAt,
    });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/subscription/pause]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
