/**
 * Billing pause sweep — pure, unit-testable orchestration (mirrors
 * `runReminderSweep`).
 *
 * A pause is scheduled, not applied, when the admin requests it: the org keeps
 * full access until the end of the period it already paid for (product decision
 * 2026-08-27). `Subscription.pauseStartsAt` records that boundary, and this
 * sweep is what turns the intent into a real pause when the boundary arrives:
 * it voids collection on Stripe and sets `pausedAt`, which is the field every
 * access gate reads.
 *
 * Stripe's native scheduled-pause endpoint is not usable here — it requires a
 * preview API version plus flexible billing mode, and this project is pinned to
 * `2026-02-25.clover`; `pause_collection` also cannot live in a schedule phase.
 * Hence an application-level sweep.
 *
 * Kept free of BullMQ so it can be exercised directly; the worker shell owns
 * env resolution, the cron scheduler and the process singleton.
 */

import type Stripe from 'stripe';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { logger } from '@/lib/logger';
import { audit } from '@/lib/audit';

/**
 * How far ahead of `now` a pending pause is treated as due.
 *
 * Deliberately non-zero: if the sweep runs even slightly after the period
 * boundary, Stripe will already have renewed the subscription and CHARGED the
 * org for a period it asked to pause through. Flipping a few minutes early
 * voids collection before the renewal attempt. The cost of being early is that
 * the org loses access up to five minutes sooner than the date it was shown —
 * far cheaper than an unwanted charge and a refund.
 */
export const PAUSE_SWEEP_LEAD_MS = 5 * 60 * 1000;

/** Stripe states in which voiding collection is meaningful. */
const PAUSABLE_STRIPE_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  'active',
  'trialing',
]);

export interface BillingPauseSweepOptions {
  now: Date;
  /** When true, log intended pauses and perform zero writes (local or Stripe). */
  dryRun: boolean;
}

export interface BillingPauseSweepSummary {
  /** Pending pauses found at or before the cutoff. */
  scanned: number;
  /** Pauses actually materialized. */
  materialized: number;
  /** Rows skipped because Stripe no longer considers the subscription pausable. */
  skipped: number;
  /** Pauses a dry run would have materialized. Always 0 outside dry-run. */
  wouldMaterialize: number;
  /** Rows that failed; isolated so one bad row never aborts the run. */
  errors: number;
}

/**
 * Materializes every pending pause whose start boundary has arrived.
 *
 * Read-before-act, like `releasePendingSchedule`: the live Stripe subscription
 * is retrieved first and skipped (with a warning, leaving `pauseStartsAt` in
 * place for a human to resolve) when it is no longer active/trialing — a
 * canceled or unpaid subscription must not be "paused".
 */
export async function runBillingPauseSweep(
  opts: BillingPauseSweepOptions,
): Promise<BillingPauseSweepSummary> {
  const { now, dryRun } = opts;

  const summary: BillingPauseSweepSummary = {
    scanned: 0,
    materialized: 0,
    skipped: 0,
    wouldMaterialize: 0,
    errors: 0,
  };

  const cutoff = new Date(now.getTime() + PAUSE_SWEEP_LEAD_MS);

  logger.info({ msg: '[billing] Starting pending-pause sweep', cutoff, dryRun });

  const due = await prisma.subscription.findMany({
    where: {
      pauseStartsAt: { lte: cutoff },
      pausedAt: null,
    },
    select: {
      id: true,
      organizationId: true,
      stripeSubscriptionId: true,
      pauseStartsAt: true,
      pauseEndsAt: true,
    },
  });

  summary.scanned = due.length;

  const stripe = getStripeClient();

  for (const row of due) {
    // `pauseStartsAt` is non-null by the query above; narrow for the type system.
    const pauseStartsAt = row.pauseStartsAt;
    if (!pauseStartsAt) continue;

    try {
      const liveSub = await stripe.subscriptions.retrieve(row.stripeSubscriptionId);
      if (!PAUSABLE_STRIPE_STATUSES.has(liveSub.status)) {
        logger.warn({
          msg: '[billing] Skipping pending pause — Stripe subscription is no longer pausable',
          organizationId: row.organizationId,
          stripeStatus: liveSub.status,
        });
        summary.skipped += 1;
        continue;
      }

      if (dryRun) {
        logger.info({
          msg: '[billing] Dry run — would materialize pending pause',
          organizationId: row.organizationId,
          pauseStartsAt,
        });
        summary.wouldMaterialize += 1;
        continue;
      }

      await stripe.subscriptions.update(row.stripeSubscriptionId, {
        pause_collection: { behavior: 'void' },
      });

      // `pausedAt` is the PROMISED boundary, not the sweep's wall clock, so the
      // pause window the admin was shown is the window they actually get — the
      // few minutes of lead time above must not shorten it.
      await Promise.all([
        prisma.subscription.update({
          where: { id: row.id },
          data: { pausedAt: pauseStartsAt, pauseStartsAt: null },
        }),
        prisma.organization.update({
          where: { id: row.organizationId },
          data: { hasAuditorAccess: false },
        }),
      ]);

      logger.info({
        msg: '[billing] Pending pause materialized',
        organizationId: row.organizationId,
        pausedAt: pauseStartsAt,
        pauseEndsAt: row.pauseEndsAt,
      });

      await audit({
        action: 'billing.subscription.pause_materialized',
        actorRole: 'system',
        organizationId: row.organizationId,
        targetType: 'subscription',
        targetId: row.id,
        metadata: {
          pausedAt: pauseStartsAt.toISOString(),
          pauseEndsAt: row.pauseEndsAt?.toISOString() ?? null,
        },
      });

      summary.materialized += 1;
    } catch (err) {
      // Isolated per row: the next tick retries this org, and one failure must
      // not strand every other org's pause.
      logger.error({
        msg: '[billing] Failed to materialize pending pause',
        err,
        organizationId: row.organizationId,
      });
      summary.errors += 1;
    }
  }

  logger.info({ msg: '[billing] Pending-pause sweep complete', dryRun, ...summary });
  return summary;
}
