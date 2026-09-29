/**
 * Learner-initiated course actions stamp `enrollments.last_activity_at`, which
 * the dormant-staff rules read. attestCourse and startCourse fold the stamp into
 * the update they already make; re-opening an already-started course has no
 * update of its own, so it goes through the throttled touch helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth, mockWorkerAuth } = vi.hoisted(() => ({
  prismaMock: {
    enrollment: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/analytics/server', () => ({ captureServer: vi.fn() }));
vi.mock('@/lib/notifications/create', () => ({
  notifyOrganizationAdmins: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn(),
}));
vi.mock('@/lib/reminders/sweep', () => ({ resolveOnCompletion: vi.fn() }));

import { attestCourse, startCourse } from './course';

const USER_ID = 'user-1';

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue({ user: { id: USER_ID } });
  prismaMock.enrollment.update.mockResolvedValue({});
  prismaMock.enrollment.updateMany.mockResolvedValue({ count: 1 });
});

describe('attestCourse — learner activity', () => {
  it('stamps lastActivityAt with the same instant as attestedAt', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({
      id: 'enr-1',
      courseId: 'course-1',
      organizationUserId: 'ou-1',
      organizationUser: { userId: USER_ID, organizationId: 'org-1', user: { fullName: 'Ada' } },
      course: { title: 'HIPAA', archivedAt: null },
    });

    await attestCourse('enr-1', 'Ada Lovelace', '');

    // Conditional write (RISK-10): `updateMany` so a replay cannot re-stamp.
    const { data } = prismaMock.enrollment.updateMany.mock.calls[0][0];
    expect(data.status).toBe('attested');
    expect(data.attestedAt).toBeInstanceOf(Date);
    expect(data.lastActivityAt).toBe(data.attestedAt);
  });
});

describe('startCourse — learner activity', () => {
  it('stamps lastActivityAt in the update that moves an assigned enrollment to in_progress', async () => {
    const startedAt = new Date('2026-09-01T00:00:00.000Z');
    prismaMock.enrollment.findFirst.mockResolvedValue({
      id: 'enr-1',
      status: 'enrolled',
      progress: 0,
      startedAt,
      retakeOf: null,
      course: { archivedAt: null },
    });

    await startCourse('course-1');

    expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
      where: { id: 'enr-1' },
      data: {
        status: 'in_progress',
        progress: 1,
        startedAt,
        lastActivityAt: expect.any(Date),
      },
    });
    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it('records throttled activity when a started course is re-opened ("Continue Course")', async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue({
      id: 'enr-1',
      status: 'in_progress',
      progress: 40,
      startedAt: new Date(),
      retakeOf: null,
      course: { archivedAt: null },
    });

    await startCourse('course-1');

    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'enr-1' }),
        data: { lastActivityAt: expect.any(Date) },
      }),
    );
  });
});
