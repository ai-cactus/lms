/**
 * BullMQ queue for standard-manual PDF indexing jobs.
 *
 * Follows the same pattern as auditor-export-queue.ts.
 * Jobs are enqueued by POST /api/system/manual and consumed by the
 * manual-indexer-worker (started via /api/system/worker/start or server init).
 */

import { Queue } from 'bullmq';
import { redis } from './redis';

export const MANUAL_INDEXER_QUEUE_NAME = 'manual-indexer-queue';

export interface ManualIndexerJobData {
  /** ID of the StandardManual record to index */
  manualId: string;
  /** minio:// or gcs:// URI of the uploaded PDF — worker will download it */
  storagePath: string;
}

export const manualIndexerQueue = new Queue<ManualIndexerJobData>(MANUAL_INDEXER_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    // Keep failed jobs for 7 days for debugging; completed jobs are transient
    removeOnComplete: { count: 10 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
