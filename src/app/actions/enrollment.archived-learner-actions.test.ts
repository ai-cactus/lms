/**
 * Founder Q-04 (2026-09-23): every learner action stops when the course is
 * archived. `requestCourseRetry` is the one in `enrollment.ts`.
 *
 * Asking for a retake of a cancelled course would page the admins about
 * training that can never be completed, so it is refused before the request is
 * recorded or anyone is notified.
 *
 * It refuses by RETURN, never by throw — production redacts thrown Server
 * Action messages to React error #441.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth, mockWorkerAuth, mockNotifyLearnerAdmins } = vi.hoisted(() => ({
  prismaMock: {
    enrollment: { findFirst: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  },
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockNotifyLearnerAdmins: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('@/lib/notifications/create', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/notifications/facility-audience', () => ({
  notifyLearnerAdmins: mockNotifyLearnerAdmins,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 4, resetInSeconds: 3600 }),
}));
vi.mock('@/lib/email', () => ({ sendCourseRetryRequestedEmail: vi.fn() }));
vi.mock('@/lib/analytics/server', () => ({ captureServer: vi.fn() }));
vi.mock('@/lib/video/playback-cache', () => ({ invalidatePlaybackAuthz: vi.fn() }));

import { requestCourseRetry } from './enrollment';
import { ARCHIVED_COURSE_LEARNER_MESSAGE } from '@/lib/course/archived';

const ORG_USER_ID = 'ou-worker';
const ENROLLMENT_ID = 'enrollment-1';
const ARCHIVED_AT = new Date('2026-09-20T00:00:00.000Z');

function makeLockedEnrollment(archivedAt: Date | null) {
  return {
    id: ENROLLMENT_ID,
    status: 'locked',
    retryRequestedAt: null,
    courseId: 'course-1',
    course: { title: 'Infection Control', archivedAt },
    organizationUser: {
      organizationId: 'org-1',
      user: { fullName: 'Ada Worker', email: 'ada@acme.test' },
      organization: { subscription: { status: 'active', pausedAt: null } },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue({
    user: { id: 'user-1', organizationUserId: ORG_USER_ID, organizationId: 'org-1' },
  });
  prismaMock.enrollment.count.mockResolvedValue(0);
  prismaMock.enrollment.updateMany.mockResolvedValue({ count: 1 });
});

describe('requestCourseRetry — archived course (Q-04)', () => {
  it('refuses, records nothing and notifies nobody', async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue(makeLockedEnrollment(ARCHIVED_AT));

    const result = await requestCourseRetry(ENROLLMENT_ID);

    expect(result).toEqual({
      success: false,
      refusedReason: ARCHIVED_COURSE_LEARNER_MESSAGE,
    });
    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
    expect(mockNotifyLearnerAdmins).not.toHaveBeenCalled();
  });

  it('CONTROL: the same request is recorded while the course is live', async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue(makeLockedEnrollment(null));

    await expect(requestCourseRetry(ENROLLMENT_ID)).resolves.toMatchObject({ success: true });
    expect(prismaMock.enrollment.updateMany).toHaveBeenCalledTimes(1);
    expect(mockNotifyLearnerAdmins).toHaveBeenCalledTimes(1);
  });
});
