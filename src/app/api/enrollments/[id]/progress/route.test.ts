/**
 * Lesson-progress endpoint.
 *
 * Added with the Q-04 archive gate (2026-09-23), which needed coverage here and
 * found the route had none at all. Advancing progress is the plainest form of
 * "continuing the course", so it is one of the learner actions that must stop
 * the moment the course is archived — and this is the only surface that writes
 * `Enrollment.progress` for a reading course.
 *
 * The ownership and forward-only rules are pinned alongside it so the archive
 * gate cannot be mistaken later for the whole of this route's contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { prismaMock, mockAdminAuth, mockWorkerAuth } = vi.hoisted(() => ({
  prismaMock: {
    enrollment: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from './route';
import { ARCHIVED_COURSE_LEARNER_MESSAGE } from '@/lib/course/archived';

const params = Promise.resolve({ id: 'enr-1' });

function makeReq(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

function makeEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enr-1',
    courseId: 'course-1',
    organizationUserId: 'ou-1',
    progress: 10,
    status: 'in_progress',
    course: { archivedAt: null },
    organizationUser: { organization: { subscription: { status: 'active', pausedAt: null } } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue({ user: { id: 'user-1', organizationUserId: 'ou-1' } });
  prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());
  prismaMock.enrollment.update.mockResolvedValue({});
  prismaMock.enrollment.updateMany.mockResolvedValue({ count: 1 });
});

describe('POST /api/enrollments/[id]/progress — archived course (Q-04)', () => {
  it('403s with the cancellation message and writes no progress', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ course: { archivedAt: new Date('2026-09-20') } }),
    );

    const res = await POST(makeReq({ progress: 60 }), { params });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe(ARCHIVED_COURSE_LEARNER_MESSAGE);
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('refuses the 100% report too — a cancelled course cannot reach lessons_complete', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ course: { archivedAt: new Date('2026-09-20') } }),
    );

    const res = await POST(makeReq({ progress: 100 }), { params });

    expect(res.status).toBe(403);
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('reads `archivedAt` through the nested course relation the archive filter cannot reach', async () => {
    await POST(makeReq({ progress: 60 }), { params });

    expect(prismaMock.enrollment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ course: { select: { archivedAt: true } } }),
      }),
    );
  });

  it('CONTROL: the same report is written while the course is live', async () => {
    const res = await POST(makeReq({ progress: 60 }), { params });

    expect(res.status).toBe(200);
    expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
      where: { id: 'enr-1' },
      data: { progress: 60, status: 'in_progress', lastActivityAt: expect.any(Date) },
    });
  });
});

describe('POST /api/enrollments/[id]/progress — ownership and forward-only rules', () => {
  it('404s when the enrollment does not exist', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(null);

    const res = await POST(makeReq({ progress: 60 }), { params });

    expect(res.status).toBe(404);
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('403s when the enrollment belongs to another membership', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ organizationUserId: 'someone-else' }),
    );

    const res = await POST(makeReq({ progress: 60 }), { params });

    expect(res.status).toBe(403);
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('400s on an out-of-range progress value', async () => {
    const res = await POST(makeReq({ progress: 140 }), { params });

    expect(res.status).toBe(400);
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('never moves progress backwards', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment({ progress: 80 }));

    const res = await POST(makeReq({ progress: 20 }), { params });

    expect(res.status).toBe(200);
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('marks lessons_complete at 100% when the quiz has not been taken', async () => {
    await POST(makeReq({ progress: 100 }), { params });

    expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
      where: { id: 'enr-1' },
      data: { progress: 100, status: 'lessons_complete', lastActivityAt: expect.any(Date) },
    });
  });
});

describe('POST /api/enrollments/[id]/progress — learner activity', () => {
  it('stamps lastActivityAt in the same update that advances progress (no extra write)', async () => {
    await POST(makeReq({ progress: 60 }), { params });

    expect(prismaMock.enrollment.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it('still records (throttled) activity when progress is already ahead', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment({ progress: 80 }));

    const res = await POST(makeReq({ progress: 40 }), { params });
    const body = await res.json();

    expect(body).toEqual({ success: true, message: 'Progress already ahead' });
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'enr-1' }),
        data: { lastActivityAt: expect.any(Date) },
      }),
    );
  });

  it('records no activity on an archived course or a foreign enrollment', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValueOnce(
      makeEnrollment({ course: { archivedAt: new Date('2026-09-20') } }),
    );
    await POST(makeReq({ progress: 60 }), { params });

    prismaMock.enrollment.findUnique.mockResolvedValueOnce(
      makeEnrollment({ organizationUserId: 'someone-else' }),
    );
    await POST(makeReq({ progress: 60 }), { params });

    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * BUG-53: any forward progress below 100 used to force `in_progress`, so a
 * stray lesson ping un-finished signed training and released a learner from an
 * attempt lockout. Progress is still recorded — it is a high-water mark of what
 * was read — but the status may only advance within the reading phase.
 */
describe('POST /api/enrollments/[id]/progress — status never regresses (BUG-53)', () => {
  it.each(['completed', 'attested', 'locked', 'failed', 'retry_requested'])(
    'records progress but keeps "%s" below 100%%',
    async (status) => {
      prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment({ status, progress: 10 }));

      const res = await POST(makeReq({ progress: 60 }), { params });

      expect(res.status).toBe(200);
      expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
        where: { id: 'enr-1' },
        data: { progress: 60, status, lastActivityAt: expect.any(Date) },
      });
    },
  );

  it.each(['completed', 'attested', 'locked', 'failed', 'retry_requested'])(
    'keeps "%s" at 100%% too — lessons_complete is not a step back into the reading phase',
    async (status) => {
      prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment({ status, progress: 50 }));

      await POST(makeReq({ progress: 100 }), { params });

      expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
        where: { id: 'enr-1' },
        data: { progress: 100, status, lastActivityAt: expect.any(Date) },
      });
    },
  );

  it('does not pull lessons_complete (set by the 95% video gate) back to in_progress', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ status: 'lessons_complete', progress: 95 }),
    );

    await POST(makeReq({ progress: 97 }), { params });

    expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
      where: { id: 'enr-1' },
      data: { progress: 97, status: 'lessons_complete', lastActivityAt: expect.any(Date) },
    });
  });

  it.each(['enrolled', 'assigned'])('starts a "%s" enrolment (→ in_progress)', async (status) => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment({ status, progress: 0 }));

    await POST(makeReq({ progress: 25 }), { params });

    expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
      where: { id: 'enr-1' },
      data: { progress: 25, status: 'in_progress', lastActivityAt: expect.any(Date) },
    });
  });
});

/**
 * SEC-08: this route had only an ownership check. It now carries the same
 * session/MFA guard (F-012) and billing gate the quiz start/submit routes use,
 * with the same refusal shapes.
 */
describe('POST /api/enrollments/[id]/progress — session guard (SEC-08)', () => {
  it('401s UNAUTHENTICATED with no session and never reads the enrollment', async () => {
    mockWorkerAuth.mockResolvedValue(null);

    const res = await POST(makeReq({ progress: 60 }), { params });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'UNAUTHENTICATED' });
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });

  it('401s MFA_REQUIRED when MFA step-up is enabled but not completed', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'user-1', organizationUserId: 'ou-1', mfaEnabled: true, mfaVerified: false },
    });

    const res = await POST(makeReq({ progress: 60 }), { params });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'MFA_REQUIRED' });
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/enrollments/[id]/progress — billing gate (SEC-08)', () => {
  const PAUSED_MESSAGE =
    'Your organization’s training access is paused. Please contact your administrator.';

  it('403s and writes nothing when the subscription is paused', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({
        organizationUser: {
          organization: { subscription: { status: 'active', pausedAt: new Date('2026-09-01') } },
        },
      }),
    );

    const res = await POST(makeReq({ progress: 60 }), { params });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: PAUSED_MESSAGE });
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it('403s when the org has no subscription row at all', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ organizationUser: { organization: { subscription: null } } }),
    );

    const res = await POST(makeReq({ progress: 60 }), { params });

    expect(res.status).toBe(403);
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('checks ownership before billing, so a foreign enrollment leaks nothing about its org', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({
        organizationUserId: 'someone-else',
        organizationUser: { organization: { subscription: null } },
      }),
    );

    const res = await POST(makeReq({ progress: 60 }), { params });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Enrollment does not belong to active sessions' });
  });
});
