/**
 * Custom video-course thumbnails: the regenerate/remove Server Actions, and the
 * thumbnail-cache eviction updateVideoCourse owes when a video is repointed.
 *
 * Refusals are RETURNED, never thrown — a thrown message is redacted to React
 * error #441 in production and the admin would see nothing useful.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockVerify,
  mockCourseFindFirst,
  mockCourseUpdate,
  mockLessonFindFirst,
  mockTransaction,
  mockExtract,
  mockDeleteFile,
  mockRevalidatePath,
  mockRevalidateTag,
  mockInvalidateThumbnail,
  mockEnqueueTranscode,
  mockLogger,
} = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockCourseFindFirst: vi.fn(),
  mockCourseUpdate: vi.fn(),
  mockLessonFindFirst: vi.fn(),
  mockTransaction: vi.fn(),
  mockExtract: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockInvalidateThumbnail: vi.fn(),
  mockEnqueueTranscode: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/system-auth', () => ({ verifySystemAdminCookie: mockVerify }));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    $transaction: mockTransaction,
    course: { findFirst: mockCourseFindFirst, update: mockCourseUpdate },
    lesson: { findFirst: mockLessonFindFirst, update: vi.fn() },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/video/system-user', () => ({ getOrCreateSystemUser: vi.fn() }));
vi.mock('@/lib/storage', () => ({ objectExists: vi.fn(), deleteFile: mockDeleteFile }));
vi.mock('@/lib/video/poster-extraction', () => ({ extractAndUploadPoster: mockExtract }));
vi.mock('@/lib/video/playback-cache', () => ({
  invalidateCoursePreviewMeta: vi.fn(),
  invalidateLessonPlaybackMeta: vi.fn(),
  invalidateCourseThumbnailMeta: mockInvalidateThumbnail,
}));
vi.mock('@/lib/queue/video-transcode-queue', () => ({
  enqueueVideoTranscode: mockEnqueueTranscode,
}));
vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
  revalidateTag: mockRevalidateTag,
}));
vi.mock('@/lib/logger', () => ({ logger: mockLogger }));

import {
  regenerateVideoCourseThumbnail,
  removeCustomVideoCourseThumbnail,
  updateVideoCourse,
} from './video-course';

const COURSE_ID = 'course-1';
const PRIOR_CUSTOM = 'gcs://lms/system/videos/thumbnails/course-1/1-old.jpg';
const NEW_CUSTOM = 'gcs://lms/system/videos/thumbnails/course-1/2-new.jpg';
const LESSON_VIDEO = 'gcs://lms/system/videos/normalized/v.mp4';

const readyLesson = {
  id: 'lesson-1',
  videoStorageUri: LESSON_VIDEO,
  videoDurationSeconds: 300,
  mediaStatus: 'ready',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockResolvedValue(true);
  mockCourseFindFirst.mockResolvedValue({ id: COURSE_ID, thumbnailStorageUri: null });
  mockCourseUpdate.mockResolvedValue({});
  mockLessonFindFirst.mockResolvedValue(readyLesson);
  mockExtract.mockResolvedValue(NEW_CUSTOM);
  mockDeleteFile.mockResolvedValue(undefined);
  mockEnqueueTranscode.mockResolvedValue(undefined);
});

function expectRefreshed() {
  expect(mockInvalidateThumbnail).toHaveBeenCalledWith(COURSE_ID);
  expect(mockRevalidatePath).toHaveBeenCalledWith('/system/video-courses');
  expect(mockRevalidatePath).toHaveBeenCalledWith(`/system/video-courses/${COURSE_ID}/edit`);
  expect(mockRevalidateTag).toHaveBeenCalledWith('video-catalog', { expire: 0 });
}

describe('regenerateVideoCourseThumbnail', () => {
  it('returns Unauthorized without the system-admin cookie and does nothing', async () => {
    mockVerify.mockResolvedValue(false);

    await expect(regenerateVideoCourseThumbnail(COURSE_ID)).resolves.toEqual({
      success: false,
      error: 'Unauthorized',
    });
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('refuses a course that is not a global video course', async () => {
    mockCourseFindFirst.mockResolvedValue(null);

    await expect(regenerateVideoCourseThumbnail(COURSE_ID)).resolves.toEqual({
      success: false,
      error: 'Course not found',
    });
    expect(mockCourseFindFirst.mock.calls[0][0].where).toEqual({
      id: COURSE_ID,
      type: 'video',
      isGlobal: true,
    });
  });

  it('takes the frame from the MAIN lesson — the first by order', async () => {
    await regenerateVideoCourseThumbnail(COURSE_ID);

    expect(mockLessonFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { courseId: COURSE_ID }, orderBy: { order: 'asc' } }),
    );
  });

  it('refuses when the course has no course video', async () => {
    mockLessonFindFirst.mockResolvedValue({ ...readyLesson, videoStorageUri: null });

    const result = await regenerateVideoCourseThumbnail(COURSE_ID);

    expect(result.success).toBe(false);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it.each(['processing', 'failed'])(
    'refuses while the lesson video is %s, without running ffmpeg',
    async (mediaStatus) => {
      mockLessonFindFirst.mockResolvedValue({ ...readyLesson, mediaStatus });

      const result = await regenerateVideoCourseThumbnail(COURSE_ID);

      expect(result).toMatchObject({ success: false });
      expect(mockExtract).not.toHaveBeenCalled();
      expect(mockCourseUpdate).not.toHaveBeenCalled();
    },
  );

  it('extracts with a 45 s budget into the course thumbnail prefix, saves and refreshes', async () => {
    await expect(regenerateVideoCourseThumbnail(COURSE_ID)).resolves.toEqual({ success: true });

    expect(mockExtract).toHaveBeenCalledWith(LESSON_VIDEO, 300, {
      timeoutMs: 45_000,
      keyPrefix: `system/videos/thumbnails/${COURSE_ID}/`,
    });
    expect(mockCourseUpdate).toHaveBeenCalledWith({
      where: { id: COURSE_ID },
      data: { thumbnailStorageUri: NEW_CUSTOM },
    });
    expectRefreshed();
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('deletes the previous custom thumbnail after saving the new one', async () => {
    mockCourseFindFirst.mockResolvedValue({ id: COURSE_ID, thumbnailStorageUri: PRIOR_CUSTOM });

    await regenerateVideoCourseThumbnail(COURSE_ID);

    expect(mockDeleteFile).toHaveBeenCalledWith(PRIOR_CUSTOM);
    expect(mockCourseUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteFile.mock.invocationCallOrder[0],
    );
  });

  it('never deletes a previous value outside the custom-thumbnail prefix', async () => {
    mockCourseFindFirst.mockResolvedValue({
      id: COURSE_ID,
      thumbnailStorageUri: 'gcs://lms/system/videos/posters/9-lesson.jpg',
    });

    await regenerateVideoCourseThumbnail(COURSE_ID);

    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('returns a safe error when extraction fails or times out, leaving the row alone', async () => {
    mockExtract.mockRejectedValue(Object.assign(new Error('ffmpeg killed'), { killed: true }));

    const result = await regenerateVideoCourseThumbnail(COURSE_ID);

    expect(result).toEqual({
      success: false,
      error: 'Could not take a frame from the course video.',
    });
    expect(mockCourseUpdate).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('reclaims the extracted still when the DB write fails', async () => {
    mockCourseFindFirst.mockResolvedValue({ id: COURSE_ID, thumbnailStorageUri: PRIOR_CUSTOM });
    mockCourseUpdate.mockRejectedValue(new Error('db down'));

    const result = await regenerateVideoCourseThumbnail(COURSE_ID);

    expect(result).toMatchObject({ success: false });
    expect(mockDeleteFile).toHaveBeenCalledWith(NEW_CUSTOM);
    expect(mockDeleteFile).not.toHaveBeenCalledWith(PRIOR_CUSTOM);
    expect(mockInvalidateThumbnail).not.toHaveBeenCalled();
  });
});

describe('removeCustomVideoCourseThumbnail', () => {
  it('returns Unauthorized without the system-admin cookie', async () => {
    mockVerify.mockResolvedValue(false);

    await expect(removeCustomVideoCourseThumbnail(COURSE_ID)).resolves.toEqual({
      success: false,
      error: 'Unauthorized',
    });
    expect(mockCourseUpdate).not.toHaveBeenCalled();
  });

  it('refuses an unknown course', async () => {
    mockCourseFindFirst.mockResolvedValue(null);

    await expect(removeCustomVideoCourseThumbnail(COURSE_ID)).resolves.toEqual({
      success: false,
      error: 'Course not found',
    });
  });

  it('clears the column, refreshes and deletes the custom object', async () => {
    mockCourseFindFirst.mockResolvedValue({ id: COURSE_ID, thumbnailStorageUri: PRIOR_CUSTOM });

    await expect(removeCustomVideoCourseThumbnail(COURSE_ID)).resolves.toEqual({ success: true });

    expect(mockCourseUpdate).toHaveBeenCalledWith({
      where: { id: COURSE_ID },
      data: { thumbnailStorageUri: null },
    });
    expectRefreshed();
    expect(mockDeleteFile).toHaveBeenCalledWith(PRIOR_CUSTOM);
  });

  it('clears but never deletes a value outside the custom prefix', async () => {
    mockCourseFindFirst.mockResolvedValue({
      id: COURSE_ID,
      thumbnailStorageUri: 'gcs://lms/system/videos/posters/9-preview.jpg',
    });

    await removeCustomVideoCourseThumbnail(COURSE_ID);

    expect(mockCourseUpdate).toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('is a no-op success when there is no custom thumbnail', async () => {
    await expect(removeCustomVideoCourseThumbnail(COURSE_ID)).resolves.toEqual({ success: true });
    expect(mockCourseUpdate).not.toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('returns a safe error when the DB write fails and keeps the object', async () => {
    mockCourseFindFirst.mockResolvedValue({ id: COURSE_ID, thumbnailStorageUri: PRIOR_CUSTOM });
    mockCourseUpdate.mockRejectedValue(new Error('db down'));

    await expect(removeCustomVideoCourseThumbnail(COURSE_ID)).resolves.toEqual({
      success: false,
      error: 'Failed to remove the thumbnail.',
    });
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('still succeeds when the storage delete fails', async () => {
    mockCourseFindFirst.mockResolvedValue({ id: COURSE_ID, thumbnailStorageUri: PRIOR_CUSTOM });
    mockDeleteFile.mockRejectedValue(new Error('storage down'));

    await expect(removeCustomVideoCourseThumbnail(COURSE_ID)).resolves.toEqual({ success: true });
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe('updateVideoCourse — thumbnail cache', () => {
  beforeEach(() => {
    mockTransaction.mockImplementation(async (cb) =>
      cb({
        course: {
          findUnique: vi.fn().mockResolvedValue({
            id: COURSE_ID,
            previewVideoStorageUri: 'minio://old-preview.mp4',
            lessons: [{ id: 'l1', videoStorageUri: 'minio://l1.mp4' }],
          }),
          update: vi.fn(),
        },
        lesson: { update: vi.fn(), create: vi.fn() },
        quiz: { updateMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
        question: { deleteMany: vi.fn(), createMany: vi.fn() },
      }),
    );
  });

  it('evicts the thumbnail meta when the course video is repointed', async () => {
    await updateVideoCourse(COURSE_ID, {
      title: 'T',
      courseVideo: { storageUri: 'minio://new.mp4' },
    });

    expect(mockInvalidateThumbnail).toHaveBeenCalledWith(COURSE_ID);
  });

  it('evicts the thumbnail meta when the preview video is repointed', async () => {
    await updateVideoCourse(COURSE_ID, {
      title: 'T',
      previewVideoStorageUri: 'minio://new-preview.mp4',
    });

    expect(mockInvalidateThumbnail).toHaveBeenCalledWith(COURSE_ID);
  });

  it('leaves the thumbnail meta alone for a metadata-only edit', async () => {
    await updateVideoCourse(COURSE_ID, { title: 'T' });

    expect(mockInvalidateThumbnail).not.toHaveBeenCalled();
  });
});
