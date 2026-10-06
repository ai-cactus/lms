/**
 * BullMQ queue for the orphaned-avatar sweeper (RISK-17).
 *
 * Jobs are produced on a cron schedule (a BullMQ Job Scheduler — see
 * avatar-sweep-worker.ts) and consumed by the avatar-sweep-worker, which lists
 * the `avatars/` prefix and deletes uploads that no `User.avatarUrl` references.
 *
 * Why: `uploadAvatar` stores the file before the profile save that would
 * reference it, and `deleteReplacedAvatar` only reclaims a photo a save stopped
 * referencing. An upload whose save never happens is reclaimed only here.
 */

import { Queue } from 'bullmq';
import { redis } from './redis';

export const AVATAR_SWEEP_QUEUE_NAME = 'avatar-sweep-queue';

/** The sweep takes no per-job input — it always reconciles the full prefix. */
export type AvatarSweepJobData = Record<string, never>;

export const avatarSweepQueue = new Queue<AvatarSweepJobData>(AVATAR_SWEEP_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    // Idempotent and re-run on the next cron tick, so a retry adds nothing.
    attempts: 1,
    removeOnComplete: { count: 20 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
