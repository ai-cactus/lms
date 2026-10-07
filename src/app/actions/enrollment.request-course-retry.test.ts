/**
 * requestCourseRetry is the learner asking to try a failed course again, so it
 * counts as engagement and stamps `lastActivityAt` in the reset it already does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth, mockWorkerAuth, mockNotifyAdmins } = vi.hoisted(() => ({
  prismaMock: { enrollment: { findUnique: vi.fn(), update: vi.fn() } },
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockNotifyAdmins: vi.fn(),
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
  notifyOrganizationAdmins: mockNotifyAdmins,
  createNotification: vi.fn(),
}));

import {
  LEARNER_ENROLLMENT_UNAVAILABLE_MESSAGE,
  LEARNER_SIGNED_OUT_MESSAGE,
} from '@/lib/enrollment/learner-refusals';
import { requestCourseRetry } from './enrollment';

const ENROLLMENT = {
  id: 'enr-1',
  organizationUserId: 'ou-1',
  courseId: 'course-1',
  course: { title: 'HIPAA', archivedAt: null },
  organizationUser: { id: 'ou-1', organizationId: 'org-1', user: { fullName: 'Ada', email: null } },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue({ user: { id: 'user-1', organizationUserId: 'ou-1' } });
  prismaMock.enrollment.findUnique.mockResolvedValue(ENROLLMENT);
  prismaMock.enrollment.update.mockResolvedValue({});
  mockNotifyAdmins.mockResolvedValue(undefined);
});

describe('requestCourseRetry — learner activity', () => {
  it('stamps lastActivityAt in the same update that resets the enrollment', async () => {
    await requestCourseRetry('enr-1');

    expect(prismaMock.enrollment.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
      where: { id: 'enr-1' },
      data: { status: 'enrolled', score: null, lastActivityAt: expect.any(Date) },
    });
  });

  it('writes nothing when the enrollment belongs to another member', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({
      ...ENROLLMENT,
      organizationUserId: 'ou-other',
    });

    await expect(requestCourseRetry('enr-1')).resolves.toEqual({
      success: false,
      refusedReason: LEARNER_ENROLLMENT_UNAVAILABLE_MESSAGE,
    });
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  // BUG-60: refused by RETURN, because production redacts a thrown message.
  it('refuses with the signed-out message when neither session is present', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(requestCourseRetry('enr-1')).resolves.toEqual({
      success: false,
      refusedReason: LEARNER_SIGNED_OUT_MESSAGE,
    });
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });
});
