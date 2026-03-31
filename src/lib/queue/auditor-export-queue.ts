import { Queue } from 'bullmq';
import { redis } from './redis';

export const AUDITOR_EXPORT_QUEUE_NAME = 'auditor-export-queue';

export const auditorExportQueue = new Queue(AUDITOR_EXPORT_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true, // Keep it from bloating Redis
  },
});
