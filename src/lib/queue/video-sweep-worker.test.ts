/**
 * Unit tests for video-sweep-worker.ts.
 *
 * runVideoSweep() covered:
 *   - All objects inside the grace window → zero deletes, graceFiltered = total
 *   - Objects spanning the grace boundary → only aged candidates processed
 *   - All three DB columns protect a URI: lesson.videoStorageUri,
 *     course.previewVideoStorageUri, courseArtifact.storageUri (correction guard)
 *   - Old unreferenced objects → deleteFile called, deleted counted
 *   - Dry-run → deleteFile not called, would-delete logged, orphaned still counted
 *   - deleteFile throws for one of several orphans → errors counted, others deleted,
 *     no throw from runVideoSweep
 *   - Normalized-path realism: normalized URI protected, original URI reclaimed
 *   - Empty-reference-set guardrail: aged objects exist but DB refs are empty →
 *     abort, zero deletions, aborted='empty-reference-set', error logged
 *   - Delete-cap guardrail: orphans > VIDEO_SWEEP_MAX_DELETES (non-dry-run) →
 *     abort, zero deletions, aborted='delete-cap-exceeded', error logged
 *   - Delete-cap respected via env override, incl. defensive parse fallback for
 *     invalid values
 *   - Orphans <= cap → normal deletion, aborted=null
 *   - Dry-run with orphans > cap → NOT aborted, still deletes nothing
 *
 * getVideoSweepWorker() covered:
 *   - VIDEO_SWEEP_ENABLED unset/'false'/other → returns null, no Worker
 *     constructed, removeJobScheduler called (best-effort teardown)
 *   - VIDEO_SWEEP_ENABLED='true' → Worker constructed
 *   - Singleton: second call returns same instance, Worker constructed only once
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  MockWorker,
  mockListFilesForActiveBackend,
  mockDeleteFile,
  mockLessonFindMany,
  mockCourseFindMany,
  mockCourseArtifactFindMany,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
  mockVideoSweepQueue,
} = vi.hoisted(() => {
  const mockListFilesForActiveBackend = vi.fn();
  const mockDeleteFile = vi.fn();
  const mockLessonFindMany = vi.fn();
  const mockCourseFindMany = vi.fn();
  const mockCourseArtifactFindMany = vi.fn();
  const mockLoggerInfo = vi.fn();
  const mockLoggerWarn = vi.fn();
  const mockLoggerError = vi.fn();

  // videoSweepQueue mock — the sweep worker calls getJobSchedulers() /
  // removeJobScheduler() / upsertJobScheduler() in registerRepeatableJob().
  const mockVideoSweepQueue = {
    getJobSchedulers: vi.fn().mockResolvedValue([]),
    removeJobScheduler: vi.fn().mockResolvedValue(undefined),
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
  };

  // Worker constructor must be a regular function to support `new`.
  const MockWorker = vi.fn(function (this: Record<string, unknown>) {
    this.on = vi.fn();
  });

  return {
    MockWorker,
    mockListFilesForActiveBackend,
    mockDeleteFile,
    mockLessonFindMany,
    mockCourseFindMany,
    mockCourseArtifactFindMany,
    mockLoggerInfo,
    mockLoggerWarn,
    mockLoggerError,
    mockVideoSweepQueue,
  };
});

vi.mock('bullmq', () => ({ Worker: MockWorker }));
vi.mock('@/lib/queue/redis', () => ({ redis: {} }));
vi.mock('@/lib/queue/video-sweep-queue', () => ({
  VIDEO_SWEEP_QUEUE_NAME: 'video-sweep-queue',
  videoSweepQueue: mockVideoSweepQueue,
}));
vi.mock('@/lib/storage', () => ({
  listFilesForActiveBackend: mockListFilesForActiveBackend,
  deleteFile: mockDeleteFile,
}));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    lesson: { findMany: mockLessonFindMany },
    course: { findMany: mockCourseFindMany },
    courseArtifact: { findMany: mockCourseArtifactFindMany },
  };
  return { default: prisma, prisma };
});
vi.mock('@/lib/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

import { runVideoSweep, getVideoSweepWorker } from './video-sweep-worker';
import type { Worker } from 'bullmq';

// Fixed epoch used across all sweep tests for deterministic grace-period math.
const NOW_MS = 1_720_000_000_000; // 2024-07-03T11:06:40.000Z
const GRACE_MS = 60 * 60 * 1000; // 1 hour

/** A date clearly older than the grace cutoff. */
const OLD = new Date(NOW_MS - GRACE_MS - 60_000); // 61 min ago

/** A date clearly inside the grace window. */
const YOUNG = new Date(NOW_MS - GRACE_MS + 60_000); // 59 min ago

function setupEmptyRefs() {
  mockLessonFindMany.mockResolvedValue([]);
  mockCourseFindMany.mockResolvedValue([]);
  mockCourseArtifactFindMany.mockResolvedValue([]);
}

/**
 * A non-empty reference set that does not overlap with any URI under test.
 * Use this (instead of setupEmptyRefs) whenever the test lists aged objects
 * but is not itself exercising the empty-reference-set guardrail — an empty
 * DB reference set alongside aged objects now aborts the sweep entirely.
 */
function setupUnrelatedRef() {
  mockLessonFindMany.mockResolvedValue([
    { videoStorageUri: 'gcs://b/system/videos/unrelated-keepalive.mp4' },
  ]);
  mockCourseFindMany.mockResolvedValue([]);
  mockCourseArtifactFindMany.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  mockDeleteFile.mockResolvedValue(undefined);
  // Clear the Worker singleton so getVideoSweepWorker tests start clean.
  delete (globalThis as unknown as { __videoSweepWorker?: Worker }).__videoSweepWorker;
});

afterEach(() => {
  vi.useRealTimers();
  // Also clear after each test so singleton state does not bleed across.
  delete (globalThis as unknown as { __videoSweepWorker?: Worker }).__videoSweepWorker;
  delete process.env.VIDEO_SWEEP_ENABLED;
  delete process.env.VIDEO_SWEEP_MAX_DELETES;
});

describe('runVideoSweep', () => {
  describe('grace filter', () => {
    it('all objects younger than grace → graceFiltered=total, zero deletes', async () => {
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/a.mp4', createdAt: YOUNG },
        { storageUri: 'gcs://b/system/videos/b.mp4', createdAt: YOUNG },
      ]);
      setupEmptyRefs();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.total).toBe(2);
      expect(summary.graceFiltered).toBe(2);
      expect(summary.orphaned).toBe(0);
      expect(summary.deleted).toBe(0);
      expect(summary.errors).toBe(0);
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    it('objects spanning the grace boundary — only the aged one becomes a candidate', async () => {
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/old.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/young.mp4', createdAt: YOUNG },
      ]);
      setupUnrelatedRef();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.total).toBe(2);
      expect(summary.graceFiltered).toBe(1);
      expect(summary.orphaned).toBe(1);
      // Only the aged, unreferenced object is deleted.
      expect(mockDeleteFile).toHaveBeenCalledOnce();
      expect(mockDeleteFile).toHaveBeenCalledWith('gcs://b/system/videos/old.mp4');
    });
  });

  describe('three-column reference-set', () => {
    it('protects URIs found in lesson.videoStorageUri', async () => {
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/lesson.mp4', createdAt: OLD },
      ]);
      mockLessonFindMany.mockResolvedValue([
        { videoStorageUri: 'gcs://b/system/videos/lesson.mp4' },
      ]);
      mockCourseFindMany.mockResolvedValue([]);
      mockCourseArtifactFindMany.mockResolvedValue([]);

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.referenced).toBe(1);
      expect(summary.orphaned).toBe(0);
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    it('protects URIs found in course.previewVideoStorageUri', async () => {
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/preview.mp4', createdAt: OLD },
      ]);
      mockLessonFindMany.mockResolvedValue([]);
      mockCourseFindMany.mockResolvedValue([
        { previewVideoStorageUri: 'gcs://b/system/videos/preview.mp4' },
      ]);
      mockCourseArtifactFindMany.mockResolvedValue([]);

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.referenced).toBe(1);
      expect(summary.orphaned).toBe(0);
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    it('protects URIs referenced ONLY via courseArtifact.storageUri (correction guard)', async () => {
      // This is the critical third-column test: a URI not in lesson or course
      // but only in courseArtifact must NOT be deleted.
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/artifact-only.mp4', createdAt: OLD },
      ]);
      mockLessonFindMany.mockResolvedValue([]);
      mockCourseFindMany.mockResolvedValue([]);
      mockCourseArtifactFindMany.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/artifact-only.mp4' },
      ]);

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.referenced).toBe(1);
      expect(summary.orphaned).toBe(0);
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    it('deletes only the unreferenced object when several are listed alongside referenced ones', async () => {
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/lesson.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/preview.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/artifact.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/orphan.mp4', createdAt: OLD },
      ]);
      mockLessonFindMany.mockResolvedValue([
        { videoStorageUri: 'gcs://b/system/videos/lesson.mp4' },
      ]);
      mockCourseFindMany.mockResolvedValue([
        { previewVideoStorageUri: 'gcs://b/system/videos/preview.mp4' },
      ]);
      mockCourseArtifactFindMany.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/artifact.mp4' },
      ]);

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.referenced).toBe(3);
      expect(summary.orphaned).toBe(1);
      expect(summary.deleted).toBe(1);
      expect(mockDeleteFile).toHaveBeenCalledWith('gcs://b/system/videos/orphan.mp4');
      // Referenced objects must not be deleted.
      expect(mockDeleteFile).not.toHaveBeenCalledWith('gcs://b/system/videos/lesson.mp4');
      expect(mockDeleteFile).not.toHaveBeenCalledWith('gcs://b/system/videos/preview.mp4');
      expect(mockDeleteFile).not.toHaveBeenCalledWith('gcs://b/system/videos/artifact.mp4');
    });
  });

  describe('deletion', () => {
    it('calls deleteFile for an old unreferenced object and counts deleted=1', async () => {
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/unwanted.mp4', createdAt: OLD },
      ]);
      setupUnrelatedRef();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.deleted).toBe(1);
      expect(summary.errors).toBe(0);
      expect(summary.aborted).toBeNull();
      expect(mockDeleteFile).toHaveBeenCalledWith('gcs://b/system/videos/unwanted.mp4');
    });

    it('dry-run: does NOT call deleteFile, reports orphaned count, logs would-delete', async () => {
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/dryorphan.mp4', createdAt: OLD },
      ]);
      setupUnrelatedRef();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: true });

      expect(summary.orphaned).toBe(1);
      expect(summary.deleted).toBe(0);
      expect(mockDeleteFile).not.toHaveBeenCalled();
      // A dry-run info log should mention would-delete.
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: expect.stringContaining('DRY RUN'),
          storageUri: 'gcs://b/system/videos/dryorphan.mp4',
        }),
      );
    });

    it('deleteFile throws for one orphan → errors=1, others still deleted, no throw', async () => {
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/fails.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/succeeds.mp4', createdAt: OLD },
      ]);
      setupUnrelatedRef();

      // First call rejects; subsequent calls resolve.
      mockDeleteFile.mockRejectedValueOnce(new Error('storage error')).mockResolvedValue(undefined);

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      // One deletion failed, one succeeded; summary reflects both.
      expect(summary.orphaned).toBe(2);
      expect(summary.errors).toBe(1);
      expect(summary.deleted).toBe(1);
      // runVideoSweep must not throw even when a deletion fails.
    });

    it('errors count accumulates correctly across multiple failures', async () => {
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/err1.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/err2.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/ok.mp4', createdAt: OLD },
      ]);
      setupUnrelatedRef();

      mockDeleteFile
        .mockRejectedValueOnce(new Error('e1'))
        .mockRejectedValueOnce(new Error('e2'))
        .mockResolvedValue(undefined);

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.errors).toBe(2);
      expect(summary.deleted).toBe(1);
    });
  });

  describe('normalized-path realism (transcode lifecycle)', () => {
    it('protects normalized URI (DB-referenced post-transcode) and reclaims the original', async () => {
      // After transcode, DB points to the normalized URI; the original upload
      // URI is unreferenced and old — the sweep should reclaim it.
      const normalizedUri = 'gcs://b/system/videos/normalized/2024-lecture.mp4';
      const originalUri = 'gcs://b/system/videos/1720000000000-lecture.mp4';

      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: normalizedUri, createdAt: OLD },
        { storageUri: originalUri, createdAt: OLD },
      ]);
      mockLessonFindMany.mockResolvedValue([{ videoStorageUri: normalizedUri }]);
      mockCourseFindMany.mockResolvedValue([]);
      mockCourseArtifactFindMany.mockResolvedValue([]);

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.referenced).toBe(1);
      expect(summary.orphaned).toBe(1);
      expect(summary.deleted).toBe(1);
      // Original superseded by transcode → reclaimed.
      expect(mockDeleteFile).toHaveBeenCalledWith(originalUri);
      // Normalized (DB-referenced) → protected.
      expect(mockDeleteFile).not.toHaveBeenCalledWith(normalizedUri);
    });
  });

  describe('summary shape', () => {
    it('returns a complete VideoSweepSummary with all expected keys', async () => {
      mockListFilesForActiveBackend.mockResolvedValue([]);
      setupEmptyRefs();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary).toMatchObject({
        total: expect.any(Number),
        graceFiltered: expect.any(Number),
        referenced: expect.any(Number),
        orphaned: expect.any(Number),
        deleted: expect.any(Number),
        errors: expect.any(Number),
        aborted: null,
      });
    });

    it('total = graceFiltered + aged objects processed', async () => {
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/old.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/young.mp4', createdAt: YOUNG },
      ]);
      setupUnrelatedRef();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.total).toBe(summary.graceFiltered + summary.referenced + summary.orphaned);
    });
  });

  describe('empty-reference-set guardrail', () => {
    it('aborts when aged objects exist but the DB reference set is empty', async () => {
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/prod-video-1.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/prod-video-2.mp4', createdAt: OLD },
      ]);
      setupEmptyRefs();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.aborted).toBe('empty-reference-set');
      expect(summary.deleted).toBe(0);
      expect(summary.orphaned).toBe(0);
      expect(summary.referenced).toBe(0);
      expect(mockDeleteFile).not.toHaveBeenCalled();
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: expect.stringContaining('ABORT'),
        }),
      );
    });

    it('does not abort when the reference set is empty but no aged objects exist', async () => {
      // Only young (in-grace) objects — nothing to evaluate against the DB yet,
      // so the empty-reference-set signature does not apply.
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/fresh.mp4', createdAt: YOUNG },
      ]);
      setupEmptyRefs();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.aborted).toBeNull();
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    it('applies even in dry-run — an empty reference set aborts before the dry-run log branch', async () => {
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/prod-video.mp4', createdAt: OLD },
      ]);
      setupEmptyRefs();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: true });

      expect(summary.aborted).toBe('empty-reference-set');
      expect(summary.orphaned).toBe(0);
    });
  });

  describe('delete-cap guardrail', () => {
    it('aborts a non-dry-run sweep when orphans exceed the default cap of 10', async () => {
      const objects = Array.from({ length: 11 }, (_, i) => ({
        storageUri: `gcs://b/system/videos/orphan-${i}.mp4`,
        createdAt: OLD,
      }));
      mockListFilesForActiveBackend.mockResolvedValue(objects);
      setupEmptyRefs();
      // Give it a non-empty (unrelated) reference so the empty-ref guardrail
      // doesn't fire first and mask the cap guardrail under test.
      mockLessonFindMany.mockResolvedValue([
        { videoStorageUri: 'gcs://b/system/videos/unrelated-keepalive.mp4' },
      ]);

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.aborted).toBe('delete-cap-exceeded');
      expect(summary.orphaned).toBe(11);
      expect(summary.deleted).toBe(0);
      expect(mockDeleteFile).not.toHaveBeenCalled();
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: expect.stringContaining('ABORT'),
        }),
      );
    });

    it('respects VIDEO_SWEEP_MAX_DELETES override — aborts at a lower cap', async () => {
      process.env.VIDEO_SWEEP_MAX_DELETES = '2';
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/o1.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/o2.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/o3.mp4', createdAt: OLD },
      ]);
      setupUnrelatedRef();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.aborted).toBe('delete-cap-exceeded');
      expect(summary.orphaned).toBe(3);
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    it('orphan count exactly at the cap still deletes normally (cap is exclusive)', async () => {
      process.env.VIDEO_SWEEP_MAX_DELETES = '2';
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/o1.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/o2.mp4', createdAt: OLD },
      ]);
      setupUnrelatedRef();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.aborted).toBeNull();
      expect(summary.deleted).toBe(2);
      expect(mockDeleteFile).toHaveBeenCalledTimes(2);
    });

    it('orphans below the cap still delete normally with aborted=null', async () => {
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/o1.mp4', createdAt: OLD },
      ]);
      setupUnrelatedRef();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.aborted).toBeNull();
      expect(summary.deleted).toBe(1);
      expect(mockDeleteFile).toHaveBeenCalledWith('gcs://b/system/videos/o1.mp4');
    });

    it('falls back to the default cap for a non-numeric VIDEO_SWEEP_MAX_DELETES (defensive parse)', async () => {
      process.env.VIDEO_SWEEP_MAX_DELETES = 'not-a-number';
      // 5 orphans is under the default cap (10), so the sweep should proceed
      // normally rather than aborting — proving the invalid value fell back
      // to the default instead of e.g. parsing as 0 (which would abort here).
      const objects = Array.from({ length: 5 }, (_, i) => ({
        storageUri: `gcs://b/system/videos/orphan-${i}.mp4`,
        createdAt: OLD,
      }));
      mockListFilesForActiveBackend.mockResolvedValue(objects);
      setupUnrelatedRef();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.aborted).toBeNull();
      expect(summary.deleted).toBe(5);
    });

    it('falls back to the default cap for a zero/negative VIDEO_SWEEP_MAX_DELETES', async () => {
      process.env.VIDEO_SWEEP_MAX_DELETES = '0';
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/o1.mp4', createdAt: OLD },
      ]);
      setupUnrelatedRef();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      // A cap of 0 would abort a single orphan; the defensive fallback to the
      // default (10) means 1 orphan proceeds normally instead.
      expect(summary.aborted).toBeNull();
      expect(summary.deleted).toBe(1);
    });

    it('dry-run with orphans exceeding the cap is NOT aborted — still deletes nothing', async () => {
      process.env.VIDEO_SWEEP_MAX_DELETES = '2';
      mockListFilesForActiveBackend.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/o1.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/o2.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/o3.mp4', createdAt: OLD },
      ]);
      setupUnrelatedRef();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: true });

      expect(summary.aborted).toBeNull();
      expect(summary.orphaned).toBe(3);
      expect(summary.deleted).toBe(0);
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });
  });
});

describe('getVideoSweepWorker', () => {
  it('returns null without constructing a Worker when VIDEO_SWEEP_ENABLED is unset (opt-in default)', () => {
    delete process.env.VIDEO_SWEEP_ENABLED;
    const worker = getVideoSweepWorker();
    expect(worker).toBeNull();
    expect(MockWorker).not.toHaveBeenCalled();
  });

  it('returns null when VIDEO_SWEEP_ENABLED="false"', () => {
    process.env.VIDEO_SWEEP_ENABLED = 'false';
    const worker = getVideoSweepWorker();
    expect(worker).toBeNull();
    expect(MockWorker).not.toHaveBeenCalled();
  });

  it('returns null for any value other than the exact string "true"', () => {
    process.env.VIDEO_SWEEP_ENABLED = 'TRUE';
    const worker = getVideoSweepWorker();
    expect(worker).toBeNull();
    expect(MockWorker).not.toHaveBeenCalled();
  });

  it('best-effort removes any lingering Job Scheduler while disabled', () => {
    process.env.VIDEO_SWEEP_ENABLED = 'false';
    getVideoSweepWorker();
    expect(mockVideoSweepQueue.removeJobScheduler).toHaveBeenCalledWith('system-video-sweep');
  });

  it('logs a warning and does not throw if removeJobScheduler rejects while disabled', async () => {
    process.env.VIDEO_SWEEP_ENABLED = 'false';
    mockVideoSweepQueue.removeJobScheduler.mockRejectedValueOnce(new Error('redis down'));

    expect(() => getVideoSweepWorker()).not.toThrow();
    // Flush the fire-and-forget promise rejection's microtask queue (fake
    // timers only fake timer functions, not promise microtasks).
    await Promise.resolve();
    await Promise.resolve();
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('Failed to remove lingering Job Scheduler'),
      }),
    );
  });

  it('constructs a Worker only when VIDEO_SWEEP_ENABLED is exactly "true"', () => {
    process.env.VIDEO_SWEEP_ENABLED = 'true';
    const worker = getVideoSweepWorker();
    expect(worker).not.toBeNull();
    expect(MockWorker).toHaveBeenCalledOnce();
  });

  it('returns the same singleton on repeated calls (Worker constructed only once)', () => {
    process.env.VIDEO_SWEEP_ENABLED = 'true';
    const first = getVideoSweepWorker();
    const second = getVideoSweepWorker();
    expect(first).toBe(second);
    expect(MockWorker).toHaveBeenCalledOnce();
  });
});
