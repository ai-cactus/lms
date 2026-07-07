/**
 * BullMQ Worker: Reminder & Escalation Sweep
 *
 * Consumes jobs from the reminder-sweep-queue (produced on a cron schedule by a
 * BullMQ Job Scheduler). Each run executes one idempotent pass:
 *
 *   - Track A (deadline ladder): for every active enrollment with a `dueAt`,
 *     recompute each stage's target date (`dueAt + offset`) and dispatch any
 *     stage due within the catch-up window that hasn't already been sent.
 *   - Track B (failing/locked quiz): nudge workers who failed but have attempts
 *     remaining, and nudge admins to re-assign once attempts are exhausted.
 *
 * The heavy lifting lives in the pure, unit-testable `runReminderSweep` (see
 * src/lib/reminders/sweep.ts). This module only owns the BullMQ/worker shell:
 * env resolution, the real email-sender injection, the cron Job Scheduler, and
 * the process-singleton lifecycle — mirroring video-sweep-worker.ts.
 *
 * Worker lifecycle:
 *   - Singleton per process, stored on globalThis to survive hot-reloads.
 *   - Started lazily from the system layout server component.
 *   - registerRepeatableJob() installs the cron Job Scheduler (idempotent).
 *   - A no-op when REMINDER_SWEEP_ENABLED=false.
 */

import { Worker } from 'bullmq';
import { redis } from './redis';
import { logger } from '@/lib/logger';
import { runReminderSweep, type ReminderSweepSummary } from '@/lib/reminders/sweep';
import { reminderEmailSender } from '@/lib/reminders/email-sender';
import {
  REMINDER_SWEEP_QUEUE_NAME,
  reminderSweepQueue,
  type ReminderSweepJobData,
} from './reminder-sweep-queue';

declare global {
  var __reminderSweepWorker: Worker | undefined;
}

/** Stable id for the cron Job Scheduler that produces sweep jobs. */
const SWEEP_SCHEDULER_ID = 'reminder-sweep';

const DEFAULT_CRON = '0 8 * * *';
const DEFAULT_CATCHUP_DAYS = 2;
const DEFAULT_NUDGE_INTERVAL_DAYS = 3;

/** Reads REMINDER_SWEEP_DRY_RUN (default false). */
function resolveDryRun(): boolean {
  return process.env.REMINDER_SWEEP_DRY_RUN === 'true';
}

/** Parses a non-negative integer env var, falling back when missing/invalid. */
function resolveNonNegativeIntEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Reads REMINDER_CATCHUP_DAYS (default 2). */
function resolveCatchUpDays(): number {
  return resolveNonNegativeIntEnv(process.env.REMINDER_CATCHUP_DAYS, DEFAULT_CATCHUP_DAYS);
}

/** Reads REMINDER_NUDGE_INTERVAL_DAYS (default 3). */
function resolveNudgeIntervalDays(): number {
  return resolveNonNegativeIntEnv(
    process.env.REMINDER_NUDGE_INTERVAL_DAYS,
    DEFAULT_NUDGE_INTERVAL_DAYS,
  );
}

/**
 * Thin wrapper that builds the sweep options from the current clock + env and
 * injects the real email sender. Exported so the manual-trigger route can run a
 * sweep inline (returning the summary) without going through the queue.
 */
export async function runReminderSweepJob(dryRun: boolean): Promise<ReminderSweepSummary> {
  return runReminderSweep({
    now: new Date(),
    catchUpDays: resolveCatchUpDays(),
    nudgeIntervalDays: resolveNudgeIntervalDays(),
    dryRun,
    sendEmail: reminderEmailSender,
  });
}

/**
 * Install (or update) the cron Job Scheduler that enqueues sweep jobs.
 *
 * Uses the BullMQ Job Scheduler API (upsertJobScheduler / getJobSchedulers /
 * removeJobScheduler). We first remove any pre-existing scheduler under our id
 * so a changed cron pattern can never leave a stale schedule behind, then
 * upsert the current one.
 */
async function registerRepeatableJob(cron: string): Promise<void> {
  try {
    const existing = await reminderSweepQueue.getJobSchedulers();
    await Promise.all(
      existing
        .filter((s) => s.id === SWEEP_SCHEDULER_ID)
        .map((s) => reminderSweepQueue.removeJobScheduler(s.id as string)),
    );

    await reminderSweepQueue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { pattern: cron },
      { name: 'sweep' },
    );

    logger.info({ msg: '[reminders] Registered repeatable sweep schedule', cron });
  } catch (err) {
    logger.error({ msg: '[reminders] Failed to register repeatable sweep schedule', cron, err });
  }
}

/**
 * Returns the singleton sweep worker, creating it on first call. Returns null
 * (and starts nothing) when REMINDER_SWEEP_ENABLED is explicitly "false" — the
 * flag defaults to enabled. Safe to call repeatedly.
 */
export function getReminderSweepWorker(): Worker | null {
  if (globalThis.__reminderSweepWorker) {
    return globalThis.__reminderSweepWorker;
  }

  if (process.env.REMINDER_SWEEP_ENABLED === 'false') {
    logger.warn({
      msg: '[reminders] Disabled via REMINDER_SWEEP_ENABLED=false — worker not started',
    });
    return null;
  }

  const cron = process.env.REMINDER_SWEEP_CRON || DEFAULT_CRON;

  logger.info({
    msg: '[reminders] Starting sweep worker',
    cron,
    catchUpDays: resolveCatchUpDays(),
    nudgeIntervalDays: resolveNudgeIntervalDays(),
    dryRun: resolveDryRun(),
  });

  const worker = new Worker<ReminderSweepJobData>(
    REMINDER_SWEEP_QUEUE_NAME,
    async (job) => {
      await runReminderSweepJob(job.data?.dryRun ?? resolveDryRun());
    },
    {
      connection: redis,
      concurrency: 1,
      // The sweep does several bulk queries plus per-enrollment dispatch; give it
      // plenty of head-room so the lock never expires mid-run on a large org set.
      lockDuration: 10 * 60 * 1000,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ msg: '[reminders] Sweep job failed', jobId: job?.id, err });
  });

  worker.on('error', (err) => {
    logger.error({ msg: '[reminders] Worker connection error', err });
  });

  // Install the cron schedule (idempotent, fire-and-forget).
  void registerRepeatableJob(cron);

  globalThis.__reminderSweepWorker = worker;
  return worker;
}
