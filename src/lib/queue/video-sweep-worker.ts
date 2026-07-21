/**
 * BullMQ Worker: Orphaned System-Video Object Sweeper
 *
 * Consumes jobs from the video-sweep-queue (produced on a cron schedule by a
 * BullMQ Job Scheduler). Each run reconciles the `system/videos/` object prefix
 * against the database:
 *
 *   1. List objects under `system/videos/` from ONLY the backend this
 *      environment actively writes to (listFilesForActiveBackend) — never a
 *      merged cross-backend view.
 *   2. Drop anything still inside the grace window (createdAt within the last
 *      gracePeriodMs) — these may belong to an in-flight upload or transcode.
 *   3. Build the referenced-URI set from the three authoritative columns
 *      (Lesson.videoStorageUri, Course.previewVideoStorageUri,
 *      CourseArtifact.storageUri), mirroring scripts/delete-video-courses.ts.
 *   4. Anything older than the grace window AND not in that set is orphaned.
 *   5. Delete the orphans in small batches (per-item failures are isolated).
 *
 * SAFETY (post-incident hardening — prod GCS videos were deleted twice by this
 * sweeper running in a NON-prod environment that held prod GCS credentials):
 *   - OPT-IN: the worker only starts when VIDEO_SWEEP_ENABLED === 'true'. It is
 *     DISABLED by default so a stray non-prod process can never sweep prod.
 *   - SINGLE-BACKEND scope: it lists only the active backend (see step 1), not a
 *     merged GCS+MinIO view that would surface another environment's objects.
 *   - EMPTY-REFERENCE-SET guardrail: if the DB references zero objects while
 *     aged objects exist, it ABORTS (wrong DB / deploy window) — deletes nothing.
 *   - DELETION CAP: if orphan count exceeds VIDEO_SWEEP_MAX_DELETES it ABORTS a
 *     real run entirely (no partial deletes).
 *
 * Note on transcode: scripts/transcode-worker.ts writes a NEW normalized object
 * under `system/videos/normalized/...` and repoints the DB at it. The normalized
 * object is therefore protected (its URI is in the DB), while the original
 * upload becomes unreferenced and is intentionally reclaimed by this sweep once
 * past the grace window. The grace window must comfortably exceed worst-case
 * transcode time (default 24h).
 *
 * Worker lifecycle:
 *   - Singleton per process, stored on globalThis to survive hot-reloads.
 *   - Started lazily from the system layout server component.
 *   - registerRepeatableJob() installs the cron Job Scheduler (idempotent).
 */

import { Worker } from 'bullmq';
import { redis } from './redis';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { listFilesForActiveBackend, deleteFile } from '@/lib/storage';
import {
  VIDEO_SWEEP_QUEUE_NAME,
  videoSweepQueue,
  type VideoSweepJobData,
} from './video-sweep-queue';

declare global {
  var __videoSweepWorker: Worker | undefined;
}

/** Object-key prefix the sweep reconciles. Includes the `normalized/` subtree. */
const SWEEP_PREFIX = 'system/videos/';

/** Stable id for the cron Job Scheduler that produces sweep jobs. */
const SWEEP_SCHEDULER_ID = 'system-video-sweep';

/** How many deletes to fire concurrently per batch. */
const DELETE_BATCH_SIZE = 10;

const DEFAULT_GRACE_PERIOD_HOURS = 24;
const DEFAULT_CRON = '0 */6 * * *';

/** Max orphans a single real (non-dry-run) sweep may delete before aborting. */
const DEFAULT_MAX_DELETES = 10;

export interface VideoSweepOptions {
  /** Objects whose createdAt is within this window are skipped (too new). */
  gracePeriodMs: number;
  /** When true, log what WOULD be deleted but do not delete anything. */
  dryRun: boolean;
}

export interface VideoSweepSummary {
  /** Total objects listed under the prefix. */
  total: number;
  /** Objects skipped because they are still inside the grace window. */
  graceFiltered: number;
  /** Post-grace objects that are referenced in the database (kept). */
  referenced: number;
  /** Post-grace objects that are unreferenced (deletion candidates). */
  orphaned: number;
  /** Orphans actually deleted (always 0 in dry-run). */
  deleted: number;
  /** Orphan deletions that failed. */
  errors: number;
  /**
   * Which safety guardrail aborted the sweep before any deletion, if any.
   * `null` means the sweep ran to completion normally.
   */
  aborted: 'empty-reference-set' | 'delete-cap-exceeded' | null;
}

/**
 * Build the set of storage URIs currently referenced by the database.
 *
 * Mirrors the authoritative model/field list in scripts/delete-video-courses.ts:
 * Lesson.videoStorageUri, Course.previewVideoStorageUri, CourseArtifact.storageUri.
 * Including CourseArtifact is cheap insurance against ever deleting a referenced
 * object even though artifacts are not (currently) stored under system/videos/.
 */
async function buildReferencedUriSet(): Promise<Set<string>> {
  const [lessonVideos, previewVideos, artifacts] = await Promise.all([
    prisma.lesson.findMany({
      where: { videoStorageUri: { not: null } },
      select: { videoStorageUri: true },
    }),
    prisma.course.findMany({
      where: { previewVideoStorageUri: { not: null } },
      select: { previewVideoStorageUri: true },
    }),
    prisma.courseArtifact.findMany({
      select: { storageUri: true },
    }),
  ]);

  const referenced = new Set<string>();
  for (const l of lessonVideos) {
    if (l.videoStorageUri) referenced.add(l.videoStorageUri);
  }
  for (const c of previewVideos) {
    if (c.previewVideoStorageUri) referenced.add(c.previewVideoStorageUri);
  }
  for (const a of artifacts) {
    if (a.storageUri) referenced.add(a.storageUri);
  }
  return referenced;
}

/**
 * Pure, unit-testable sweep. Reads storage + prisma via module imports (tests
 * mock those modules) and returns a structured summary. Never throws on an
 * individual delete failure — those are counted in `errors`.
 */
export async function runVideoSweep(options: VideoSweepOptions): Promise<VideoSweepSummary> {
  const { gracePeriodMs, dryRun } = options;
  const cutoff = Date.now() - gracePeriodMs;

  logger.info({
    msg: '[VideoSweep] Starting sweep',
    prefix: SWEEP_PREFIX,
    gracePeriodMs,
    dryRun,
  });

  const allObjects = await listFilesForActiveBackend(SWEEP_PREFIX);
  const total = allObjects.length;

  // Grace filter: keep only objects older than the cutoff.
  const aged = allObjects.filter((obj) => obj.createdAt.getTime() < cutoff);
  const graceFiltered = total - aged.length;

  const referencedUris = await buildReferencedUriSet();

  // Guardrail: an empty reference set alongside aged objects means the DB we
  // reconciled against does not know about ANY of these objects — the classic
  // signature of running against the wrong database (or mid-deploy). Every aged
  // object would look orphaned, so refuse to sweep. (This is exactly how prod
  // videos were deleted from a non-prod environment.)
  if (referencedUris.size === 0 && aged.length > 0) {
    logger.error({
      msg: `[VideoSweep] ABORT: reference set is empty while ${aged.length} aged objects exist — refusing to sweep (likely wrong DB or deploy window)`,
      total,
      graceFiltered,
      aged: aged.length,
    });
    const abortedSummary: VideoSweepSummary = {
      total,
      graceFiltered,
      referenced: 0,
      orphaned: 0,
      deleted: 0,
      errors: 0,
      aborted: 'empty-reference-set',
    };
    logger.info({ msg: '[VideoSweep] Sweep complete', dryRun, ...abortedSummary });
    return abortedSummary;
  }

  const orphans = aged.filter((obj) => !referencedUris.has(obj.storageUri));
  const referenced = aged.length - orphans.length;

  // Guardrail: a real run that wants to delete more than the configured cap is
  // treated as anomalous — abort entirely rather than perform partial deletes.
  const maxDeletes = resolveMaxDeletes();
  if (!dryRun && orphans.length > maxDeletes) {
    logger.error({
      msg: `[VideoSweep] ABORT: ${orphans.length} orphans exceed delete cap of ${maxDeletes} — refusing to sweep (deleting nothing)`,
      total,
      graceFiltered,
      referenced,
      orphaned: orphans.length,
      maxDeletes,
    });
    const abortedSummary: VideoSweepSummary = {
      total,
      graceFiltered,
      referenced,
      orphaned: orphans.length,
      deleted: 0,
      errors: 0,
      aborted: 'delete-cap-exceeded',
    };
    logger.info({ msg: '[VideoSweep] Sweep complete', dryRun, ...abortedSummary });
    return abortedSummary;
  }

  let deleted = 0;
  let errors = 0;

  if (dryRun) {
    for (const orphan of orphans) {
      logger.info({
        msg: '[VideoSweep] DRY RUN — would delete orphan',
        storageUri: orphan.storageUri,
      });
    }
  } else {
    for (let i = 0; i < orphans.length; i += DELETE_BATCH_SIZE) {
      const batch = orphans.slice(i, i + DELETE_BATCH_SIZE);
      await Promise.all(
        batch.map(async (orphan) => {
          try {
            await deleteFile(orphan.storageUri);
            deleted += 1;
            logger.info({ msg: '[VideoSweep] Deleted orphan', storageUri: orphan.storageUri });
          } catch (err) {
            errors += 1;
            logger.error({
              msg: '[VideoSweep] Failed to delete orphan',
              storageUri: orphan.storageUri,
              err,
            });
          }
        }),
      );
    }
  }

  const summary: VideoSweepSummary = {
    total,
    graceFiltered,
    referenced,
    orphaned: orphans.length,
    deleted,
    errors,
    aborted: null,
  };

  logger.info({ msg: '[VideoSweep] Sweep complete', dryRun, ...summary });
  return summary;
}

/** Reads VIDEO_SWEEP_GRACE_PERIOD_HOURS (default 24h) → milliseconds. */
function resolveGracePeriodMs(): number {
  const hours = Number(process.env.VIDEO_SWEEP_GRACE_PERIOD_HOURS);
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_GRACE_PERIOD_HOURS;
  return safeHours * 60 * 60 * 1000;
}

/** Reads VIDEO_SWEEP_DRY_RUN (default false). */
function resolveDryRun(): boolean {
  return process.env.VIDEO_SWEEP_DRY_RUN === 'true';
}

/** Reads VIDEO_SWEEP_MAX_DELETES (default 10). Guards against mass deletion. */
function resolveMaxDeletes(): number {
  const cap = Number(process.env.VIDEO_SWEEP_MAX_DELETES);
  return Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_MAX_DELETES;
}

/**
 * Install (or update) the cron Job Scheduler that enqueues sweep jobs.
 *
 * BullMQ 5.71.x: uses the Job Scheduler API (upsertJobScheduler /
 * getJobSchedulers / removeJobScheduler) — the replacement for the deprecated
 * repeatable-jobs API (getRepeatableJobs / removeRepeatableByKey, removed in
 * v6). We first remove any pre-existing scheduler under our id so a changed
 * cron pattern can never leave a stale schedule behind, then upsert the current
 * one.
 */
async function registerRepeatableJob(cron: string): Promise<void> {
  try {
    const existing = await videoSweepQueue.getJobSchedulers();
    await Promise.all(
      existing
        .filter((s) => s.id === SWEEP_SCHEDULER_ID)
        .map((s) => videoSweepQueue.removeJobScheduler(s.id as string)),
    );

    await videoSweepQueue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { pattern: cron },
      { name: 'sweep' },
    );

    logger.info({ msg: '[VideoSweep] Registered repeatable sweep schedule', cron });
  } catch (err) {
    logger.error({ msg: '[VideoSweep] Failed to register repeatable sweep schedule', cron, err });
  }
}

/**
 * Returns the singleton sweep worker, creating it on first call. The sweeper is
 * OPT-IN: it starts ONLY when VIDEO_SWEEP_ENABLED === 'true'. Any other value
 * (unset, 'false', or anything else) leaves it disabled and additionally
 * best-effort removes any lingering cron Job Scheduler so a previously-enabled
 * environment stops enqueuing sweep jobs. Returns null when disabled. Safe to
 * call repeatedly.
 *
 * WHY opt-in: prod GCS videos were deleted twice by this sweeper running in a
 * non-prod environment that held prod credentials. Defaulting to disabled means
 * a stray process can never sweep unless someone deliberately enables it.
 */
export function getVideoSweepWorker(): Worker | null {
  if (globalThis.__videoSweepWorker) {
    return globalThis.__videoSweepWorker;
  }

  if (process.env.VIDEO_SWEEP_ENABLED !== 'true') {
    logger.warn({
      msg: "[VideoSweep] Disabled (VIDEO_SWEEP_ENABLED !== 'true') — worker not started",
    });
    // Best-effort: tear down any scheduler a previously-enabled deploy left
    // behind so this environment stops producing sweep jobs. Fire-and-forget.
    void videoSweepQueue.removeJobScheduler(SWEEP_SCHEDULER_ID).catch((err) => {
      logger.error({
        msg: '[VideoSweep] Failed to remove lingering Job Scheduler while disabled',
        schedulerId: SWEEP_SCHEDULER_ID,
        err,
      });
    });
    return null;
  }

  const cron = process.env.VIDEO_SWEEP_CRON || DEFAULT_CRON;
  const dryRun = resolveDryRun();

  logger.info({
    msg: '[VideoSweep] Starting worker',
    cron,
    gracePeriodHours:
      Number(process.env.VIDEO_SWEEP_GRACE_PERIOD_HOURS) || DEFAULT_GRACE_PERIOD_HOURS,
    dryRun,
  });

  const worker = new Worker<VideoSweepJobData, VideoSweepSummary>(
    VIDEO_SWEEP_QUEUE_NAME,
    // Return the summary so BullMQ persists it as the job's returnvalue (the
    // deleted/aborted counts stay auditable in Redis).
    async () => {
      return runVideoSweep({ gracePeriodMs: resolveGracePeriodMs(), dryRun: resolveDryRun() });
    },
    {
      connection: redis,
      concurrency: 1,
      // A full prefix list + batched deletes can take a while on a large bucket.
      lockDuration: 10 * 60 * 1000,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ msg: '[VideoSweep] Sweep job failed', jobId: job?.id, err });
  });

  worker.on('error', (err) => {
    logger.error({ msg: '[VideoSweep] Worker connection error', err });
  });

  // Install the cron schedule (idempotent, fire-and-forget).
  void registerRepeatableJob(cron);

  globalThis.__videoSweepWorker = worker;
  return worker;
}
