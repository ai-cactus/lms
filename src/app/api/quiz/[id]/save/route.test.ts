/**
 * F-031 regression coverage — quiz save (autosave/progress) had zero
 * automated tests.
 *
 * Append-history semantics: /save writes into the LATEST attempt row for the
 * enrollment+quiz (ordered by completedAt desc). If that latest row is
 * already completed (timeTaken !== null) — e.g. the draft was already
 * submitted — saving must be rejected with 409 rather than silently
 * mutating a historical, completed attempt.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAdminAuth, mockWorkerAuth, prismaMock } = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  prismaMock: {
    quizAttempt: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

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

const ANSWERS = [{ questionId: 'q1', selectedAnswer: 'A' }];
const WORKER_SESSION = { user: { id: 'user-1', role: 'worker' } };

function makeAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt-1',
    enrollmentId: 'enr-1',
    quizId: 'quiz-1',
    timeTaken: null,
    enrollment: { id: 'enr-1', userId: 'user-1' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue(WORKER_SESSION);

  prismaMock.quizAttempt.findFirst.mockResolvedValue(makeAttempt());
  prismaMock.quizAttempt.update.mockResolvedValue({});
});

describe('POST /api/quiz/[id]/save — auth', () => {
  it('401s when there is no session', async () => {
    mockWorkerAuth.mockResolvedValue(null);
    mockAdminAuth.mockResolvedValue(null);

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: ANSWERS }), { params });

    expect(res.status).toBe(401);
    expect(prismaMock.quizAttempt.findFirst).not.toHaveBeenCalled();
  });

  it('401s when MFA step-up is required but not completed', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'user-1', role: 'worker', mfaEnabled: true, mfaVerified: false },
    });

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: ANSWERS }), { params });

    expect(res.status).toBe(401);
  });

  it('403s when the latest attempt belongs to a different enrollment/user', async () => {
    prismaMock.quizAttempt.findFirst.mockResolvedValue(
      makeAttempt({ enrollment: { id: 'enr-1', userId: 'someone-else' } }),
    );

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: ANSWERS }), { params });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('Enrollment does not belong to active sessions');
    expect(prismaMock.quizAttempt.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/quiz/[id]/save', () => {
  it('404s when no attempt exists for the enrollment+quiz', async () => {
    prismaMock.quizAttempt.findFirst.mockResolvedValue(null);

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: ANSWERS }), { params });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('No attempt found');
  });

  it('writes the answers into the latest in-progress draft (timeTaken === null)', async () => {
    const draft = makeAttempt({ id: 'draft-9', timeTaken: null });
    prismaMock.quizAttempt.findFirst.mockResolvedValue(draft);

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: ANSWERS }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(prismaMock.quizAttempt.update).toHaveBeenCalledWith({
      where: { id: 'draft-9' },
      data: { answers: ANSWERS },
    });
  });

  it('409s and does not write when the latest attempt is already completed', async () => {
    prismaMock.quizAttempt.findFirst.mockResolvedValue(makeAttempt({ timeTaken: 60 }));

    const res = await POST(makeReq({ enrollmentId: 'enr-1', answers: ANSWERS }), { params });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Attempt is already completed');
    expect(prismaMock.quizAttempt.update).not.toHaveBeenCalled();
  });

  it('queries the latest attempt ordered by completedAt desc (append-history: pick the current draft, not an old row)', async () => {
    await POST(makeReq({ enrollmentId: 'enr-1', answers: ANSWERS }), { params });

    expect(prismaMock.quizAttempt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enrollmentId: 'enr-1', quizId: 'quiz-1' },
        orderBy: { completedAt: 'desc' },
      }),
    );
  });
});
