/**
 * Phase 3 QA regression tests for retakeQuiz (src/app/actions/course.ts).
 *
 * Bug fixed: retakeQuiz used to mutate the latest completed QuizAttempt row
 * back into a draft (timeTaken: null, answers: [], score: 0), destroying
 * completed-attempt history and conflicting with the append-history model
 * used by /api/quiz/[id]/start and /submit (a fresh draft row is appended by
 * /start, not resurrected here). It also resolved the quiz only via the last
 * lesson, which is null for video courses whose quiz lives on the course
 * itself, and it enforced the attempt limit against a single `attemptCount`
 * field on the stale "latest" attempt row instead of counting completed
 * attempts.
 *
 * Fixed behavior under test:
 *  - never call quizAttempt.update (no mutation of history),
 *  - throws 'No attempts remaining' once completed count >= allowedAttempts,
 *  - allows retake when completed count < allowedAttempts,
 *  - allows retake when allowedAttempts is null/0 (unlimited),
 *  - resolves a course-level quiz when lessons have no quiz (video course),
 *  - prefers the last lesson's quiz over the course-level quiz when both exist,
 *  - resets enrollment fields (status in_progress, score/completedAt/
 *    attestedAt/attestationSignature all null),
 *  - throws on a foreign/missing enrollment before touching quizAttempt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth, mockWorkerAuth, mockRevalidatePath } = vi.hoisted(() => {
  const prismaMock = {
    enrollment: { findUnique: vi.fn(), update: vi.fn() },
    quizAttempt: { count: vi.fn(), update: vi.fn() },
  };
  return {
    prismaMock,
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockRevalidatePath: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { retakeQuiz } from './course';

const WORKER_ID = 'worker-1';
const ENROLLMENT_ID = 'enrollment-1';
const COURSE_ID = 'course-1';
const LESSON_QUIZ_ID = 'quiz-lesson';
const COURSE_QUIZ_ID = 'quiz-course';

function makeEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: ENROLLMENT_ID,
    userId: WORKER_ID,
    courseId: COURSE_ID,
    course: {
      lessons: [{ id: 'lesson-1', quiz: { id: LESSON_QUIZ_ID, allowedAttempts: 3 } }],
      quiz: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue({ user: { id: WORKER_ID } });
  prismaMock.quizAttempt.count.mockResolvedValue(0);
  prismaMock.enrollment.update.mockResolvedValue({});
});

describe('retakeQuiz — auth and ownership', () => {
  it('throws Unauthorized when neither admin nor worker session is present', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(retakeQuiz(ENROLLMENT_ID)).rejects.toThrow('Unauthorized');
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });

  it('throws when the enrollment does not exist', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(null);

    await expect(retakeQuiz(ENROLLMENT_ID)).rejects.toThrow('Enrollment not found or unauthorized');
  });

  it('throws when the enrollment belongs to a different user (foreign enrollment)', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment({ userId: 'other-user' }));

    await expect(retakeQuiz(ENROLLMENT_ID)).rejects.toThrow('Enrollment not found or unauthorized');
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
    expect(prismaMock.quizAttempt.update).not.toHaveBeenCalled();
  });

  it('allows an admin session that owns the enrollment (adminId matches userId)', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'admin-1' } });
    mockWorkerAuth.mockResolvedValue(null);
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment({ userId: 'admin-1' }));

    await expect(retakeQuiz(ENROLLMENT_ID)).resolves.toEqual({ success: true });
  });
});

describe('retakeQuiz — never mutates quizAttempt history (regression guard)', () => {
  it('does not call quizAttempt.update under any circumstance', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());
    prismaMock.quizAttempt.count.mockResolvedValue(1);

    await retakeQuiz(ENROLLMENT_ID);

    expect(prismaMock.quizAttempt.update).not.toHaveBeenCalled();
  });
});

describe('retakeQuiz — attempt limit enforcement', () => {
  it('throws "No attempts remaining" when completed count equals allowedAttempts', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());
    prismaMock.quizAttempt.count.mockResolvedValue(3);

    await expect(retakeQuiz(ENROLLMENT_ID)).rejects.toThrow('No attempts remaining');
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('throws "No attempts remaining" when completed count exceeds allowedAttempts', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());
    prismaMock.quizAttempt.count.mockResolvedValue(5);

    await expect(retakeQuiz(ENROLLMENT_ID)).rejects.toThrow('No attempts remaining');
  });

  it('counts only COMPLETED attempts (timeTaken not null) against the limit', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());
    prismaMock.quizAttempt.count.mockResolvedValue(2);

    await retakeQuiz(ENROLLMENT_ID);

    expect(prismaMock.quizAttempt.count).toHaveBeenCalledWith({
      where: { enrollmentId: ENROLLMENT_ID, quizId: LESSON_QUIZ_ID, timeTaken: { not: null } },
    });
    expect(prismaMock.enrollment.update).toHaveBeenCalled();
  });

  it('allows retake when completed count is below allowedAttempts', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());
    prismaMock.quizAttempt.count.mockResolvedValue(0);

    await expect(retakeQuiz(ENROLLMENT_ID)).resolves.toEqual({ success: true });
  });

  it('allows unlimited retakes when allowedAttempts is null', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({
        course: {
          lessons: [{ id: 'lesson-1', quiz: { id: LESSON_QUIZ_ID, allowedAttempts: null } }],
          quiz: null,
        },
      }),
    );

    await expect(retakeQuiz(ENROLLMENT_ID)).resolves.toEqual({ success: true });
    expect(prismaMock.quizAttempt.count).not.toHaveBeenCalled();
  });

  it('allows unlimited retakes when allowedAttempts is 0', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({
        course: {
          lessons: [{ id: 'lesson-1', quiz: { id: LESSON_QUIZ_ID, allowedAttempts: 0 } }],
          quiz: null,
        },
      }),
    );

    await expect(retakeQuiz(ENROLLMENT_ID)).resolves.toEqual({ success: true });
    expect(prismaMock.quizAttempt.count).not.toHaveBeenCalled();
  });
});

describe('retakeQuiz — quiz resolution (lesson vs. course-level)', () => {
  it('resolves the course-level quiz when no lesson has a quiz (video course path)', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({
        course: {
          lessons: [{ id: 'lesson-1', quiz: null }],
          quiz: { id: COURSE_QUIZ_ID, allowedAttempts: 2 },
        },
      }),
    );
    prismaMock.quizAttempt.count.mockResolvedValue(1);

    await retakeQuiz(ENROLLMENT_ID);

    expect(prismaMock.quizAttempt.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ quizId: COURSE_QUIZ_ID }) }),
    );
  });

  it('resolves the course-level quiz when the course has no lessons at all', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({
        course: { lessons: [], quiz: { id: COURSE_QUIZ_ID, allowedAttempts: 1 } },
      }),
    );
    prismaMock.quizAttempt.count.mockResolvedValue(0);

    await expect(retakeQuiz(ENROLLMENT_ID)).resolves.toEqual({ success: true });
    expect(prismaMock.quizAttempt.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ quizId: COURSE_QUIZ_ID }) }),
    );
  });

  it('prefers the last lesson quiz over the course-level quiz when both exist', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({
        course: {
          lessons: [{ id: 'lesson-1', quiz: { id: LESSON_QUIZ_ID, allowedAttempts: 3 } }],
          quiz: { id: COURSE_QUIZ_ID, allowedAttempts: 1 },
        },
      }),
    );
    prismaMock.quizAttempt.count.mockResolvedValue(0);

    await retakeQuiz(ENROLLMENT_ID);

    expect(prismaMock.quizAttempt.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ quizId: LESSON_QUIZ_ID }) }),
    );
  });

  it('skips the attempt-limit check entirely when neither lesson nor course has a quiz', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ course: { lessons: [{ id: 'lesson-1', quiz: null }], quiz: null } }),
    );

    await expect(retakeQuiz(ENROLLMENT_ID)).resolves.toEqual({ success: true });
    expect(prismaMock.quizAttempt.count).not.toHaveBeenCalled();
  });
});

describe('retakeQuiz — enrollment reset', () => {
  it('resets status, score, completedAt, attestedAt, and attestationSignature', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());
    prismaMock.quizAttempt.count.mockResolvedValue(0);

    await retakeQuiz(ENROLLMENT_ID);

    expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
      where: { id: ENROLLMENT_ID },
      data: {
        status: 'in_progress',
        score: null,
        completedAt: null,
        attestedAt: null,
        attestationSignature: null,
      },
    });
  });

  it('revalidates the learn page for the enrollment course and returns success', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());
    prismaMock.quizAttempt.count.mockResolvedValue(0);

    const result = await retakeQuiz(ENROLLMENT_ID);

    expect(mockRevalidatePath).toHaveBeenCalledWith(`/learn/${COURSE_ID}`);
    expect(result).toEqual({ success: true });
  });
});
