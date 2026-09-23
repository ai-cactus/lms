/**
 * BullMQ queue for the unified cycle summary.
 *
 * Jobs are produced on a cron schedule (a BullMQ Job Scheduler — see
 * cycle-summary-worker.ts) and consumed by the cycle-summary-worker, which sends
 * ONE email per recipient per day covering every reminder, nudge and
 * notification event that concerns them.
 *
 * Successor to notification-digest-queue.ts: the digest emailed one organization
 * summary of NotificationEvents, this emails one person-level summary that also
 * absorbs the reminder ladder and the Track B nudges. The two are mutually
 * exclusive — `CYCLE_SUMMARY_ENABLED` starts exactly one of the two workers.
 *
 * Why a period-claim sweep (vs. scheduling a job per organization): the claim row
 * makes a summary at-most-once per period regardless of how many times the job
 * runs, so a retried or duplicated tick can never double-send.
 */

import { Queue } from 'bullmq';
import { redis } from './redis';

export const CYCLE_SUMMARY_QUEUE_NAME = 'cycle-summary-queue';

/** Per-job input. `dryRun` overrides the env default for a single run. */
export interface CycleSummaryJobData {
  dryRun?: boolean;
}

export const cycleSummaryQueue = new Queue<CycleSummaryJobData>(CYCLE_SUMMARY_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    // The run is claim-guarded and re-runs on the next cron tick, so retries add
    // no value — one attempt keeps a transient failure from re-claiming.
    attempts: 1,
    removeOnComplete: { count: 20 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
