/**
 * BullMQ Worker: Unified Cycle Summary
 *
 * Consumes jobs from the cycle-summary-queue (produced on a cron schedule by a
 * BullMQ Job Scheduler). Each run is two passes:
 *
 *   1. Retry — re-send any summary email that failed on an earlier run, rebuilt
 *      from the `CycleSummaryItem` rows it recorded. Runs FIRST: those rows are
 *      already stamped `summarizedAt`, so the compose pass below will never pick
 *      them up again and this is their only second chance.
 *   2. Compose — one email per recipient per organization per day, covering
 *      their reminders, their team's compliance items, and (when the org's
 *      cadence is due) the notification digest section.
 *
 * The heavy lifting lives in the pure, unit-testable `runCycleSummary` /
 * `runCycleSummaryRetry` (see src/lib/cycle-summary/). This module only owns the
 * BullMQ/worker shell: env resolution, the real email-sender injection, the cron
 * Job Scheduler and the process-singleton lifecycle — mirroring
 * notification-digest-worker.ts, which it replaces.
 *
 * The cron deliberately matches the digest's (~13:00 UTC, ~08:00 US Eastern),
 * which is AFTER the reminder sweep's 08:00 UTC pass — the sweep claims the
 * day's reminder rows, this run mails them.
 *
 * Worker lifecycle:
 *   - Singleton per process, stored on globalThis to survive hot-reloads.
 *   - Started at server boot from `src/instrumentation.ts`.
 *   - registerRepeatableJob() installs the cron Job Scheduler (idempotent).
 *   - A no-op unless CYCLE_SUMMARY_ENABLED=true (opt-in: until an environment
 *     has switched over, the notification digest worker owns this slot).
 */

import { Worker } from 'bullmq';
import { redis } from './redis';
import { logger } from '@/lib/logger';
import { runCycleSummary, type CycleSummaryRunSummary } from '@/lib/cycle-summary/compose';
import { runCycleSummaryRetry, type CycleSummaryRetrySummary } from '@/lib/cycle-summary/retry';
import { cycleSummaryEmailSender } from '@/lib/cycle-summary/email-sender';
import { isCycleSummaryEnabled } from '@/lib/cycle-summary/flag';
import {
  CYCLE_SUMMARY_QUEUE_NAME,
  cycleSummaryQueue,
  type CycleSummaryJobData,
} from './cycle-summary-queue';

declare global {
  var __cycleSummaryWorker: Worker | undefined;
}

/** Stable id for the cron Job Scheduler that produces summary jobs. */
const SUMMARY_SCHEDULER_ID = 'cycle-summary';

/** ~08:00 US Eastern, after the 08:00 UTC reminder sweep has claimed the day. */
const DEFAULT_CRON = '0 13 * * *';

/** Reads CYCLE_SUMMARY_DRY_RUN (default false). */
function resolveDryRun(): boolean {
  return process.env.CYCLE_SUMMARY_DRY_RUN === 'true';
}

/** What one scheduled run did, across both passes. */
export interface CycleSummaryJobSummary {
  retry: CycleSummaryRetrySummary;
  compose: CycleSummaryRunSummary;
}

/**
 * Thin wrapper that builds the run options from the current clock + env and
 * injects the real email sender. Exported so the manual-trigger route can run a
 * summary inline (returning the summary) without going through the queue.
 */
export async function runCycleSummaryJob(dryRun: boolean): Promise<CycleSummaryJobSummary> {
  const sendEmail = cycleSummaryEmailSender;

  // Retry first — see the module header. A failure here must not skip the
  // compose pass, which is the day's actual delivery; runCycleSummaryRetry
  // never throws, so this ordering costs nothing.
  const retry = await runCycleSummaryRetry({ now: new Date(), dryRun, sendEmail });
  const compose = await runCycleSummary({ now: new Date(), dryRun, sendEmail });

  return { retry, compose };
}

/**
 * Install (or update) the cron Job Scheduler that enqueues summary jobs.
 *
 * Removes any pre-existing scheduler under our id first, so a changed cron
 * pattern can never leave a stale schedule behind, then upserts the current one.
 */
async function registerRepeatableJob(cron: string): Promise<void> {
  try {
    const existing = await cycleSummaryQueue.getJobSchedulers();
    await Promise.all(
      existing
        .filter((s) => s.id === SUMMARY_SCHEDULER_ID)
        .map((s) => cycleSummaryQueue.removeJobScheduler(s.id as string)),
    );

    await cycleSummaryQueue.upsertJobScheduler(
      SUMMARY_SCHEDULER_ID,
      { pattern: cron },
      { name: 'summary' },
    );

    logger.info({ msg: '[cycle-summary] Registered repeatable summary schedule', cron });
  } catch (err) {
    logger.error({
      msg: '[cycle-summary] Failed to register repeatable summary schedule',
      cron,
      err,
    });
  }
}

/**
 * Returns the singleton cycle-summary worker, creating it on first call. Returns
 * null (and starts nothing) unless CYCLE_SUMMARY_ENABLED=true — the pre-cutover
 * default, where the notification digest worker runs instead. Safe to call
 * repeatedly.
 */
export function getCycleSummaryWorker(): Worker | null {
  if (globalThis.__cycleSummaryWorker) {
    return globalThis.__cycleSummaryWorker;
  }

  if (!isCycleSummaryEnabled()) {
    return null;
  }

  const cron = process.env.CYCLE_SUMMARY_CRON || DEFAULT_CRON;

  logger.info({
    msg: '[cycle-summary] Starting summary worker',
    cron,
    dryRun: resolveDryRun(),
  });

  const worker = new Worker<CycleSummaryJobData>(
    CYCLE_SUMMARY_QUEUE_NAME,
    async (job) => {
      await runCycleSummaryJob(job.data?.dryRun ?? resolveDryRun());
    },
    {
      connection: redis,
      concurrency: 1,
      // A run fans out across every organization with un-summarized reminders or
      // pending events; give it head-room so the lock never expires mid-run.
      lockDuration: 10 * 60 * 1000,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ msg: '[cycle-summary] Summary job failed', jobId: job?.id, err });
  });

  worker.on('error', (err) => {
    logger.error({ msg: '[cycle-summary] Summary worker connection error', err });
  });

  // Install the cron schedule (idempotent, fire-and-forget).
  void registerRepeatableJob(cron);

  globalThis.__cycleSummaryWorker = worker;
  return worker;
}
