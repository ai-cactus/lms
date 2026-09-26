/**
 * Founder Q-04 (2026-09-23): once a course is archived, ALL learner actions
 * stop — access, quizzes and attestation alike.
 *
 * `startCourse` and `attestCourse` are the two ends of that journey and neither
 * had a server-action test before this change. Both are exported from a
 * `'use server'` module, which makes each one an HTTP endpoint in its own right
 * (the F-084 note in course-ai-v4.6.ts): the page that fronts them is not the
 * boundary, so the refusal has to live in the action.
 *
 * Both refusals are RETURNED, never thrown — Next.js redacts a thrown Server
 * Action message to React error #441 in production, which would reach the
 * learner as "something went wrong" instead of "this course was cancelled".
 *
 * Certificates already earned are RETAINED (same ruling). The attestation case
 * below pins the half of that which lives here: refusing a new attestation
 * writes nothing, so an attestation — and the certificate issued from it —
 * recorded before the archive is left exactly as it was.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  mockAdminAuth,
  mockWorkerAuth,
  mockNotifyOrganizationAdmins,
  mockResolveOnCompletion,
  mockCaptureServer,
} = vi.hoisted(() => ({
  prismaMock: {
    enrollment: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockNotifyOrganizationAdmins: vi.fn(),
  mockResolveOnCompletion: vi.fn(),
  mockCaptureServer: vi.fn(),
}));

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
vi.mock('@/lib/reminders/sweep', () => ({ resolveOnCompletion: mockResolveOnCompletion }));
vi.mock('@/lib/analytics/server', () => ({ captureServer: mockCaptureServer }));

import { attestCourse, startCourse } from './course';
import { ARCHIVED_COURSE_LEARNER_MESSAGE } from '@/lib/course/archived';

const WORKER_ID = 'worker-1';
const COURSE_ID = 'course-1';
const ENROLLMENT_ID = 'enrollment-1';
const ARCHIVED_AT = new Date('2026-09-20T00:00:00.000Z');

function makeStartEnrollment(archivedAt: Date | null) {
  return {
    id: ENROLLMENT_ID,
    status: 'assigned',
    progress: 0,
    startedAt: null,
    retakeOf: null,
    course: { archivedAt },
  };
}

function makeAttestEnrollment(archivedAt: Date | null) {
  return {
    id: ENROLLMENT_ID,
    courseId: COURSE_ID,
    organizationUserId: 'ou-worker',
    organizationUser: {
      userId: WORKER_ID,
      organizationId: 'org-1',
      user: { fullName: 'Ada Worker', email: 'ada@acme.test' },
    },
    course: { title: 'Infection Control', archivedAt },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue({ user: { id: WORKER_ID } });
  prismaMock.enrollment.update.mockResolvedValue({});
});

describe('startCourse — archived course (Q-04)', () => {
  it('refuses with the cancellation message and never moves the enrollment', async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue(makeStartEnrollment(ARCHIVED_AT));

    const result = await startCourse(COURSE_ID);

    expect(result).toEqual({
      success: false,
      refusedReason: ARCHIVED_COURSE_LEARNER_MESSAGE,
    });
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('records no course_started analytics for a cancelled course', async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue(makeStartEnrollment(ARCHIVED_AT));

    await startCourse(COURSE_ID);

    expect(mockCaptureServer).not.toHaveBeenCalled();
  });

  it('reads `archivedAt` through the nested course relation the archive filter cannot reach', async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue(makeStartEnrollment(null));

    await startCourse(COURSE_ID);

    expect(prismaMock.enrollment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { course: { select: { archivedAt: true } } },
      }),
    );
  });

  it('CONTROL: the same start succeeds while the course is live', async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue(makeStartEnrollment(null));

    await expect(startCourse(COURSE_ID)).resolves.toEqual({ success: true });
    expect(prismaMock.enrollment.update).toHaveBeenCalledTimes(1);
  });
});

describe('attestCourse — archived course (Q-04)', () => {
  it('refuses with the cancellation message and writes no attestation', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeAttestEnrollment(ARCHIVED_AT));

    const result = await attestCourse(ENROLLMENT_ID, 'Ada Worker', 'RN');

    expect(result).toEqual({
      success: false,
      refusedReason: ARCHIVED_COURSE_LEARNER_MESSAGE,
    });
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('fires no completion side effects — no admin notice, no reminder resolution', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeAttestEnrollment(ARCHIVED_AT));

    await attestCourse(ENROLLMENT_ID, 'Ada Worker', 'RN');

    expect(mockNotifyOrganizationAdmins).not.toHaveBeenCalled();
    expect(mockResolveOnCompletion).not.toHaveBeenCalled();
    expect(mockCaptureServer).not.toHaveBeenCalled();
  });

  it('still rejects an empty signature first — archival does not mask a bad request', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeAttestEnrollment(ARCHIVED_AT));

    await expect(attestCourse(ENROLLMENT_ID, '   ', 'RN')).rejects.toThrow(
      'Signature is required.',
    );
  });

  it('CONTROL: the same attestation is recorded while the course is live', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeAttestEnrollment(null));

    await expect(attestCourse(ENROLLMENT_ID, 'Ada Worker', 'RN')).resolves.toEqual({
      success: true,
    });
    expect(prismaMock.enrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ENROLLMENT_ID },
        data: expect.objectContaining({ status: 'attested' }),
      }),
    );
  });
});
