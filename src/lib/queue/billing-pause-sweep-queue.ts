/**
 * BullMQ queue for the billing pending-pause sweep.
 *
 * Jobs are produced on a cron schedule (a BullMQ Job Scheduler — see
 * billing-pause-sweep-worker.ts) and consumed by the billing-pause-sweep-worker,
 * which materializes every pause whose start boundary has arrived: it voids
 * collection on Stripe and sets `pausedAt`.
 *
 * Why a sweep rather than one delayed job per pause: the boundary moves
 * (a renewal shifts `currentPeriodEnd`, a resume cancels the pause outright),
 * and a re-query stays correct when the intent changes underneath it, where a
 * job scheduled months out would not.
 */

import { Queue } from 'bullmq';
import { redis } from './redis';

export const BILLING_PAUSE_SWEEP_QUEUE_NAME = 'billing-pause-sweep-queue';

/** Per-job input. `dryRun` overrides the env default for a single run. */
export interface BillingPauseSweepJobData {
  dryRun?: boolean;
}

export const billingPauseSweepQueue = new Queue<BillingPauseSweepJobData>(
  BILLING_PAUSE_SWEEP_QUEUE_NAME,
  {
    connection: redis,
    defaultJobOptions: {
      // The sweep is idempotent (a materialized pause no longer matches the
      // query) and re-runs on the next tick, so retries add no value — one
      // attempt keeps a transient failure from double-applying anything.
      attempts: 1,
      removeOnComplete: { count: 20 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  },
);
