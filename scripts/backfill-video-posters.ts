#!/usr/bin/env node
/**
 * Backfill poster stills for videos that predate poster generation.
 *
 * scripts/transcode-worker.ts now extracts a JPEG still from every video it
 * normalizes, and the catalog card / player render it instead of mounting a
 * `<video preload="metadata">` purely to paint a frame. Assets transcoded before
 * that have `videoPosterStorageUri` / `previewPosterStorageUri` NULL, so their
 * poster routes 404 and the UI falls back to a placeholder. This one-off fills
 * them in.
 *
 * The source video is NEVER downloaded in full: ffmpeg is pointed at the storage
 * signed URL and issues its own Range requests, and `-ss` before `-i` is an
 * input seek, so it reads little more than the header plus one keyframe.
 *
 * Run this MANUALLY, off-hours. It is safe to re-run: rows that already have a
 * poster are skipped, so an interrupted run resumes where it stopped.
 *
 * Usage:
 *   npx tsx scripts/backfill-video-posters.ts              # dry-run (default)
 *   npx tsx scripts/backfill-video-posters.ts --apply      # actually write
 *   npx tsx scripts/backfill-video-posters.ts --apply --limit=25
 *
 * Flags:
 *   --apply     Perform the extraction, upload and DB write. Without it nothing
 *               is read from storage and nothing is written.
 *   --limit=N   Process at most N lessons and N course previews.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { prisma } from '@/db/index';
import { getSignedUrl, uploadFile } from '@/lib/storage';
import { buildPosterArgs } from '@/lib/video/encoding';
import { logger } from '@/lib/logger';

const execFileP = promisify(execFile);

const APPLY = process.argv.includes('--apply');

/**
 * Signed-URL lifetime for the ffmpeg read. Generous because a large source over
 * a slow link still has to complete its Range reads within the window.
 */
const SIGNED_URL_TTL_SECONDS = 900;

/**
 * Pause between assets. This runs against the same storage backend and database
 * the live app uses, so the backfill deliberately trickles rather than saturating
 * either.
 */
const DELAY_MS = 500;

function parseLimit(): number | null {
  const raw = process.argv.find((a) => a.startsWith('--limit='));
  if (!raw) return null;
  const value = Number.parseInt(raw.slice('--limit='.length), 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    /* ignore */
  }
}

/**
 * Extracts a poster from `videoStorageUri` and uploads it, returning the new
 * storage URI. Throws on failure so the caller can count it and move on — one
 * unreadable asset must not end the run.
 */
async function extractAndUploadPoster(
  videoStorageUri: string,
  durationSeconds: number | null,
): Promise<string> {
  const posterPath = join(tmpdir(), `backfill-poster-${randomUUID()}.jpg`);
  try {
    const signedUrl = await getSignedUrl(videoStorageUri, SIGNED_URL_TTL_SECONDS);
    await execFileP('ffmpeg', buildPosterArgs(signedUrl, posterPath, durationSeconds), {
      maxBuffer: 1024 * 1024 * 8,
    });
    const buffer = await readFile(posterPath);
    const key = `system/videos/posters/${Date.now()}-${randomUUID()}.jpg`;
    const uploaded = await uploadFile(key, buffer, 'image/jpeg');
    return uploaded.storageUri;
  } finally {
    await safeUnlink(posterPath);
  }
}

interface Counts {
  processed: number;
  failed: number;
}

async function backfillLessons(limit: number | null): Promise<Counts> {
  const lessons = await prisma.lesson.findMany({
    where: { videoStorageUri: { not: null }, videoPosterStorageUri: null },
    select: { id: true, videoStorageUri: true, videoDurationSeconds: true },
    orderBy: { createdAt: 'asc' },
    ...(limit ? { take: limit } : {}),
  });

  logger.info({ msg: '[backfill-posters] Lessons needing a poster', count: lessons.length });

  const counts: Counts = { processed: 0, failed: 0 };
  for (const lesson of lessons) {
    // Narrowed by the query, but the type is nullable.
    if (!lesson.videoStorageUri) continue;

    if (!APPLY) {
      logger.info({ msg: '[backfill-posters] Would backfill lesson poster', lessonId: lesson.id });
      counts.processed += 1;
      continue;
    }

    try {
      const posterUri = await extractAndUploadPoster(
        lesson.videoStorageUri,
        lesson.videoDurationSeconds,
      );
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: { videoPosterStorageUri: posterUri },
      });
      counts.processed += 1;
      logger.info({ msg: '[backfill-posters] Lesson poster set', lessonId: lesson.id, posterUri });
    } catch (err) {
      counts.failed += 1;
      logger.error({ msg: '[backfill-posters] Lesson poster failed', err, lessonId: lesson.id });
    }

    await sleep(DELAY_MS);
  }

  return counts;
}

async function backfillCoursePreviews(limit: number | null): Promise<Counts> {
  const courses = await prisma.course.findMany({
    where: { previewVideoStorageUri: { not: null }, previewPosterStorageUri: null },
    select: {
      id: true,
      previewVideoStorageUri: true,
      previewVideoDurationSeconds: true,
    },
    orderBy: { createdAt: 'asc' },
    ...(limit ? { take: limit } : {}),
  });

  logger.info({
    msg: '[backfill-posters] Course previews needing a poster',
    count: courses.length,
  });

  const counts: Counts = { processed: 0, failed: 0 };
  for (const course of courses) {
    if (!course.previewVideoStorageUri) continue;

    if (!APPLY) {
      logger.info({
        msg: '[backfill-posters] Would backfill course preview poster',
        courseId: course.id,
      });
      counts.processed += 1;
      continue;
    }

    try {
      const posterUri = await extractAndUploadPoster(
        course.previewVideoStorageUri,
        course.previewVideoDurationSeconds,
      );
      await prisma.course.update({
        where: { id: course.id },
        data: { previewPosterStorageUri: posterUri },
      });
      counts.processed += 1;
      logger.info({
        msg: '[backfill-posters] Course preview poster set',
        courseId: course.id,
        posterUri,
      });
    } catch (err) {
      counts.failed += 1;
      logger.error({
        msg: '[backfill-posters] Course preview poster failed',
        err,
        courseId: course.id,
      });
    }

    await sleep(DELAY_MS);
  }

  return counts;
}

async function main(): Promise<void> {
  const limit = parseLimit();
  logger.info({
    msg: '[backfill-posters] Starting',
    mode: APPLY ? 'apply' : 'dry-run',
    limit,
  });

  try {
    const lessons = await backfillLessons(limit);
    const previews = await backfillCoursePreviews(limit);

    logger.info({
      msg: '[backfill-posters] Complete',
      mode: APPLY ? 'apply' : 'dry-run',
      lessonsProcessed: lessons.processed,
      lessonsFailed: lessons.failed,
      previewsProcessed: previews.processed,
      previewsFailed: previews.failed,
    });

    if (!APPLY) {
      logger.info({
        msg: '[backfill-posters] Dry run — re-run with --apply to write these posters',
      });
    }

    // A partial run must be visible to whoever invoked it, not just in the logs.
    if (lessons.failed + previews.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  logger.error({ msg: '[backfill-posters] Fatal', err });
  process.exit(1);
});
