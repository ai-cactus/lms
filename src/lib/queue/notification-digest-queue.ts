/**
 * BullMQ queue for the batched (Tier 2) notification digest.
 *
 * Jobs are produced on a cron schedule (a BullMQ Job Scheduler — see
 * notification-digest-worker.ts) and consumed by the notification-digest-worker,
 * which sends one digest per organization per period (daily, or weekly on
 * Mondays) covering every `pending` NotificationEvent.
 *
 * Why a period-claim sweep (vs. scheduling a job per organization): the claim row
 * makes a digest at-most-once per period regardless of how many times the job
 * runs, so a retried or duplicated tick can never double-send.
 */

import { Queue } from 'bullmq';
import { redis } from './redis';

export const NOTIFICATION_DIGEST_QUEUE_NAME = 'notification-digest-queue';

/** Per-job input. `dryRun` overrides the env default for a single run. */
export interface NotificationDigestJobData {
  dryRun?: boolean;
}

export const notificationDigestQueue = new Queue<NotificationDigestJobData>(
  NOTIFICATION_DIGEST_QUEUE_NAME,
  {
    connection: redis,
    defaultJobOptions: {
      // The run is claim-guarded and re-runs on the next cron tick, so retries add
      // no value — one attempt keeps a transient failure from re-claiming.
      attempts: 1,
      removeOnComplete: { count: 20 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  },
);
