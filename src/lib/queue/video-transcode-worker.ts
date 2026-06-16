/**
 * BullMQ Worker: Course Video Transcoder
 *
 * Consumes jobs from the video-transcode-queue. For each job it spawns
 * scripts/transcode-worker.mjs as a CHILD PROCESS so the CPU-heavy ffmpeg
 * encode runs in its own process, isolated from the Next.js server (mirrors
 * the manual-indexer-worker pattern).
 *
 * Worker lifecycle:
 *   - Singleton per process, stored on globalThis to survive hot-reloads.
 *   - Started lazily from the system layout server component.
 *   - Concurrency 1 — one ffmpeg encode at a time on a small VM.
 */

import { join } from 'path';
import { spawn } from 'child_process';
import { Worker } from 'bullmq';
import { redis } from './redis';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { VIDEO_TRANSCODE_QUEUE_NAME, type VideoTranscodeJobData } from './video-transcode-queue';

declare global {
  var __videoTranscodeWorker: Worker | undefined;
}

const WORKER_SCRIPT = join(process.cwd(), 'scripts', 'transcode-worker.mjs');

/**
 * Spawns scripts/transcode-worker.mjs and resolves when it exits 0.
 * stdout lines are JSON log objects re-emitted via the server logger.
 */
function runTranscodeProcess(data: VideoTranscodeJobData): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        WORKER_SCRIPT,
        `--target-type=${data.targetType}`,
        `--target-id=${data.targetId}`,
        `--storage-uri=${data.storageUri}`,
      ],
      { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t) as { level?: string; msg?: string };
          logger.info({ msg: obj.msg ?? t, child: 'transcode-worker', level: obj.level });
        } catch {
          logger.info({ msg: t, child: 'transcode-worker' });
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`transcode-worker exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

export function getVideoTranscodeWorker(): Worker {
  if (globalThis.__videoTranscodeWorker) {
    return globalThis.__videoTranscodeWorker;
  }

  logger.info({ msg: '[VideoTranscodeWorker] Starting worker' });

  const worker = new Worker<VideoTranscodeJobData>(
    VIDEO_TRANSCODE_QUEUE_NAME,
    async (job) => {
      const { targetType, targetId, storageUri } = job.data;
      if (!targetType || !targetId || !storageUri) {
        throw new Error(`Job ${job.id} is missing target fields`);
      }

      logger.info({
        msg: '[VideoTranscodeWorker] Job received — spawning child process',
        jobId: job.id,
        targetType,
        targetId,
      });

      await job.updateProgress(5);
      await runTranscodeProcess(job.data);
      await job.updateProgress(100);

      logger.info({ msg: '[VideoTranscodeWorker] Job completed', jobId: job.id, targetId });
    },
    {
      connection: redis,
      concurrency: 1,
      // ffmpeg encode of a long video can take many minutes; give it ample lock.
      lockDuration: 30 * 60 * 1000,
    },
  );

  worker.on('failed', async (job, err) => {
    logger.error({
      msg: '[VideoTranscodeWorker] Job exhausted all retries',
      jobId: job?.id,
      targetId: job?.data?.targetId,
      attempts: job?.attemptsMade,
      err,
    });

    // Surface the failure in the UI so the uploader knows normalization didn't
    // complete (the raw upload still plays, just un-normalized).
    const data = job?.data;
    if (data?.targetId) {
      try {
        if (data.targetType === 'lesson') {
          await prisma.lesson.update({
            where: { id: data.targetId },
            data: { mediaStatus: 'failed' },
          });
        } else {
          await prisma.course.update({
            where: { id: data.targetId },
            data: { previewMediaStatus: 'failed' },
          });
        }
      } catch (updateErr) {
        logger.error({
          msg: '[VideoTranscodeWorker] Failed to mark media status failed',
          targetId: data.targetId,
          err: updateErr,
        });
      }
    }
  });

  worker.on('error', (err) => {
    logger.error({ msg: '[VideoTranscodeWorker] Worker connection error', err });
  });

  globalThis.__videoTranscodeWorker = worker;
  return worker;
}
