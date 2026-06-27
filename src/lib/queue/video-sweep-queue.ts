/**
 * BullMQ queue for the orphaned-object reconciliation sweeper.
 *
 * Jobs are produced on a cron schedule (a BullMQ Job Scheduler — see
 * video-sweep-worker.ts) and consumed by the video-sweep-worker, which lists
 * every object under the `system/videos/` prefix, drops anything inside the
 * grace window, diffs the remainder against the URIs referenced in the database,
 * and deletes the orphans.
 *
 * Why: the upload route's Phase-1 abort cleanup reclaims most orphans inline,
 * but it cannot catch every case (process crash mid-request, a transcode that
 * supersedes the original upload, etc.). This scheduled sweep is the backstop.
 */

import { Queue } from 'bullmq';
import { redis } from './redis';

export const VIDEO_SWEEP_QUEUE_NAME = 'video-sweep-queue';

/** The sweep takes no per-job input — it always reconciles the full prefix. */
export type VideoSweepJobData = Record<string, never>;

export const videoSweepQueue = new Queue<VideoSweepJobData>(VIDEO_SWEEP_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    // A sweep is idempotent and re-runs on the next cron tick, so retries add no
    // value — one attempt keeps a transient failure from re-deleting churn.
    attempts: 1,
    removeOnComplete: { count: 20 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
