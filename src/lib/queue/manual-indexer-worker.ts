/**
 * BullMQ Worker: Standard Manual PDF Indexer
 *
 * Consumes jobs from the manual-indexer-queue. For each job it spawns
 * scripts/index-worker.mjs as a CHILD PROCESS so the heavy embedding work
 * runs in its own V8 heap, completely isolated from the Next.js server.
 *
 * This prevents the indexer from OOM-killing the server:
 *   - The Next.js server accumulates ~3-4 GB of heap over time from RSC
 *     rendering, cache growth, etc.
 *   - Running embedding batches inside that same heap leaves no headroom.
 *   - A dedicated child process gets 3 GB of dedicated heap and exits cleanly
 *     when done, freeing all its memory.
 *
 * Lock renewal: BullMQ auto-renews the job lock at lockDuration/2 intervals
 * while the async processFn is awaiting. Since we await the child process
 * Promise, the lock stays live for the full duration.
 *
 * Worker lifecycle:
 *   - Singleton per process, stored on globalThis to survive Next.js hot-reloads.
 *   - Started lazily from the system layout server component.
 *   - Concurrency is 1 — one large PDF at a time.
 */

import { join } from 'path';
import { spawn } from 'child_process';
import { Worker } from 'bullmq';
import { redis } from './redis';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { MANUAL_INDEXER_QUEUE_NAME, type ManualIndexerJobData } from './manual-indexer-queue';

// ─────────────────────────────────────────────────────────────────────────────

declare global {
  var __manualIndexerWorker: Worker | undefined;
}

/** Absolute path to the standalone indexer script. */
const WORKER_SCRIPT = join(process.cwd(), 'scripts', 'index-worker.mjs');

/**
 * Spawns scripts/index-worker.mjs and resolves when it exits with code 0.
 * Rejects for any non-zero exit code or signal termination.
 *
 * stdout lines from the child are expected to be JSON log objects and are
 * re-emitted via the server logger at the appropriate level.
 */
function runIndexerProcess(
  manualId: string,
  storagePath: string,
  onProgress: (pct: number) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath, // same node binary as the server
      [
        '--max-old-space-size=3000',
        '--expose-gc',
        WORKER_SCRIPT,
        `--manual-id=${manualId}`,
        `--storage-path=${storagePath}`,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stderr = '';
    let lastProgress = 0;

    // Relay child stdout (structured JSON logs) through the server logger
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t) as Record<string, unknown>;
          const level = (obj.level as string) ?? 'info';
          const msg = (obj.msg as string) ?? t;
          const rest = Object.fromEntries(
            Object.entries(obj).filter(([k]) => k !== 'level' && k !== 'msg' && k !== 'time'),
          );
          // Rough progress estimation from batch logs
          if (typeof rest.batch === 'string') {
            const [done, total] = rest.batch.split('/').map(Number);
            if (total > 0) {
              const pct = Math.round(15 + (done / total) * 80);
              if (pct > lastProgress) {
                lastProgress = pct;
                onProgress(pct).catch(() => {});
              }
            }
          }
          if (level === 'error') {
            logger.error({ msg: `[IndexerChild] ${msg}`, manualId, ...rest });
          } else if (level === 'warn') {
            logger.warn({ msg: `[IndexerChild] ${msg}`, manualId, ...rest });
          } else {
            logger.info({ msg: `[IndexerChild] ${msg}`, manualId, ...rest });
          }
        } catch {
          logger.info({ msg: `[IndexerChild] ${t}`, manualId });
        }
      }
    });

    // Capture stderr for error reporting
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn index-worker: ${err.message}`));
    });

    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        const reason = signal ? `killed by signal ${signal}` : `exit code ${String(code)}`;
        const details = stderr.slice(-800); // last 800 chars of stderr
        reject(new Error(`index-worker process failed (${reason}): ${details}`));
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────

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

      if (!manualId || !storagePath) {
        throw new Error(`Job ${job.id} is missing manualId or storagePath`);
      }

      logger.info({
        msg: '[ManualIndexerWorker] Job received — spawning child process',
        jobId: job.id,
        manualId,
        storagePath,
      });

      await job.updateProgress(5);

      try {
        await runIndexerProcess(manualId, storagePath, (pct) => job.updateProgress(pct));
      } catch (err) {
        logger.error({
          msg: '[ManualIndexerWorker] Child process failed',
          jobId: job.id,
          manualId,
          err,
        });
        throw err; // BullMQ will retry
      }

      await job.updateProgress(100);
      logger.info({
        msg: '[ManualIndexerWorker] Job completed successfully',
        jobId: job.id,
        manualId,
      });
    },
    {
      connection: redis,
      concurrency: 1,
      // lockDuration must be longer than the worst-case child process runtime.
      // A 500-page PDF with 1100+ chunks ≈ 15 min; set to 25 min.
      lockDuration: 25 * 60 * 1000,
    },
  );

  // ── Global failure handler ──────────────────────────────────────────────
  worker.on('failed', async (job, err) => {
    logger.error({
      msg: '[ManualIndexerWorker] Job exhausted all retries',
      jobId: job?.id,
      manualId: job?.data?.manualId,
      attempts: job?.attemptsMade,
      err,
    });

    if (job?.data?.manualId) {
      try {
        await prisma.standardManual.update({
          where: { id: job.data.manualId },
          data: { chunkCount: 0 },
        });
      } catch (updateErr) {
        logger.error({
          msg: '[ManualIndexerWorker] Failed to update manual status after job failure',
          manualId: job.data.manualId,
          err: updateErr,
        });
      }
    }
  });

  worker.on('error', (err) => {
    logger.error({ msg: '[ManualIndexerWorker] Worker connection error', err });
  });

  globalThis.__manualIndexerWorker = worker;
  return worker;
}
