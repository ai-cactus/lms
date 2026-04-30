/**
 * BullMQ Worker: Standard Manual PDF Indexer
 *
 * Consumes jobs from the manual-indexer-queue. Each job:
 *   1. Downloads the PDF from storage (minio:// or gcs://)
 *   2. Delegates to indexStandardManual() for parsing, chunking, and embedding
 *   3. Updates the StandardManual record with processedAt / chunkCount on success,
 *      or marks the Job DB record as failed on error.
 *
 * Worker lifecycle:
 *   - Singleton per process, stored on globalThis to survive Next.js hot-reloads.
 *   - Started lazily via GET /api/system/worker (called from the layout/init route).
 *   - Concurrency is 1 — indexing is CPU/memory intensive; avoid parallel runs.
 */

import { Worker } from 'bullmq';
import { redis } from './redis';
import { downloadFile } from '@/lib/storage';
import { indexStandardManual } from '@/lib/manual-indexer';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { MANUAL_INDEXER_QUEUE_NAME, type ManualIndexerJobData } from './manual-indexer-queue';

// ─────────────────────────────────────────────────────────────────────────────

declare global {
  var __manualIndexerWorker: Worker | undefined;
}

/**
 * Returns the singleton worker, creating it if it doesn't exist yet.
 * Safe to call multiple times — only one Worker instance will be created.
 */
export function getManualIndexerWorker(): Worker {
  if (globalThis.__manualIndexerWorker) {
    return globalThis.__manualIndexerWorker;
  }

  logger.info({ msg: '[ManualIndexerWorker] Starting worker' });

  const worker = new Worker<ManualIndexerJobData>(
    MANUAL_INDEXER_QUEUE_NAME,
    async (job) => {
      const { manualId, storagePath } = job.data;

      logger.info({
        msg: '[ManualIndexerWorker] Job received',
        jobId: job.id,
        manualId,
      });

      await job.updateProgress(5);

      // 1. Download the PDF from object storage
      logger.info({ msg: '[ManualIndexerWorker] Downloading PDF', manualId, storagePath });
      const pdfBuffer = await downloadFile(storagePath);

      logger.info({
        msg: '[ManualIndexerWorker] PDF downloaded',
        manualId,
        sizeBytes: pdfBuffer.length,
      });

      await job.updateProgress(15);

      // 2. Run the full parse → chunk → embed → store pipeline
      //    indexStandardManual handles its own progress logging and DB updates
      await indexStandardManual(manualId, pdfBuffer);

      await job.updateProgress(100);

      logger.info({
        msg: '[ManualIndexerWorker] Job completed',
        jobId: job.id,
        manualId,
      });
    },
    {
      connection: redis,
      // Process one indexing job at a time — embedding API calls are rate-limited
      // and PDF parsing is memory-intensive.
      concurrency: 1,
    },
  );

  worker.on('failed', async (job, err) => {
    logger.error({
      msg: '[ManualIndexerWorker] Job failed',
      jobId: job?.id,
      manualId: job?.data?.manualId,
      err,
    });

    // Mark the StandardManual so the UI shows a clear "Failed" state
    if (job?.data?.manualId) {
      try {
        await prisma.standardManual.update({
          where: { id: job.data.manualId },
          data: {
            // processedAt stays null → UI shows "Processing..." until operator re-uploads
            chunkCount: 0,
          },
        });
      } catch (updateErr) {
        logger.error({
          msg: '[ManualIndexerWorker] Failed to update manual status after job failure',
          manualId: job.data.manualId,
          updateErr,
        });
      }
    }
  });

  worker.on('error', (err) => {
    logger.error({ msg: '[ManualIndexerWorker] Worker error', err });
  });

  globalThis.__manualIndexerWorker = worker;
  return worker;
}
