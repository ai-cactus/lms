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
  txQuizFindUnique,
  txQuestionDeleteMany,
  txCourseFindUnique,
  mockObjectExists,
  mockLessonFindMany,
  mockLessonUpdate,
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
  txQuizFindUnique: vi.fn(),
  txQuestionDeleteMany: vi.fn(),
  txCourseFindUnique: vi.fn(),
  mockObjectExists: vi.fn(),
  mockLessonFindMany: vi.fn(),
  mockLessonUpdate: vi.fn(),
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
    lesson: { update: mockLessonUpdate, findMany: mockLessonFindMany },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/system-auth', () => ({ verifySystemAdminCookie: mockVerify }));
vi.mock('@/lib/video/system-user', () => ({ getOrCreateSystemUser: mockGetSystemUser }));
vi.mock('@/lib/storage', () => ({ objectExists: mockObjectExists }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { createVideoCourse, verifyGlobalVideoMedia } from './video-course';

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
        quiz: {
          updateMany: txQuizUpdateMany,
          findUnique: txQuizFindUnique,
          create: txQuizCreate,
        },
        question: { deleteMany: txQuestionDeleteMany, createMany: txQuestionCreateMany },
      }),
    );
    txCourseFindUnique.mockResolvedValue({
      id: 'c1',
      previewVideoStorageUri: 'minio://old-preview.mp4',
      lessons: [{ id: 'l1', videoStorageUri: 'minio://l1.mp4' }],
    });
    txQuizFindUnique.mockResolvedValue({ id: 'quiz-1' });
    txQuizCreate.mockResolvedValue({ id: 'quiz-new' });
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

  it('leaves the quiz untouched when no replacement file is provided', async () => {
    const { updateVideoCourse } = await import('./video-course');
    await updateVideoCourse('c1', { title: 'New title', passingScore: 75 });
    expect(txQuestionDeleteMany).not.toHaveBeenCalled();
    expect(txQuestionCreateMany).not.toHaveBeenCalled();
  });

  it('fully replaces quiz questions when a parsed quiz is provided', async () => {
    const { updateVideoCourse } = await import('./video-course');
    await updateVideoCourse('c1', {
      title: 'New title',
      quiz: {
        questions: [
          { text: 'Q1', options: ['a', 'b'], correctAnswer: 'a', order: 0 },
          { text: 'Q2', options: ['c', 'd'], correctAnswer: 'd', order: 1 },
        ],
      },
    });
    // Old questions wiped, new ones recreated against the existing quiz row.
    expect(txQuestionDeleteMany).toHaveBeenCalledWith({ where: { quizId: 'quiz-1' } });
    expect(txQuestionCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ quizId: 'quiz-1', text: 'Q1', correctAnswer: 'a', order: 0 }),
          expect.objectContaining({ quizId: 'quiz-1', text: 'Q2', correctAnswer: 'd', order: 1 }),
        ]),
      }),
    );
  });

  it('prefers passing score / attempts from the replacement quiz file', async () => {
    const { updateVideoCourse } = await import('./video-course');
    await updateVideoCourse('c1', {
      title: 'New title',
      passingScore: 70, // form value — overridden by the file
      allowedAttempts: 1,
      quiz: {
        passingScore: 95,
        allowedAttempts: 4,
        questions: [{ text: 'Q', options: ['a', 'b'], correctAnswer: 'a', order: 0 }],
      },
    });
    expect(txQuizUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId: 'c1' },
        data: expect.objectContaining({ passingScore: 95, allowedAttempts: 4 }),
      }),
    );
  });

  it('creates a quiz row when replacing questions on a course that has none', async () => {
    txQuizFindUnique.mockResolvedValueOnce(null);
    const { updateVideoCourse } = await import('./video-course');
    await updateVideoCourse('c1', {
      title: 'New title',
      quiz: { questions: [{ text: 'Q', options: ['a', 'b'], correctAnswer: 'a', order: 0 }] },
    });
    expect(txQuizCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ courseId: 'c1' }) }),
    );
    // Nothing to delete on a fresh quiz; questions are just created.
    expect(txQuestionDeleteMany).not.toHaveBeenCalled();
    expect(txQuestionCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ quizId: 'quiz-new' })]),
      }),
    );
  });

  it('rejects when not a system admin', async () => {
    mockVerify.mockResolvedValue(false);
    const { updateVideoCourse } = await import('./video-course');
    await expect(updateVideoCourse('c1', { title: 'x' })).rejects.toThrow('Unauthorized');
  });
});

describe('verifyGlobalVideoMedia — Issue #7/#9: HEAD-check reconciliation', () => {
  beforeEach(() => {
    mockLessonUpdate.mockResolvedValue({});
  });

  it('rejects when not a system admin, without querying any lesson', async () => {
    mockVerify.mockResolvedValue(false);

    await expect(verifyGlobalVideoMedia()).rejects.toThrow('Unauthorized');
    expect(mockLessonFindMany).not.toHaveBeenCalled();
  });

  it('counts checked+missing and flips mediaStatus only for a confirmed-absent object', async () => {
    mockLessonFindMany.mockResolvedValue([
      { id: 'lesson-present', videoStorageUri: 'gcs://bucket/present.mp4', mediaStatus: 'ready' },
      { id: 'lesson-missing', videoStorageUri: 'gcs://bucket/missing.mp4', mediaStatus: 'ready' },
    ]);
    mockObjectExists.mockImplementation((uri: string) => Promise.resolve(uri.includes('present')));

    const result = await verifyGlobalVideoMedia();

    expect(result).toEqual({ checked: 2, missing: 1 });
    expect(mockLessonUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'lesson-missing' },
      data: { mediaStatus: 'failed' },
    });
  });

  it('does not re-write a lesson that is already flagged failed (avoids a redundant write)', async () => {
    mockLessonFindMany.mockResolvedValue([
      { id: 'lesson-missing', videoStorageUri: 'gcs://bucket/missing.mp4', mediaStatus: 'failed' },
    ]);
    mockObjectExists.mockResolvedValue(false);

    const result = await verifyGlobalVideoMedia();

    expect(result).toEqual({ checked: 1, missing: 1 });
    expect(mockLessonUpdate).not.toHaveBeenCalled();
  });

  it('does not count a transient storage error as checked or missing, and never writes for it', async () => {
    mockLessonFindMany.mockResolvedValue([
      { id: 'lesson-flaky', videoStorageUri: 'gcs://bucket/flaky.mp4', mediaStatus: 'ready' },
    ]);
    mockObjectExists.mockRejectedValue(new Error('storage unavailable'));

    const result = await verifyGlobalVideoMedia();

    expect(result).toEqual({ checked: 0, missing: 0 });
    expect(mockLessonUpdate).not.toHaveBeenCalled();
  });

  it('returns {checked: 0, missing: 0} for an empty catalog without calling objectExists', async () => {
    mockLessonFindMany.mockResolvedValue([]);

    const result = await verifyGlobalVideoMedia();

    expect(result).toEqual({ checked: 0, missing: 0 });
    expect(mockObjectExists).not.toHaveBeenCalled();
  });

  it('scopes the lesson query to global video courses with a storage URI', async () => {
    mockLessonFindMany.mockResolvedValue([]);

    await verifyGlobalVideoMedia();

    expect(mockLessonFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          videoStorageUri: { not: null },
          course: { type: 'video', isGlobal: true },
        }),
      }),
    );
  });
});
