/**
 * requestCourseRetry — a LOCKED learner asks their admins for a retake (Q-35).
 *
 * SEC-18 regression guard: the old action reset ANY enrolment it was handed to
 * `enrolled` with a null score, so a locked learner lifted their own lockout and
 * a completed/attested learner erased signed-off training. The rewrite writes
 * only `retryRequestedAt` (+ `lastActivityAt`), only on a `locked` row, and
 * never `status` or `score`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  prismaMock,
  mockAdminAuth,
  mockWorkerAuth,
  mockNotifyLearnerAdmins,
  mockCheckRateLimit,
  mockSendEmail,
  mockCaptureServer,
} = vi.hoisted(() => ({
  prismaMock: {
    enrollment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  },
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockNotifyLearnerAdmins: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockSendEmail: vi.fn(),
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
vi.mock('@/lib/analytics/server', () => ({ captureServer: mockCaptureServer }));
vi.mock('@/lib/notifications/create', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/notifications/facility-audience', () => ({
  notifyLearnerAdmins: mockNotifyLearnerAdmins,
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock('@/lib/email', () => ({ sendCourseRetryRequestedEmail: mockSendEmail }));

import {
  LEARNER_ENROLLMENT_UNAVAILABLE_MESSAGE,
  LEARNER_SIGNED_OUT_MESSAGE,
} from '@/lib/enrollment/learner-refusals';
import {
  RETRY_REQUEST_MFA_REQUIRED_MESSAGE,
  RETRY_REQUEST_NOT_LOCKED_MESSAGE,
  RETRY_REQUEST_RATE_LIMITED_MESSAGE,
  RETRY_REQUEST_RETAKE_EXISTS_MESSAGE,
} from '@/lib/enrollment/retry-request';
import { TRAINING_ACCESS_PAUSED_MESSAGE } from '@/lib/billing';
import { ARCHIVED_COURSE_LEARNER_MESSAGE } from '@/lib/course/archived';
import { requestCourseRetry } from './enrollment';

const NOW = new Date('2026-10-07T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const ENROLLMENT_ID = 'enr-1';
const LEARNER = 'ou-1';

function makeEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: ENROLLMENT_ID,
    status: 'locked',
    retryRequestedAt: null,
    courseId: 'course-1',
    course: { title: 'HIPAA Basics', archivedAt: null },
    organizationUser: {
      organizationId: 'org-1',
      user: { fullName: 'Ada Lovelace', email: 'ada@acme.test' },
      organization: { subscription: { status: 'active', pausedAt: null } },
    },
    ...overrides,
  };
}

function workerSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: 'user-1', organizationUserId: LEARNER, ...overrides } };
}

function expectNoWrite() {
  expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
  expect(mockNotifyLearnerAdmins).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue(workerSession());
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4, resetInSeconds: 3600 });
  prismaMock.enrollment.findFirst.mockResolvedValue(makeEnrollment());
  prismaMock.enrollment.count.mockResolvedValue(0);
  prismaMock.enrollment.updateMany.mockResolvedValue({ count: 1 });
  mockNotifyLearnerAdmins.mockResolvedValue(undefined);
  mockSendEmail.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('requestCourseRetry — SEC-18: never resets an enrolment', () => {
  it.each(['in_progress', 'completed', 'attested', 'enrolled', 'lessons_complete'])(
    'refuses a %s enrolment and writes nothing',
    async (status) => {
      prismaMock.enrollment.findFirst.mockResolvedValue(makeEnrollment({ status }));

      await expect(requestCourseRetry(ENROLLMENT_ID)).resolves.toEqual({
        success: false,
        refusedReason: RETRY_REQUEST_NOT_LOCKED_MESSAGE,
      });
      expectNoWrite();
    },
  );

  it('never writes status or score, even on an eligible locked enrolment', async () => {
    await requestCourseRetry(ENROLLMENT_ID);

    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
    const [{ data, where }] = prismaMock.enrollment.updateMany.mock.calls[0];
    expect(data).toEqual({ retryRequestedAt: NOW, lastActivityAt: NOW });
    expect(where).toMatchObject({
      id: ENROLLMENT_ID,
      organizationUserId: LEARNER,
      status: 'locked',
    });
  });

  it('emits no retake analytics — a request is not a retake', async () => {
    await requestCourseRetry(ENROLLMENT_ID);

    expect(mockCaptureServer).not.toHaveBeenCalled();
  });
});

describe('requestCourseRetry — first request', () => {
  it('records the request and notifies the admins once, with the enrolment and the deep link', async () => {
    const result = await requestCourseRetry(ENROLLMENT_ID);

    expect(result).toEqual({ success: true, requestedAt: NOW.toISOString() });
    expect(mockNotifyLearnerAdmins).toHaveBeenCalledTimes(1);
    const [orgId, learnerId, notice, sendEmail] = mockNotifyLearnerAdmins.mock.calls[0];
    expect(orgId).toBe('org-1');
    expect(learnerId).toBe(LEARNER);
    expect(notice).toMatchObject({
      type: 'COURSE_RETRY_REQUESTED',
      linkUrl: `/dashboard/staff/${LEARNER}?retake=${ENROLLMENT_ID}`,
      metadata: {
        enrollmentId: ENROLLMENT_ID,
        organizationUserId: LEARNER,
        courseId: 'course-1',
        workerName: 'Ada Lovelace',
        courseName: 'HIPAA Basics',
      },
    });

    await sendEmail({ organizationUserId: 'ou-admin', email: 'boss@acme.test' });
    expect(mockSendEmail).toHaveBeenCalledWith(
      'boss@acme.test',
      'Ada Lovelace',
      'HIPAA Basics',
      `/dashboard/staff/${LEARNER}?retake=${ENROLLMENT_ID}`,
    );
  });

  it('claims only a locked row with no request, or one older than 72 hours', async () => {
    await requestCourseRetry(ENROLLMENT_ID);

    const [{ where }] = prismaMock.enrollment.updateMany.mock.calls[0];
    expect(where.OR).toEqual([
      { retryRequestedAt: null },
      { retryRequestedAt: { lte: new Date(NOW.getTime() - 72 * HOUR) } },
    ]);
  });

  it('reads the enrolment only for its owner', async () => {
    await requestCourseRetry(ENROLLMENT_ID);

    expect(prismaMock.enrollment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ENROLLMENT_ID, organizationUserId: LEARNER } }),
    );
  });
});

describe('requestCourseRetry — repeats', () => {
  it('answers alreadyRequested inside 72 hours, with no write and no notice', async () => {
    const earlier = new Date(NOW.getTime() - 10 * HOUR);
    prismaMock.enrollment.findFirst.mockResolvedValue(
      makeEnrollment({ retryRequestedAt: earlier }),
    );

    await expect(requestCourseRetry(ENROLLMENT_ID)).resolves.toEqual({
      success: true,
      alreadyRequested: true,
      requestedAt: earlier.toISOString(),
    });
    expectNoWrite();
  });

  it('re-notifies once 72 hours have passed', async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue(
      makeEnrollment({ retryRequestedAt: new Date(NOW.getTime() - 73 * HOUR) }),
    );

    await expect(requestCourseRetry(ENROLLMENT_ID)).resolves.toEqual({
      success: true,
      requestedAt: NOW.toISOString(),
    });
    expect(prismaMock.enrollment.updateMany).toHaveBeenCalledTimes(1);
    expect(mockNotifyLearnerAdmins).toHaveBeenCalledTimes(1);
  });

  it('answers alreadyRequested without notifying when a concurrent request won the claim', async () => {
    const winner = new Date(NOW.getTime() - 1000);
    prismaMock.enrollment.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.enrollment.findFirst
      .mockResolvedValueOnce(makeEnrollment())
      .mockResolvedValueOnce({ status: 'locked', retryRequestedAt: winner });

    await expect(requestCourseRetry(ENROLLMENT_ID)).resolves.toEqual({
      success: true,
      alreadyRequested: true,
      requestedAt: winner.toISOString(),
    });
    expect(mockNotifyLearnerAdmins).not.toHaveBeenCalled();
  });
});

describe('requestCourseRetry — refusals', () => {
  it('refuses an archived course', async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue(
      makeEnrollment({ course: { title: 'HIPAA Basics', archivedAt: new Date('2026-10-01') } }),
    );

    await expect(requestCourseRetry(ENROLLMENT_ID)).resolves.toEqual({
      success: false,
      refusedReason: ARCHIVED_COURSE_LEARNER_MESSAGE,
    });
    expectNoWrite();
  });

  it('refuses while billing is paused', async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue(
      makeEnrollment({
        organizationUser: {
          organizationId: 'org-1',
          user: { fullName: 'Ada', email: 'ada@acme.test' },
          organization: { subscription: { status: 'active', pausedAt: new Date('2026-10-01') } },
        },
      }),
    );

    await expect(requestCourseRetry(ENROLLMENT_ID)).resolves.toEqual({
      success: false,
      refusedReason: TRAINING_ACCESS_PAUSED_MESSAGE,
    });
    expectNoWrite();
  });

  it('refuses once a retake has been granted', async () => {
    prismaMock.enrollment.count.mockResolvedValue(1);

    await expect(requestCourseRetry(ENROLLMENT_ID)).resolves.toEqual({
      success: false,
      refusedReason: RETRY_REQUEST_RETAKE_EXISTS_MESSAGE,
    });
    expect(prismaMock.enrollment.count).toHaveBeenCalledWith({
      where: { retakeOf: ENROLLMENT_ID },
    });
    expectNoWrite();
  });

  it('refuses an enrolment that is missing or belongs to someone else', async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue(null);

    await expect(requestCourseRetry(ENROLLMENT_ID)).resolves.toEqual({
      success: false,
      refusedReason: LEARNER_ENROLLMENT_UNAVAILABLE_MESSAGE,
    });
    expectNoWrite();
  });

  it('refuses a non-string id smuggled through the Server Action boundary', async () => {
    const result = await requestCourseRetry({ not: 'an id' } as unknown as string);

    expect(result.refusedReason).toBe(LEARNER_ENROLLMENT_UNAVAILABLE_MESSAGE);
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
    expectNoWrite();
  });

  it('refuses when rate limited, before reading anything', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 3600 });

    await expect(requestCourseRetry(ENROLLMENT_ID)).resolves.toEqual({
      success: false,
      refusedReason: RETRY_REQUEST_RATE_LIMITED_MESSAGE,
    });
    expect(mockCheckRateLimit).toHaveBeenCalledWith(`retry-request:${LEARNER}`, 5, 3600);
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
    expectNoWrite();
  });

  it('refuses a session still owing its MFA step-up', async () => {
    mockWorkerAuth.mockResolvedValue(workerSession({ mfaEnabled: true, mfaVerified: false }));

    await expect(requestCourseRetry(ENROLLMENT_ID)).resolves.toEqual({
      success: false,
      refusedReason: RETRY_REQUEST_MFA_REQUIRED_MESSAGE,
    });
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
  });

  // BUG-60: refused by RETURN, because production redacts a thrown message.
  it('refuses with the signed-out message when there is no worker session', async () => {
    mockWorkerAuth.mockResolvedValue(null);

    await expect(requestCourseRetry(ENROLLMENT_ID)).resolves.toEqual({
      success: false,
      refusedReason: LEARNER_SIGNED_OUT_MESSAGE,
    });
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
  });

  it('never acts on the admin portal session, even when it owns the enrolment', async () => {
    mockWorkerAuth.mockResolvedValue(null);
    mockAdminAuth.mockResolvedValue({ user: { id: 'user-1', organizationUserId: LEARNER } });

    const result = await requestCourseRetry(ENROLLMENT_ID);

    expect(result.refusedReason).toBe(LEARNER_SIGNED_OUT_MESSAGE);
    expect(mockAdminAuth).not.toHaveBeenCalled();
    expectNoWrite();
  });
});
