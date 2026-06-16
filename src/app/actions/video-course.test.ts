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
}));

// Mock the transcode queue so the dynamic import in createVideoCourse never
// touches Redis during unit tests.
vi.mock('@/lib/queue/video-transcode-queue', () => ({
  enqueueVideoTranscode: mockEnqueueTranscode,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: mockTransaction },
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
