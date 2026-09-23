/**
 * Founder Q-04 (2026-09-23): every learner action stops when the course is
 * archived. Two of them live in `enrollment.ts`.
 *
 * `requestCourseRetry` is the learner's own "let me try again" — it nulls
 * `score` and drops the enrollment back to `enrolled`, so allowing it on a
 * cancelled course would destroy a recorded result in exchange for an attempt
 * that can never be completed.
 *
 * `submitQuizAttempt` is the Server Action twin of `POST /api/quiz/[id]/submit`.
 * It currently has NO caller anywhere in `src/` — but everything exported from a
 * `'use server'` module is an HTTP endpoint (the F-084 note in
 * course-ai-v4.6.ts), so it is reachable, and it is the weaker of the two paths:
 * no billing gate, no attempt limit, no quiz↔course match. It is gated here for
 * that reason; whether it should exist at all is a separate question.
 *
 * Both refuse by RETURN, never by throw — production redacts thrown Server
 * Action messages to React error #441.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth, mockWorkerAuth, mockNotifyOrganizationAdmins } = vi.hoisted(
  () => ({
    prismaMock: {
      enrollment: { findUnique: vi.fn(), update: vi.fn() },
      quiz: { findUnique: vi.fn() },
      quizAttempt: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    },
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockNotifyOrganizationAdmins: vi.fn(),
  }),
);

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('@/lib/notifications/create', () => ({
  createNotification: vi.fn(),
  notifyOrganizationAdmins: mockNotifyOrganizationAdmins,
}));
vi.mock('@/lib/analytics/server', () => ({ captureServer: vi.fn() }));
vi.mock('@/lib/video/playback-cache', () => ({ invalidatePlaybackAuthz: vi.fn() }));

import { requestCourseRetry, submitQuizAttempt } from './enrollment';
import { ARCHIVED_COURSE_LEARNER_MESSAGE } from '@/lib/course/archived';

const ORG_USER_ID = 'ou-worker';
const ENROLLMENT_ID = 'enrollment-1';
const ARCHIVED_AT = new Date('2026-09-20T00:00:00.000Z');

function makeEnrollment(archivedAt: Date | null) {
  return {
    id: ENROLLMENT_ID,
    courseId: 'course-1',
    organizationUserId: ORG_USER_ID,
    organizationUser: {
      organizationId: 'org-1',
      id: ORG_USER_ID,
      user: { fullName: 'Ada Worker', email: 'ada@acme.test' },
    },
    course: { title: 'Infection Control', archivedAt },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue({
    user: { id: 'user-1', organizationUserId: ORG_USER_ID, organizationId: 'org-1' },
  });
  prismaMock.enrollment.update.mockResolvedValue({});
  prismaMock.quizAttempt.findFirst.mockResolvedValue(null);
  prismaMock.quiz.findUnique.mockResolvedValue({
    id: 'quiz-1',
    passingScore: 80,
    questions: [{ id: 'q1', correctAnswer: 'a' }],
  });
});

describe('requestCourseRetry — archived course (Q-04)', () => {
  it('refuses and leaves the recorded score alone', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(ARCHIVED_AT));

    const result = await requestCourseRetry(ENROLLMENT_ID);

    expect(result).toEqual({
      success: false,
      refusedReason: ARCHIVED_COURSE_LEARNER_MESSAGE,
    });
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
    expect(mockNotifyOrganizationAdmins).not.toHaveBeenCalled();
  });

  it('CONTROL: the same request succeeds while the course is live', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(null));

    await expect(requestCourseRetry(ENROLLMENT_ID)).resolves.toEqual({ success: true });
    expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
      where: { id: ENROLLMENT_ID },
      data: { status: 'enrolled', score: null },
    });
  });
});

describe('submitQuizAttempt — archived course (Q-04)', () => {
  it('refuses before the quiz is loaded and grades nothing', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(ARCHIVED_AT));

    const result = await submitQuizAttempt(ENROLLMENT_ID, 'quiz-1', [
      { questionId: 'q1', selectedAnswer: 'a' },
    ]);

    expect(result.refusedReason).toBe(ARCHIVED_COURSE_LEARNER_MESSAGE);
    expect(prismaMock.quiz.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.quizAttempt.create).not.toHaveBeenCalled();
    expect(prismaMock.quizAttempt.update).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('CONTROL: the same submission is graded while the course is live', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(null));

    const result = await submitQuizAttempt(ENROLLMENT_ID, 'quiz-1', [
      { questionId: 'q1', selectedAnswer: 'a' },
    ]);

    expect(result.refusedReason).toBeUndefined();
    expect(result.score).toBe(100);
    expect(prismaMock.quizAttempt.create).toHaveBeenCalledTimes(1);
  });
});
