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
    enrollment: { findUnique: vi.fn(), update: vi.fn() },
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue({ user: { id: 'user-1', organizationUserId: 'ou-1' } });
  prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());
  prismaMock.enrollment.update.mockResolvedValue({});
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
        include: { course: { select: { archivedAt: true } } },
      }),
    );
  });

  it('CONTROL: the same report is written while the course is live', async () => {
    const res = await POST(makeReq({ progress: 60 }), { params });

    expect(res.status).toBe(200);
    expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
      where: { id: 'enr-1' },
      data: { progress: 60, status: 'in_progress' },
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
      data: { progress: 100, status: 'lessons_complete' },
    });
  });
});
