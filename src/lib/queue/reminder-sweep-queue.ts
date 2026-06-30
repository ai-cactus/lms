/**
 * BullMQ queue for the reminder & escalation sweep.
 *
 * Jobs are produced on a cron schedule (a BullMQ Job Scheduler — see
 * reminder-sweep-worker.ts) and consumed by the reminder-sweep-worker, which
 * runs one idempotent daily pass over active enrollments: it recomputes each
 * stage's target date from `dueAt + offset` and dispatches anything "due today
 * (within the catch-up window) and not already sent", plus the Track B failing/
 * locked-quiz nudges.
 *
 * Why a recompute-and-dedup sweep (vs. scheduling N jobs per enrollment): it
 * stays correct when deadlines, completions, or failures change underneath it,
 * and survives a missed cron day via the catch-up window.
 */

import { Queue } from 'bullmq';
import { redis } from './redis';

export const REMINDER_SWEEP_QUEUE_NAME = 'reminder-sweep-queue';

/** Per-job input. `dryRun` overrides the env default for a single run. */
export interface ReminderSweepJobData {
  dryRun?: boolean;
}

export const reminderSweepQueue = new Queue<ReminderSweepJobData>(REMINDER_SWEEP_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    // A sweep is idempotent and re-runs on the next cron tick, so retries add no
    // value — one attempt keeps a transient failure from double-sending.
    attempts: 1,
    removeOnComplete: { count: 20 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
