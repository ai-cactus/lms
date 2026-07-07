/**
 * F-031 regression coverage — quiz start had zero automated tests.
 *
 * Append-history semantics: QuizAttempt is no longer unique on
 * (enrollmentId, quizId) — there can be several completed rows plus at most
 * one in-progress "draft" (timeTaken === null). /start must resume an
 * existing draft if present, otherwise create a new one while enforcing
 * quiz.allowedAttempts against the count of COMPLETED rows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAdminAuth, mockWorkerAuth, prismaMock, txMock } = vi.hoisted(() => {
  const txMock = {
    quizAttempt: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn() },
    quiz: { findUnique: vi.fn() },
  };
  const prismaMock = {
    enrollment: { findUnique: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  };
  return { mockAdminAuth: vi.fn(), mockWorkerAuth: vi.fn(), prismaMock, txMock };
});

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
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

const ENROLLMENT = { id: 'enr-1', userId: 'user-1', courseId: 'course-1', status: 'in_progress' };
const WORKER_SESSION = { user: { id: 'user-1', role: 'worker' } };

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue(WORKER_SESSION);

  prismaMock.enrollment.findUnique.mockResolvedValue(ENROLLMENT);
  txMock.quizAttempt.findFirst.mockResolvedValue(null);
  txMock.quiz.findUnique.mockResolvedValue({ id: 'quiz-1', allowedAttempts: 2 });
  txMock.quizAttempt.count.mockResolvedValue(0);
  txMock.quizAttempt.create.mockResolvedValue({ id: 'attempt-1', timeTaken: null });
});

describe('POST /api/quiz/[id]/start — auth', () => {
  it('401s when there is no session', async () => {
    mockWorkerAuth.mockResolvedValue(null);
    mockAdminAuth.mockResolvedValue(null);

    const res = await POST(makeReq({ enrollmentId: 'enr-1' }), { params });

    expect(res.status).toBe(401);
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });

  it('401s when MFA step-up is required but not completed', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'user-1', role: 'worker', mfaEnabled: true, mfaVerified: false },
    });

    const res = await POST(makeReq({ enrollmentId: 'enr-1' }), { params });

    expect(res.status).toBe(401);
  });

  it('403s when the enrollment does not belong to the calling session', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({ ...ENROLLMENT, userId: 'someone-else' });

    const res = await POST(makeReq({ enrollmentId: 'enr-1' }), { params });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('Enrollment does not belong to active sessions');
  });
});

describe('POST /api/quiz/[id]/start — enrollment guards', () => {
  it('404s when the enrollment does not exist', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(null);

    const res = await POST(makeReq({ enrollmentId: 'enr-1' }), { params });

    expect(res.status).toBe(404);
  });

  it('403s with QUIZ_LOCKED_MAX_ATTEMPTS when the enrollment is locked', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({ ...ENROLLMENT, status: 'locked' });

    const res = await POST(makeReq({ enrollmentId: 'enr-1' }), { params });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('QUIZ_LOCKED_MAX_ATTEMPTS');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('POST /api/quiz/[id]/start — draft resume vs. new attempt', () => {
  it('resumes the latest in-progress draft when one exists', async () => {
    const draft = { id: 'draft-1', enrollmentId: 'enr-1', quizId: 'quiz-1', timeTaken: null };
    txMock.quizAttempt.findFirst.mockResolvedValue(draft);

    const res = await POST(makeReq({ enrollmentId: 'enr-1' }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe('Resumed active attempt');
    expect(body.attempt).toEqual(draft);
    expect(txMock.quizAttempt.create).not.toHaveBeenCalled();
  });

  it('creates a new draft attempt when no draft exists and this is the first attempt', async () => {
    txMock.quizAttempt.findFirst.mockResolvedValue(null);
    txMock.quiz.findUnique.mockResolvedValue({ id: 'quiz-1', allowedAttempts: 3 });
    txMock.quizAttempt.count.mockResolvedValue(0); // no completed attempts yet

    const res = await POST(makeReq({ enrollmentId: 'enr-1' }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe('Started first attempt');
    expect(txMock.quizAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        enrollmentId: 'enr-1',
        quizId: 'quiz-1',
        timeTaken: null,
        attemptCount: 1,
      }),
    });
  });

  it('creates a subsequent draft attempt (message "Started new attempt") when prior completed attempts exist', async () => {
    txMock.quizAttempt.findFirst.mockResolvedValue(null);
    txMock.quiz.findUnique.mockResolvedValue({ id: 'quiz-1', allowedAttempts: 3 });
    txMock.quizAttempt.count.mockResolvedValue(1); // 1 completed attempt already

    const res = await POST(makeReq({ enrollmentId: 'enr-1' }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe('Started new attempt');
    expect(txMock.quizAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ attemptCount: 2 }),
    });
  });

  it('403s with "No attempts remaining" when completed attempts already reach the limit', async () => {
    txMock.quizAttempt.findFirst.mockResolvedValue(null);
    txMock.quiz.findUnique.mockResolvedValue({ id: 'quiz-1', allowedAttempts: 2 });
    txMock.quizAttempt.count.mockResolvedValue(2);

    const res = await POST(makeReq({ enrollmentId: 'enr-1' }), { params });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('No attempts remaining');
    expect(txMock.quizAttempt.create).not.toHaveBeenCalled();
  });
});
