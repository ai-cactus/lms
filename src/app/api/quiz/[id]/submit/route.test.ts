/**
 * F-031 regression coverage — quiz submission had zero automated tests.
 *
 * Covers:
 *  - Scoring: correct-count/score computation, pass/fail at the exact
 *    passingScore boundary, and the 0-question / empty-answers guard.
 *  - Append-history semantics: the attempt limit is enforced against the
 *    count of COMPLETED attempts (timeTaken !== null); a submission under the
 *    limit CREATEs a new completed row with attemptCount = completedCount+1
 *    (there is no update path for the historical record).
 *  - Auth: guardApiSession (unauthenticated / MFA-required) and cross-user
 *    enrollment ownership.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAdminAuth, mockWorkerAuth, prismaMock, txMock, mockRevalidate } = vi.hoisted(() => {
  const txMock = {
    quizAttempt: {
      count: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(), // not used by the route; asserted as NOT called
    },
  };
  const prismaMock = {
    enrollment: { findUnique: vi.fn(), update: vi.fn() },
    quiz: { findUnique: vi.fn() },
    notification: { findFirst: vi.fn(), createMany: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  };
  return {
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    prismaMock,
    txMock,
    mockRevalidate: vi.fn(),
  };
});

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }));
vi.mock('@/lib/ai-client', () => ({ callVertexAI: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendQuizLockedEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import under test AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------
import { POST } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const params = Promise.resolve({ id: 'quiz-1' });

function makeReq(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

/** N questions, each with an embedded (v3.1) explanation so the AI fallback path is never hit. */
function makeQuestions(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i}`,
    text: `Question ${i}`,
    correctAnswer: 'A',
    options: ['A', 'B'],
    explanation: `explanation-${i}`,
  }));
}

/** Answers for the first `n` questions; the first `correctCount` are correct ('A'), the rest wrong ('B'). */
function makeAnswers(n: number, correctCount: number) {
  return Array.from({ length: n }, (_, i) => ({
    questionId: `q${i}`,
    selectedAnswer: i < correctCount ? 'A' : 'B',
  }));
}

const ENROLLMENT = {
  id: 'enr-1',
  userId: 'user-1',
  courseId: 'course-1',
  // Active billing so the defense-in-depth gate lets the attempt through.
  user: { organization: { subscription: { status: 'active', pausedAt: null } } },
};

function makeQuiz(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quiz-1',
    courseId: 'course-1',
    lesson: null,
    title: 'Quiz',
    passingScore: 70,
    allowedAttempts: 2,
    questions: makeQuestions(2),
    ...overrides,
  };
}

const WORKER_SESSION = { user: { id: 'user-1', role: 'worker' } };

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue(WORKER_SESSION);

  prismaMock.enrollment.findUnique.mockResolvedValue(ENROLLMENT);
  prismaMock.enrollment.update.mockResolvedValue({});
  prismaMock.quiz.findUnique.mockResolvedValue(makeQuiz());
  prismaMock.notification.findFirst.mockResolvedValue(null);
  prismaMock.notification.createMany.mockResolvedValue({});
  prismaMock.user.findMany.mockResolvedValue([]);

  txMock.quizAttempt.count.mockResolvedValue(0);
  txMock.quizAttempt.deleteMany.mockResolvedValue({});
  txMock.quizAttempt.create.mockResolvedValue({});
});

describe('POST /api/quiz/[id]/submit — auth', () => {
  it('401s when there is no session at all', async () => {
    mockWorkerAuth.mockResolvedValue(null);
    mockAdminAuth.mockResolvedValue(null);

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: [] }), { params });

    expect(res.status).toBe(401);
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });

  it('401s when MFA step-up is required but not completed', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'user-1', role: 'worker', mfaEnabled: true, mfaVerified: false },
    });

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: [] }), { params });

    expect(res.status).toBe(401);
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });

  it('403s when the enrollment does not belong to the calling session', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({ ...ENROLLMENT, userId: 'someone-else' });

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: makeAnswers(2, 1) }), {
      params,
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('Enrollment does not belong to active sessions');
    expect(txMock.quizAttempt.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-041-B defense in depth: the worker-portal layout blocks the whole
// portal when the org lacks active billing, but a direct POST to this route
// bypasses that render-time gate — the route must independently check
// hasActiveBilling() before allowing a quiz submission to be recorded.
// ---------------------------------------------------------------------------
describe('POST /api/quiz/[id]/submit — billing gate (TC-041-B defense in depth)', () => {
  it('403s and never opens a transaction when the subscription is paused', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({
      ...ENROLLMENT,
      user: {
        organization: { subscription: { status: 'active', pausedAt: new Date('2026-06-01') } },
      },
    });

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: makeAnswers(2, 1) }), {
      params,
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/training access is paused/i);
    expect(txMock.quizAttempt.create).not.toHaveBeenCalled();
  });

  it('403s when the org has no subscription row at all', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({
      ...ENROLLMENT,
      user: { organization: { subscription: null } },
    });

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: makeAnswers(2, 1) }), {
      params,
    });

    expect(res.status).toBe(403);
    expect(txMock.quizAttempt.create).not.toHaveBeenCalled();
  });

  it('allows the submission to proceed when billing is active', async () => {
    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: makeAnswers(2, 2) }), {
      params,
    });

    expect(res.status).toBe(200);
    expect(txMock.quizAttempt.create).toHaveBeenCalled();
  });
});

describe('POST /api/quiz/[id]/submit — scoring', () => {
  it('computes correctCount/score from matched answers', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(makeQuiz({ questions: makeQuestions(2) }));

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: makeAnswers(2, 1) }), {
      params,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.correctCount).toBe(1);
    expect(body.score).toBe(50);
    expect(body.totalQuestions).toBe(2);
  });

  it('fails when the score is exactly one point below passingScore', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(
      makeQuiz({ passingScore: 70, questions: makeQuestions(100) }),
    );

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: makeAnswers(100, 69) }), {
      params,
    });
    const body = await res.json();

    expect(body.score).toBe(69);
    expect(body.passed).toBe(false);
  });

  it('passes when the score is exactly at passingScore', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(
      makeQuiz({ passingScore: 70, questions: makeQuestions(100) }),
    );

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: makeAnswers(100, 70) }), {
      params,
    });
    const body = await res.json();

    expect(body.score).toBe(70);
    expect(body.passed).toBe(true);
  });

  it('passes when the score is above passingScore', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(
      makeQuiz({ passingScore: 70, questions: makeQuestions(100) }),
    );

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: makeAnswers(100, 85) }), {
      params,
    });
    const body = await res.json();

    expect(body.score).toBe(85);
    expect(body.passed).toBe(true);
  });

  it('scores 0 (not NaN) and does not crash when the quiz has zero questions', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(makeQuiz({ questions: [] }));

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: [] }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.score).toBe(0);
    expect(body.totalQuestions).toBe(0);
    expect(body.passed).toBe(false);
  });

  it('scores 0 correct when answers is empty but the quiz has questions', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(makeQuiz({ questions: makeQuestions(4) }));

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: [] }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.correctCount).toBe(0);
    expect(body.score).toBe(0);
    expect(body.passed).toBe(false);
  });
});

describe('POST /api/quiz/[id]/submit — append-history + attempt limit', () => {
  it('403s with "No attempts remaining" once completed attempts reach allowedAttempts', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(makeQuiz({ allowedAttempts: 2 }));
    txMock.quizAttempt.count.mockResolvedValue(2); // already 2 completed, limit is 2

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: makeAnswers(2, 1) }), {
      params,
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual(
      expect.objectContaining({
        error: 'No attempts remaining',
        attemptsUsed: 2,
        allowedAttempts: 2,
      }),
    );
    expect(txMock.quizAttempt.create).not.toHaveBeenCalled();
  });

  it('CREATEs a new completed attempt with attemptCount = completedCount + 1 when under the limit', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(makeQuiz({ allowedAttempts: 3 }));
    txMock.quizAttempt.count.mockResolvedValue(1); // 1 completed so far, limit is 3

    const res = await POST(
      makeReq({ enrollmentId: 'enr-1', answers: makeAnswers(2, 2), timeTaken: 120 }),
      { params },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(txMock.quizAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        enrollmentId: 'enr-1',
        quizId: 'quiz-1',
        attemptCount: 2,
        timeTaken: 120,
      }),
    });
    // This is an append-history CREATE, never an UPDATE of a prior row.
    expect(txMock.quizAttempt.update).not.toHaveBeenCalled();
    expect(body.attemptsUsed).toBe(2);
  });

  it('clears the leftover in-progress draft (timeTaken: null) before creating the completed row', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(makeQuiz({ allowedAttempts: 3 }));
    txMock.quizAttempt.count.mockResolvedValue(0);

    await POST(makeReq({ enrollmentId: 'enr-1', answers: makeAnswers(2, 1) }), { params });

    expect(txMock.quizAttempt.deleteMany).toHaveBeenCalledWith({
      where: { enrollmentId: 'enr-1', quizId: 'quiz-1', timeTaken: null },
    });
  });

  it('locks the enrollment and records attemptCount at the limit when the final attempt still fails', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(
      makeQuiz({ allowedAttempts: 2, passingScore: 90, questions: makeQuestions(2) }),
    );
    txMock.quizAttempt.count.mockResolvedValue(1); // this submission is the 2nd (final) attempt

    const res = await POST(
      makeReq({ enrollmentId: 'enr-1', answers: makeAnswers(2, 0) }), // fails
      { params },
    );
    const body = await res.json();

    expect(body.passed).toBe(false);
    expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
      where: { id: 'enr-1' },
      data: expect.objectContaining({ status: 'locked', lockedAt: expect.any(Date) }),
    });
  });
});
