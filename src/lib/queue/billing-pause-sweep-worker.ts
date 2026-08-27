/**
 * BullMQ Worker: Billing Pending-Pause Sweep
 *
 * Consumes jobs from the billing-pause-sweep-queue (produced on a cron schedule
 * by a BullMQ Job Scheduler). Each run materializes every pause whose start
 * boundary has arrived: void collection on Stripe, then set `pausedAt` — the
 * field every access gate reads — and revoke auditor access.
 *
 * The heavy lifting lives in the pure, unit-testable `runBillingPauseSweep`
 * (see src/lib/billing-pause-sweep.ts). This module only owns the BullMQ/worker
 * shell: env resolution, the cron Job Scheduler, and the process-singleton
 * lifecycle — mirroring reminder-sweep-worker.ts.
 *
 * Worker lifecycle:
 *   - Singleton per process, stored on globalThis to survive hot-reloads.
 *   - Started at server boot from src/instrumentation.ts.
 *   - registerRepeatableJob() installs the cron Job Scheduler (idempotent).
 *   - A no-op when BILLING_PAUSE_SWEEP_ENABLED=false.
 */

import { Worker } from 'bullmq';
import { redis } from './redis';
import { logger } from '@/lib/logger';
import { runBillingPauseSweep, type BillingPauseSweepSummary } from '@/lib/billing-pause-sweep';
import {
  BILLING_PAUSE_SWEEP_QUEUE_NAME,
  billingPauseSweepQueue,
  type BillingPauseSweepJobData,
} from './billing-pause-sweep-queue';

declare global {
  var __billingPauseSweepWorker: Worker | undefined;
}

/** Stable id for the cron Job Scheduler that produces sweep jobs. */
const SWEEP_SCHEDULER_ID = 'billing-pause-sweep';

// Quarter-hourly: the sweep's own five-minute lead time only protects against a
// run that is a little late, so the gap between runs has to stay small relative
// to it.
const DEFAULT_CRON = '*/15 * * * *';

/** Reads BILLING_PAUSE_SWEEP_DRY_RUN (default false). */
function resolveDryRun(): boolean {
  return process.env.BILLING_PAUSE_SWEEP_DRY_RUN === 'true';
}

/**
 * Thin wrapper that builds the sweep options from the current clock + env.
 * Exported so a manual trigger can run a sweep inline (returning the summary)
 * without going through the queue.
 */
export async function runBillingPauseSweepJob(dryRun: boolean): Promise<BillingPauseSweepSummary> {
  return runBillingPauseSweep({ now: new Date(), dryRun });
}

/**
 * Install (or update) the cron Job Scheduler that enqueues sweep jobs.
 *
 * Removes any pre-existing scheduler under our id first, so a changed cron
 * pattern can never leave a stale schedule behind, then upserts the current one.
 */
async function registerRepeatableJob(cron: string): Promise<void> {
  try {
    const existing = await billingPauseSweepQueue.getJobSchedulers();
    await Promise.all(
      existing
        .filter((s) => s.id === SWEEP_SCHEDULER_ID)
        .map((s) => billingPauseSweepQueue.removeJobScheduler(s.id as string)),
    );

    await billingPauseSweepQueue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { pattern: cron },
      { name: 'sweep' },
    );

    logger.info({ msg: '[billing] Registered repeatable pause-sweep schedule', cron });
  } catch (err) {
    logger.error({
      msg: '[billing] Failed to register repeatable pause-sweep schedule',
      cron,
      err,
    });
  }
}

/**
 * Returns the singleton pause-sweep worker, creating it on first call. Returns
 * null (and starts nothing) when BILLING_PAUSE_SWEEP_ENABLED is explicitly
 * "false" — the flag defaults to enabled. Safe to call repeatedly.
 */
export function getBillingPauseSweepWorker(): Worker | null {
  if (globalThis.__billingPauseSweepWorker) {
    return globalThis.__billingPauseSweepWorker;
  }

  if (process.env.BILLING_PAUSE_SWEEP_ENABLED === 'false') {
    logger.warn({
      msg: '[billing] Disabled via BILLING_PAUSE_SWEEP_ENABLED=false — pause-sweep worker not started',
    });
    return null;
  }

  const cron = process.env.BILLING_PAUSE_SWEEP_CRON || DEFAULT_CRON;

  logger.info({ msg: '[billing] Starting pause-sweep worker', cron, dryRun: resolveDryRun() });

  const worker = new Worker<BillingPauseSweepJobData>(
    BILLING_PAUSE_SWEEP_QUEUE_NAME,
    async (job) => {
      await runBillingPauseSweepJob(job.data?.dryRun ?? resolveDryRun());
    },
    {
      connection: redis,
      concurrency: 1,
      // One Stripe round-trip plus two writes per due org; give the lock enough
      // head-room that it cannot expire mid-run on a large batch.
      lockDuration: 10 * 60 * 1000,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ msg: '[billing] Pause-sweep job failed', jobId: job?.id, err });
  });

  worker.on('error', (err) => {
    logger.error({ msg: '[billing] Pause-sweep worker connection error', err });
  });

  // Install the cron schedule (idempotent, fire-and-forget).
  void registerRepeatableJob(cron);

  globalThis.__billingPauseSweepWorker = worker;
  return worker;
}
