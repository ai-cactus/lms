/**
 * BullMQ Worker: Course Video Transcoder
 *
 * Consumes jobs from the video-transcode-queue. For each job it spawns
 * scripts/transcode-worker.ts (via `node --import tsx`) as a CHILD PROCESS so
 * the CPU-heavy ffmpeg encode runs in its own process, isolated from the
 * Next.js server (mirrors the manual-indexer-worker pattern).
 *
 * Worker lifecycle:
 *   - Singleton per process, stored on globalThis to survive hot-reloads.
 *   - Started lazily from the system layout server component.
 *   - Concurrency 1 — one ffmpeg encode at a time on a small VM.
 */

import { join } from 'path';
import {
  spawn,
  type SpawnOptionsWithStdioTuple,
  type StdioNull,
  type StdioPipe,
} from 'child_process';
import { Worker } from 'bullmq';
import { redis } from './redis';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  invalidateCoursePreviewMeta,
  invalidateLessonPlaybackMeta,
} from '@/lib/video/playback-cache';
import { VIDEO_TRANSCODE_QUEUE_NAME, type VideoTranscodeJobData } from './video-transcode-queue';

declare global {
  var __videoTranscodeWorker: Worker | undefined;
}

const WORKER_SCRIPT = join(process.cwd(), 'scripts', 'transcode-worker.ts');

/**
 * Spawns scripts/transcode-worker.ts (via `node --import tsx`) and resolves
 * when it exits 0. stdout lines are JSON log objects re-emitted via the server
 * logger.
 *
 * The child is launched through `nice -n 19` so the ffmpeg encode it runs (a
 * grandchild, which inherits the niceness) always yields CPU to the Next.js
 * server it shares a container with — the app runs as a single container on a
 * 2-vCPU VM under a 1 GB memory limit, so an un-niced encode starves SSR.
 * `renice` is only false on the ENOENT retry below.
 */
function runTranscodeProcess(data: VideoTranscodeJobData, renice = true): Promise<void> {
  return new Promise((resolve, reject) => {
    const nodeArgs = [
      '--import',
      'tsx',
      WORKER_SCRIPT,
      `--target-type=${data.targetType}`,
      `--target-id=${data.targetId}`,
      `--storage-uri=${data.storageUri}`,
    ];
    const spawnOptions: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe> = {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    };

    const child = renice
      ? spawn('nice', ['-n', '19', process.execPath, ...nodeArgs], spawnOptions)
      : spawn(process.execPath, nodeArgs, spawnOptions);

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

    child.on('error', (err) => {
      // `nice` is coreutils, an Essential package on Debian and therefore always
      // present in the node:20-slim image this ships in — so this should never
      // fire. If a runtime image somehow lacks it, degrade to an un-niced encode
      // rather than failing the job and flipping mediaStatus to failed.
      if (renice && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.warn({ msg: '[VideoTranscodeWorker] `nice` unavailable — encoding un-niced' });
        runTranscodeProcess(data, false).then(resolve, reject);
        return;
      }
      reject(err);
    });
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

      // The child process repointed the row at the normalized object, so the
      // proxy's cached meta now names the pre-transcode URI. Invalidate HERE
      // rather than in scripts/transcode-worker.ts: the playback cache is
      // in-process, and the script runs in a separate process where evicting
      // would be a no-op. This job handler runs inside the web process, which
      // is the one serving the proxy.
      if (targetType === 'lesson') invalidateLessonPlaybackMeta(targetId);
      else invalidateCoursePreviewMeta(targetId);

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
