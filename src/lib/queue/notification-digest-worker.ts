/**
 * BullMQ Worker: Notification Digest
 *
 * Consumes jobs from the notification-digest-queue (produced on a cron schedule
 * by a BullMQ Job Scheduler). Each run sends one batched summary email per
 * organization per period — daily organizations every run, weekly organizations
 * on Mondays (UTC) — covering every `pending` NotificationEvent.
 *
 * The heavy lifting lives in the pure, unit-testable `runNotificationDigest`
 * (see src/lib/notifications/digest.ts). This module only owns the BullMQ/worker
 * shell: env resolution, the real email-sender injection, the cron Job Scheduler
 * and the process-singleton lifecycle — mirroring reminder-sweep-worker.ts.
 *
 * Worker lifecycle:
 *   - Singleton per process, stored on globalThis to survive hot-reloads.
 *   - Started at server boot from `src/instrumentation.ts`.
 *   - registerRepeatableJob() installs the cron Job Scheduler (idempotent).
 *   - A no-op when NOTIFICATION_DIGEST_ENABLED=false.
 */

import { Worker } from 'bullmq';
import { redis } from './redis';
import { logger } from '@/lib/logger';
import { runNotificationDigest, type DigestRunSummary } from '@/lib/notifications/digest';
import { notificationDigestSender } from '@/lib/notifications/email-sender';
import {
  NOTIFICATION_DIGEST_QUEUE_NAME,
  notificationDigestQueue,
  type NotificationDigestJobData,
} from './notification-digest-queue';

declare global {
  var __notificationDigestWorker: Worker | undefined;
}

/** Stable id for the cron Job Scheduler that produces digest jobs. */
const DIGEST_SCHEDULER_ID = 'notification-digest';

/** ~08:00 US Eastern. Per-organization local-time delivery is future work. */
const DEFAULT_CRON = '0 13 * * *';

/** Reads NOTIFICATION_DIGEST_DRY_RUN (default false). */
function resolveDryRun(): boolean {
  return process.env.NOTIFICATION_DIGEST_DRY_RUN === 'true';
}

/**
 * Thin wrapper that builds the digest options from the current clock + env and
 * injects the real email sender. Exported so the manual-trigger route can run a
 * digest inline (returning the summary) without going through the queue.
 */
export async function runNotificationDigestJob(dryRun: boolean): Promise<DigestRunSummary> {
  return runNotificationDigest({
    now: new Date(),
    dryRun,
    sendEmail: notificationDigestSender,
  });
}

/**
 * Install (or update) the cron Job Scheduler that enqueues digest jobs.
 *
 * Removes any pre-existing scheduler under our id first, so a changed cron
 * pattern can never leave a stale schedule behind, then upserts the current one.
 */
async function registerRepeatableJob(cron: string): Promise<void> {
  try {
    const existing = await notificationDigestQueue.getJobSchedulers();
    await Promise.all(
      existing
        .filter((s) => s.id === DIGEST_SCHEDULER_ID)
        .map((s) => notificationDigestQueue.removeJobScheduler(s.id as string)),
    );

    await notificationDigestQueue.upsertJobScheduler(
      DIGEST_SCHEDULER_ID,
      { pattern: cron },
      { name: 'digest' },
    );

    logger.info({ msg: '[notifications] Registered repeatable digest schedule', cron });
  } catch (err) {
    logger.error({
      msg: '[notifications] Failed to register repeatable digest schedule',
      cron,
      err,
    });
  }
}

/**
 * Returns the singleton digest worker, creating it on first call. Returns null
 * (and starts nothing) when NOTIFICATION_DIGEST_ENABLED is explicitly "false" —
 * the flag defaults to enabled. Safe to call repeatedly.
 */
export function getNotificationDigestWorker(): Worker | null {
  if (globalThis.__notificationDigestWorker) {
    return globalThis.__notificationDigestWorker;
  }

  if (process.env.NOTIFICATION_DIGEST_ENABLED === 'false') {
    logger.warn({
      msg: '[notifications] Disabled via NOTIFICATION_DIGEST_ENABLED=false — worker not started',
    });
    return null;
  }

  const cron = process.env.NOTIFICATION_DIGEST_CRON || DEFAULT_CRON;

  logger.info({
    msg: '[notifications] Starting digest worker',
    cron,
    dryRun: resolveDryRun(),
  });

  const worker = new Worker<NotificationDigestJobData>(
    NOTIFICATION_DIGEST_QUEUE_NAME,
    async (job) => {
      await runNotificationDigestJob(job.data?.dryRun ?? resolveDryRun());
    },
    {
      connection: redis,
      concurrency: 1,
      // A run fans out across every organization with pending events; give it
      // head-room so the lock never expires mid-run.
      lockDuration: 10 * 60 * 1000,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ msg: '[notifications] Digest job failed', jobId: job?.id, err });
  });

  worker.on('error', (err) => {
    logger.error({ msg: '[notifications] Digest worker connection error', err });
  });

  // Install the cron schedule (idempotent, fire-and-forget).
  void registerRepeatableJob(cron);

  globalThis.__notificationDigestWorker = worker;
  return worker;
}
