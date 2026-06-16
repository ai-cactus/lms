import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockVerify,
  mockGetSystemUser,
  mockTransaction,
  mockRevalidate,
  mockEnqueueTranscode,
  txCourseCreate,
  txModuleCreate,
  txLessonCreate,
  txQuizCreate,
  txQuestionCreateMany,
  courseUpdate,
  txModuleUpdate,
  txModuleDelete,
  txLessonUpdate,
  txLessonDelete,
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
  txModuleCreate: vi.fn(),
  txLessonCreate: vi.fn(),
  txQuizCreate: vi.fn(),
  txQuestionCreateMany: vi.fn(),
  courseUpdate: vi.fn(),
  txModuleUpdate: vi.fn(),
  txModuleDelete: vi.fn(),
  txLessonUpdate: vi.fn(),
  txLessonDelete: vi.fn(),
  txCourseUpdate: vi.fn(),
  txQuizUpdateMany: vi.fn(),
  txCourseFindUnique: vi.fn(),
}));

// Mock the transcode queue so the dynamic import in createVideoCourse never
// touches Redis during unit tests.
vi.mock('@/lib/queue/video-transcode-queue', () => ({
  enqueueVideoTranscode: mockEnqueueTranscode,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mockTransaction,
    course: { update: courseUpdate },
    lesson: { update: vi.fn() },
  },
}));
vi.mock('@/lib/system-auth', () => ({ verifySystemAdminCookie: mockVerify }));
vi.mock('@/lib/video/system-user', () => ({ getOrCreateSystemUser: mockGetSystemUser }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import { createVideoCourse } from './video-course';

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockResolvedValue(true);
  mockGetSystemUser.mockResolvedValue({ id: 'system-user' });
  txCourseCreate.mockResolvedValue({ id: 'course-1' });
  txModuleCreate.mockResolvedValue({ id: 'module-1' });
  txLessonCreate.mockResolvedValue({ id: 'lesson-1' });
  txQuizCreate.mockResolvedValue({ id: 'quiz-1' });
  mockTransaction.mockImplementation(async (cb) =>
    cb({
      course: { create: txCourseCreate },
      courseModule: { create: txModuleCreate },
      lesson: { create: txLessonCreate },
      quiz: { create: txQuizCreate },
      question: { createMany: txQuestionCreateMany },
    }),
  );
});

describe('createVideoCourse', () => {
  it('persists modules, lectures, and a course-level quiz', async () => {
    const result = await createVideoCourse({
      title: 'Health & Safety',
      overview: 'Long overview',
      skillLevel: 'beginner',
      passingScore: 80,
      allowedAttempts: 1,
      previewVideoStorageUri: 'minio://preview.mp4',
      previewVideoDurationSeconds: 45,
      modules: [
        {
          title: 'Chapter 1',
          order: 0,
          lectures: [
            {
              title: 'Intro',
              order: 0,
              videoStorageUri: 'minio://l1.mp4',
              videoDurationSeconds: 90,
            },
          ],
        },
      ],
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
    expect(txModuleCreate).toHaveBeenCalledTimes(1);
    expect(txLessonCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ moduleId: 'module-1' }) }),
    );
    expect(txQuizCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ courseId: 'course-1' }) }),
    );

    // A transcode job is enqueued for each source video: the one lecture + the preview.
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

  it('prefers quiz.passingScore/allowedAttempts from the parsed quiz file when present', async () => {
    await createVideoCourse({
      title: 'HIPAA 2',
      passingScore: 70, // form value — should be overridden
      allowedAttempts: 1, // form value — should be overridden
      modules: [
        {
          title: 'Chapter 1',
          order: 0,
          lectures: [{ title: 'Intro', order: 0, videoStorageUri: 'minio://v2.mp4' }],
        },
      ],
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
        modules: [],
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
        courseModule: { create: txModuleCreate, update: txModuleUpdate, delete: txModuleDelete },
        lesson: {
          create: txLessonCreate,
          update: txLessonUpdate,
          delete: txLessonDelete,
        },
        quiz: { updateMany: txQuizUpdateMany },
      }),
    );
    txCourseFindUnique.mockResolvedValue({
      id: 'c1',
      previewVideoStorageUri: 'minio://old-preview.mp4',
      modules: [
        {
          id: 'm1',
          lessons: [
            { id: 'l1', videoStorageUri: 'minio://l1.mp4' },
            { id: 'l2', videoStorageUri: 'minio://l2.mp4' },
          ],
        },
      ],
    });
    txModuleCreate.mockResolvedValue({ id: 'm-new' });
    txLessonCreate.mockResolvedValue({ id: 'l-new' });
    txCourseUpdate.mockResolvedValue({ id: 'c1' });
  });

  it('updates fields, creates/updates/deletes lectures, and enqueues only the changed video', async () => {
    const { updateVideoCourse } = await import('./video-course');
    await updateVideoCourse('c1', {
      title: 'New title',
      passingScore: 80,
      allowedAttempts: 2,
      modules: [
        {
          id: 'm1',
          title: 'Chapter 1',
          order: 0,
          lectures: [
            { id: 'l1', title: 'Lecture 1 renamed', order: 0 }, // video unchanged
            {
              title: 'Lecture new',
              order: 1,
              videoStorageUri: 'minio://new.mp4',
              videoDurationSeconds: 120,
            },
          ],
        },
      ],
    });
    expect(txLessonDelete).toHaveBeenCalledWith({ where: { id: 'l2' } }); // l2 removed from kept chapter
    expect(txLessonUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'l1' } }));
    expect(txLessonCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mediaStatus: 'processing',
          videoStorageUri: 'minio://new.mp4',
        }),
      }),
    );
    expect(txCourseUpdate).toHaveBeenCalled();
    expect(txQuizUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId: 'c1' },
        data: expect.objectContaining({ passingScore: 80, allowedAttempts: 2 }),
      }),
    );
    expect(mockEnqueueTranscode).toHaveBeenCalledTimes(1); // only the one new video
    expect(mockRevalidate).toHaveBeenCalledWith('/system/video-courses');
  });

  it('deletes a removed chapter and its lessons exactly once (no orphans, no double-delete)', async () => {
    const { updateVideoCourse } = await import('./video-course');
    await updateVideoCourse('c1', { title: 'x', modules: [] });
    expect(txLessonDelete).toHaveBeenCalledWith({ where: { id: 'l1' } });
    expect(txLessonDelete).toHaveBeenCalledWith({ where: { id: 'l2' } });
    expect(txLessonDelete).toHaveBeenCalledTimes(2); // exactly once each, no double-delete
    expect(txModuleDelete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  it('rejects a module id that does not belong to the course', async () => {
    const { updateVideoCourse } = await import('./video-course');
    await expect(
      updateVideoCourse('c1', {
        title: 'x',
        modules: [{ id: 'm-foreign', title: 'X', order: 0, lectures: [] }],
      }),
    ).rejects.toThrow('Module does not belong to this course');
  });

  it('rejects a lecture id that does not belong to the course', async () => {
    const { updateVideoCourse } = await import('./video-course');
    await expect(
      updateVideoCourse('c1', {
        title: 'x',
        modules: [
          {
            id: 'm1',
            title: 'C1',
            order: 0,
            lectures: [{ id: 'l-foreign', title: 'L', order: 0 }],
          },
        ],
      }),
    ).rejects.toThrow('Lecture does not belong to this course');
  });

  it('rejects when not a system admin', async () => {
    mockVerify.mockResolvedValue(false);
    const { updateVideoCourse } = await import('./video-course');
    await expect(updateVideoCourse('c1', { title: 'x', modules: [] })).rejects.toThrow(
      'Unauthorized',
    );
  });
});
