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
 *
 * getVideoSweepWorker() covered:
 *   - VIDEO_SWEEP_ENABLED=false → returns null, no Worker constructed
 *   - Singleton: second call returns same instance, Worker constructed only once
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  MockWorker,
  mockListFiles,
  mockDeleteFile,
  mockLessonFindMany,
  mockCourseFindMany,
  mockCourseArtifactFindMany,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
  mockVideoSweepQueue,
} = vi.hoisted(() => {
  const mockListFiles = vi.fn();
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
    mockListFiles,
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
  listFiles: mockListFiles,
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
});

describe('runVideoSweep', () => {
  describe('grace filter', () => {
    it('all objects younger than grace → graceFiltered=total, zero deletes', async () => {
      mockListFiles.mockResolvedValue([
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
      mockListFiles.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/old.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/young.mp4', createdAt: YOUNG },
      ]);
      setupEmptyRefs();

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
      mockListFiles.mockResolvedValue([
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
      mockListFiles.mockResolvedValue([
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
      mockListFiles.mockResolvedValue([
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
      mockListFiles.mockResolvedValue([
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
      mockListFiles.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/unwanted.mp4', createdAt: OLD },
      ]);
      setupEmptyRefs();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.deleted).toBe(1);
      expect(summary.errors).toBe(0);
      expect(mockDeleteFile).toHaveBeenCalledWith('gcs://b/system/videos/unwanted.mp4');
    });

    it('dry-run: does NOT call deleteFile, reports orphaned count, logs would-delete', async () => {
      mockListFiles.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/dryorphan.mp4', createdAt: OLD },
      ]);
      setupEmptyRefs();

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
      mockListFiles.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/fails.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/succeeds.mp4', createdAt: OLD },
      ]);
      setupEmptyRefs();

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
      mockListFiles.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/err1.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/err2.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/ok.mp4', createdAt: OLD },
      ]);
      setupEmptyRefs();

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

      mockListFiles.mockResolvedValue([
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
      mockListFiles.mockResolvedValue([]);
      setupEmptyRefs();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary).toMatchObject({
        total: expect.any(Number),
        graceFiltered: expect.any(Number),
        referenced: expect.any(Number),
        orphaned: expect.any(Number),
        deleted: expect.any(Number),
        errors: expect.any(Number),
      });
    });

    it('total = graceFiltered + aged objects processed', async () => {
      mockListFiles.mockResolvedValue([
        { storageUri: 'gcs://b/system/videos/old.mp4', createdAt: OLD },
        { storageUri: 'gcs://b/system/videos/young.mp4', createdAt: YOUNG },
      ]);
      setupEmptyRefs();

      const summary = await runVideoSweep({ gracePeriodMs: GRACE_MS, dryRun: false });

      expect(summary.total).toBe(summary.graceFiltered + summary.referenced + summary.orphaned);
    });
  });
});

describe('getVideoSweepWorker', () => {
  it('returns null without constructing a Worker when VIDEO_SWEEP_ENABLED=false', () => {
    process.env.VIDEO_SWEEP_ENABLED = 'false';
    const worker = getVideoSweepWorker();
    expect(worker).toBeNull();
    expect(MockWorker).not.toHaveBeenCalled();
  });

  it('returns a Worker instance when VIDEO_SWEEP_ENABLED is not "false"', () => {
    delete process.env.VIDEO_SWEEP_ENABLED;
    const worker = getVideoSweepWorker();
    expect(worker).not.toBeNull();
    expect(MockWorker).toHaveBeenCalledOnce();
  });

  it('returns the same singleton on repeated calls (Worker constructed only once)', () => {
    delete process.env.VIDEO_SWEEP_ENABLED;
    const first = getVideoSweepWorker();
    const second = getVideoSweepWorker();
    expect(first).toBe(second);
    expect(MockWorker).toHaveBeenCalledOnce();
  });
});
