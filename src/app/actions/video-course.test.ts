import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so these are available inside the hoisted vi.mock factories.
const { tx, mockTransaction, mockVerify, mockGetSystemUser, mockRevalidate } = vi.hoisted(() => {
  const courseCreate = vi.fn();
  const lessonCreate = vi.fn();
  const quizCreate = vi.fn();
  const questionCreateMany = vi.fn();
  const tx = {
    course: { create: courseCreate },
    lesson: { create: lessonCreate },
    quiz: { create: quizCreate },
    question: { createMany: questionCreateMany },
  };
  const mockTransaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
  const mockVerify = vi.fn().mockResolvedValue(true);
  const mockGetSystemUser = vi.fn().mockResolvedValue({ id: 'sys-1' });
  const mockRevalidate = vi.fn();
  return { tx, mockTransaction, mockVerify, mockGetSystemUser, mockRevalidate };
});

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mockTransaction } }));
vi.mock('@/lib/system-auth', () => ({ verifySystemAdminCookie: mockVerify }));
vi.mock('@/lib/video/system-user', () => ({ getOrCreateSystemUser: mockGetSystemUser }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }));

import { createVideoCourse } from './video-course';

beforeEach(() => {
  tx.course.create.mockReset();
  tx.lesson.create.mockReset();
  tx.quiz.create.mockReset();
  tx.question.createMany.mockReset();
  mockTransaction.mockClear();
  mockVerify.mockResolvedValue(true);
  mockGetSystemUser.mockResolvedValue({ id: 'sys-1' });
  mockRevalidate.mockClear();
});

describe('createVideoCourse', () => {
  it('creates a global video Course owned by the System user with a video lesson + quiz', async () => {
    tx.course.create.mockResolvedValue({ id: 'c1' });
    tx.lesson.create.mockResolvedValue({ id: 'l1' });
    tx.quiz.create.mockResolvedValue({ id: 'qz1' });

    const res = await createVideoCourse({
      title: 'HIPAA',
      passingScore: 80,
      allowedAttempts: 2,
      videoStorageUri: 'gcs://b/v.mp4',
      videoDurationSeconds: 600,
      quiz: {
        questions: [{ text: 'Q', options: ['a', 'b'], correctAnswer: 'a', order: 0 }],
      },
    });

    expect(res.courseId).toBe('c1');

    const courseArg = tx.course.create.mock.calls[0][0].data;
    expect(courseArg).toMatchObject({
      type: 'video',
      isGlobal: true,
      createdBy: 'sys-1',
      status: 'published',
    });

    const lessonArg = tx.lesson.create.mock.calls[0][0].data;
    expect(lessonArg).toMatchObject({
      courseId: 'c1',
      videoProvider: 'self',
      videoStorageUri: 'gcs://b/v.mp4',
      order: 1,
    });

    const quizArg = tx.quiz.create.mock.calls[0][0].data;
    expect(quizArg).toMatchObject({ lessonId: 'l1', passingScore: 80 });

    expect(tx.question.createMany).toHaveBeenCalled();
  });

  it('prefers quiz.passingScore/allowedAttempts from the parsed quiz file when present', async () => {
    tx.course.create.mockResolvedValue({ id: 'c2' });
    tx.lesson.create.mockResolvedValue({ id: 'l2' });
    tx.quiz.create.mockResolvedValue({ id: 'qz2' });

    await createVideoCourse({
      title: 'HIPAA 2',
      passingScore: 70, // form value — should be overridden
      allowedAttempts: 1, // form value — should be overridden
      videoStorageUri: 'gcs://b/v2.mp4',
      quiz: {
        passingScore: 90,
        allowedAttempts: 3,
        questions: [{ text: 'Q2', options: ['x', 'y'], correctAnswer: 'x', order: 0 }],
      },
    });

    const quizArg = tx.quiz.create.mock.calls[0][0].data;
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
        videoStorageUri: 'gcs://b/v',
        quiz: { questions: [] },
      }),
    ).rejects.toThrow();
  });
});
