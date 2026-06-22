import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockVerify,
  mockGetSystemUser,
  mockTransaction,
  mockRevalidate,
  mockEnqueueTranscode,
  txCourseCreate,
  txLessonCreate,
  txQuizCreate,
  txQuestionCreateMany,
  courseUpdate,
  txLessonUpdate,
  txCourseUpdate,
  txQuizUpdateMany,
  txCourseFindUnique,
} = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockGetSystemUser: vi.fn(),
  mockTransaction: vi.fn(),
  mockRevalidate: vi.fn(),
  mockEnqueueTranscode: vi.fn(),
  txCourseCreate: vi.fn(),
  txLessonCreate: vi.fn(),
  txQuizCreate: vi.fn(),
  txQuestionCreateMany: vi.fn(),
  courseUpdate: vi.fn(),
  txLessonUpdate: vi.fn(),
  txCourseUpdate: vi.fn(),
  txQuizUpdateMany: vi.fn(),
  txCourseFindUnique: vi.fn(),
}));

// Mock the transcode queue so the dynamic import in createVideoCourse never
// touches Redis during unit tests.
vi.mock('@/lib/queue/video-transcode-queue', () => ({
  enqueueVideoTranscode: mockEnqueueTranscode,
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    $transaction: mockTransaction,
    course: { update: courseUpdate },
    lesson: { update: vi.fn() },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/system-auth', () => ({ verifySystemAdminCookie: mockVerify }));
vi.mock('@/lib/video/system-user', () => ({ getOrCreateSystemUser: mockGetSystemUser }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { createVideoCourse } from './video-course';

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockResolvedValue(true);
  mockGetSystemUser.mockResolvedValue({ id: 'system-user' });
  txCourseCreate.mockResolvedValue({ id: 'course-1' });
  txLessonCreate.mockResolvedValue({ id: 'lesson-1' });
  txQuizCreate.mockResolvedValue({ id: 'quiz-1' });
  mockTransaction.mockImplementation(async (cb) =>
    cb({
      course: { create: txCourseCreate },
      lesson: { create: txLessonCreate },
      quiz: { create: txQuizCreate },
      question: { createMany: txQuestionCreateMany },
    }),
  );
});

describe('createVideoCourse', () => {
  it('persists the single course video (module-less lesson) and a course-level quiz', async () => {
    const result = await createVideoCourse({
      title: 'Health & Safety',
      overview: 'Long overview',
      skillLevel: 'beginner',
      passingScore: 80,
      allowedAttempts: 1,
      previewVideoStorageUri: 'minio://preview.mp4',
      previewVideoDurationSeconds: 45,
      courseVideo: { storageUri: 'minio://l1.mp4', durationSeconds: 90 },
      quiz: { questions: [{ text: 'Q1', options: ['a', 'b'], correctAnswer: 'a', order: 0 }] },
    });

    expect(result).toEqual({ courseId: 'course-1' });
    expect(txCourseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          overview: 'Long overview',
          skillLevel: 'beginner',
          previewVideoStorageUri: 'minio://preview.mp4',
          type: 'video',
          isGlobal: true,
        }),
      }),
    );
    // One module-less lesson holds the course video.
    expect(txLessonCreate).toHaveBeenCalledTimes(1);
    expect(txLessonCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          moduleId: null,
          videoStorageUri: 'minio://l1.mp4',
          mediaStatus: 'processing',
        }),
      }),
    );
    expect(txQuizCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ courseId: 'course-1' }) }),
    );

    // A transcode job is enqueued for each source video: the course video + the preview.
    expect(mockEnqueueTranscode).toHaveBeenCalledWith({
      targetType: 'lesson',
      targetId: 'lesson-1',
      storageUri: 'minio://l1.mp4',
    });
    expect(mockEnqueueTranscode).toHaveBeenCalledWith({
      targetType: 'course-preview',
      targetId: 'course-1',
      storageUri: 'minio://preview.mp4',
    });
  });

  it('allows an unspecified skill level', async () => {
    await createVideoCourse({
      title: 'No level',
      passingScore: 70,
      allowedAttempts: 1,
      courseVideo: { storageUri: 'minio://v.mp4' },
      quiz: { questions: [{ text: 'Q', options: ['x', 'y'], correctAnswer: 'x', order: 0 }] },
    });
    expect(txCourseCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ skillLevel: null }) }),
    );
  });

  it('prefers quiz.passingScore/allowedAttempts from the parsed quiz file when present', async () => {
    await createVideoCourse({
      title: 'HIPAA 2',
      passingScore: 70, // form value — should be overridden
      allowedAttempts: 1, // form value — should be overridden
      courseVideo: { storageUri: 'minio://v2.mp4' },
      quiz: {
        passingScore: 90,
        allowedAttempts: 3,
        questions: [{ text: 'Q2', options: ['x', 'y'], correctAnswer: 'x', order: 0 }],
      },
    });

    const quizArg = txQuizCreate.mock.calls[0][0].data;
    expect(quizArg.passingScore).toBe(90); // from quiz file
    expect(quizArg.allowedAttempts).toBe(3); // from quiz file
  });

  it('rejects when not a system admin', async () => {
    mockVerify.mockResolvedValueOnce(false);

    await expect(
      createVideoCourse({
        title: 'x',
        passingScore: 80,
        allowedAttempts: 1,
        courseVideo: { storageUri: 'minio://v.mp4' },
        quiz: { questions: [] },
      }),
    ).rejects.toThrow();
  });
});

describe('setVideoCourseStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerify.mockResolvedValue(true);
    courseUpdate.mockResolvedValue({ id: 'c1', status: 'inactive' });
  });

  it('sets a course inactive (soft delete) without deleting the row', async () => {
    const { setVideoCourseStatus } = await import('./video-course');
    await setVideoCourseStatus('c1', 'inactive');
    expect(courseUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'inactive' },
    });
    expect(mockRevalidate).toHaveBeenCalledWith('/system/video-courses');
  });

  it('reactivates a course back to published', async () => {
    const { setVideoCourseStatus } = await import('./video-course');
    await setVideoCourseStatus('c1', 'published');
    expect(courseUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'published' },
    });
  });

  it('rejects when not a system admin', async () => {
    mockVerify.mockResolvedValue(false);
    const { setVideoCourseStatus } = await import('./video-course');
    await expect(setVideoCourseStatus('c1', 'inactive')).rejects.toThrow('Unauthorized');
  });
});

describe('updateVideoCourse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerify.mockResolvedValue(true);
    mockTransaction.mockImplementation(async (cb) =>
      cb({
        course: { update: txCourseUpdate, findUnique: txCourseFindUnique },
        lesson: { create: txLessonCreate, update: txLessonUpdate },
        quiz: { updateMany: txQuizUpdateMany },
      }),
    );
    txCourseFindUnique.mockResolvedValue({
      id: 'c1',
      previewVideoStorageUri: 'minio://old-preview.mp4',
      lessons: [{ id: 'l1', videoStorageUri: 'minio://l1.mp4' }],
    });
    txLessonCreate.mockResolvedValue({ id: 'l-new' });
    txCourseUpdate.mockResolvedValue({ id: 'c1' });
  });

  it('updates course fields and quiz scoring without touching the video when none is provided', async () => {
    const { updateVideoCourse } = await import('./video-course');
    await updateVideoCourse('c1', {
      title: 'New title',
      passingScore: 80,
      allowedAttempts: 2,
    });
    expect(txCourseUpdate).toHaveBeenCalled();
    expect(txQuizUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId: 'c1' },
        data: expect.objectContaining({ passingScore: 80, allowedAttempts: 2 }),
      }),
    );
    // No new video → the existing lesson is untouched and nothing is transcoded.
    expect(txLessonUpdate).not.toHaveBeenCalled();
    expect(txLessonCreate).not.toHaveBeenCalled();
    expect(mockEnqueueTranscode).not.toHaveBeenCalled();
    expect(mockRevalidate).toHaveBeenCalledWith('/system/video-courses');
  });

  it('replaces the course video and enqueues a transcode for it', async () => {
    const { updateVideoCourse } = await import('./video-course');
    await updateVideoCourse('c1', {
      title: 'New title',
      courseVideo: { storageUri: 'minio://new.mp4', durationSeconds: 120 },
    });
    expect(txLessonUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'l1' },
        data: expect.objectContaining({
          videoStorageUri: 'minio://new.mp4',
          mediaStatus: 'processing',
        }),
      }),
    );
    expect(mockEnqueueTranscode).toHaveBeenCalledTimes(1);
    expect(mockEnqueueTranscode).toHaveBeenCalledWith({
      targetType: 'lesson',
      targetId: 'l1',
      storageUri: 'minio://new.mp4',
    });
  });

  it('does not re-process when the same video uri is submitted', async () => {
    const { updateVideoCourse } = await import('./video-course');
    await updateVideoCourse('c1', {
      title: 'New title',
      courseVideo: { storageUri: 'minio://l1.mp4', durationSeconds: 90 },
    });
    // Lesson is still updated (title/duration) but media is not re-flagged or transcoded.
    expect(txLessonUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'l1' },
        data: expect.not.objectContaining({ mediaStatus: 'processing' }),
      }),
    );
    expect(mockEnqueueTranscode).not.toHaveBeenCalled();
  });

  it('creates a module-less lesson when the course has no video lesson yet', async () => {
    txCourseFindUnique.mockResolvedValueOnce({
      id: 'c1',
      previewVideoStorageUri: null,
      lessons: [],
    });
    const { updateVideoCourse } = await import('./video-course');
    await updateVideoCourse('c1', {
      title: 'New title',
      courseVideo: { storageUri: 'minio://first.mp4', durationSeconds: 60 },
    });
    expect(txLessonCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          moduleId: null,
          videoStorageUri: 'minio://first.mp4',
          mediaStatus: 'processing',
        }),
      }),
    );
    expect(mockEnqueueTranscode).toHaveBeenCalledWith({
      targetType: 'lesson',
      targetId: 'l-new',
      storageUri: 'minio://first.mp4',
    });
  });

  it('rejects when not a system admin', async () => {
    mockVerify.mockResolvedValue(false);
    const { updateVideoCourse } = await import('./video-course');
    await expect(updateVideoCourse('c1', { title: 'x' })).rejects.toThrow('Unauthorized');
  });
});
