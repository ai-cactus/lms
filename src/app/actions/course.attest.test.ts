/**
 * BUG-08 regression tests for attestCourse (src/app/actions/course.ts).
 *
 * `Enrollment.completedAt` was never written by any runtime path, so the
 * auditor exports printed a blank "Date Completed" for every learner and the
 * facility dashboard's on-time completion share — whose numerator is
 * `completedAt <= dueAt` over terminal statuses — was structurally 0.
 *
 * The semantics these tests pin: `completedAt` is the instant the enrollment
 * reached a terminal COMPLETED state, which in this product is the attestation,
 * not the quiz pass. So it is written by attestCourse in lockstep with
 * `attestedAt` (one Date, both columns) and cleared in lockstep by retakeQuiz
 * (covered in course.retake-quiz.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  mockAdminAuth,
  mockWorkerAuth,
  mockRevalidatePath,
  mockNotifyOrganizationAdmins,
  mockResolveOnCompletion,
  mockCaptureServer,
} = vi.hoisted(() => ({
  prismaMock: {
    enrollment: { findUnique: vi.fn(), update: vi.fn() },
  },
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockNotifyOrganizationAdmins: vi.fn(),
  mockResolveOnCompletion: vi.fn(),
  mockCaptureServer: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/notifications/create', () => ({
  createNotification: vi.fn(),
  notifyOrganizationAdmins: mockNotifyOrganizationAdmins,
}));
vi.mock('@/lib/reminders/sweep', () => ({ resolveOnCompletion: mockResolveOnCompletion }));
vi.mock('@/lib/analytics/server', () => ({ captureServer: mockCaptureServer }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { attestCourse } from './course';

const WORKER_ID = 'worker-1';
const ENROLLMENT_ID = 'enrollment-1';
const COURSE_ID = 'course-1';
const SIGNATURE = 'Dana Reed';

function makeEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: ENROLLMENT_ID,
    courseId: COURSE_ID,
    organizationUserId: 'ou-1',
    organizationUser: {
      userId: WORKER_ID,
      organizationId: 'org-1',
      user: { fullName: 'Dana Reed', email: 'dana@example.com' },
    },
    course: { title: 'Bloodborne Pathogens' },
    ...overrides,
  };
}

function updateData(): Record<string, unknown> {
  const call = prismaMock.enrollment.update.mock.calls[0]?.[0] as
    { data: Record<string, unknown> } | undefined;
  if (!call) throw new Error('enrollment.update was never called');
  return call.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue({ user: { id: WORKER_ID } });
  prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());
  prismaMock.enrollment.update.mockResolvedValue({});
  mockNotifyOrganizationAdmins.mockResolvedValue(undefined);
  mockResolveOnCompletion.mockResolvedValue(undefined);
});

describe('attestCourse — completion timestamp (BUG-08)', () => {
  it('stamps completedAt when the learner attests', async () => {
    await attestCourse(ENROLLMENT_ID, SIGNATURE, 'Nurse');

    expect(updateData().completedAt).toBeInstanceOf(Date);
  });

  it('writes completedAt and attestedAt as the SAME instant, so the audit export and the compliance banner cannot disagree', async () => {
    await attestCourse(ENROLLMENT_ID, SIGNATURE, 'Nurse');

    const data = updateData();
    expect(data.completedAt).toBe(data.attestedAt);
  });

  it('still moves the enrollment to the attested status and records the signature', async () => {
    await attestCourse(ENROLLMENT_ID, SIGNATURE, 'Nurse');

    expect(updateData()).toMatchObject({
      status: 'attested',
      attestationSignature: SIGNATURE,
      attestationRole: 'Nurse',
    });
  });

  it('dates the completion at attestation time, not at the earlier quiz pass', async () => {
    // The two moments can be days apart. Only `completed | attested` rows are
    // counted as completed by the exports and dashboards, so a date stamped at
    // quiz-pass would put a completion date on a row those readers still report
    // as unfinished.
    vi.useFakeTimers();
    try {
      const attestedOn = new Date('2026-06-18T09:30:00.000Z');
      vi.setSystemTime(attestedOn);

      await attestCourse(ENROLLMENT_ID, SIGNATURE, 'Nurse');

      expect(updateData().completedAt).toEqual(attestedOn);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-stamps a fresh completion after a retake cleared the previous one (history is not silently kept)', async () => {
    // retakeQuiz resets completedAt/attestedAt to null; attesting again must
    // date the NEW completion, which is what the renewal cycle counts from.
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ completedAt: null, attestedAt: null }),
    );
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));

      await attestCourse(ENROLLMENT_ID, SIGNATURE, 'Nurse');

      const data = updateData();
      expect(data.completedAt).toEqual(new Date('2026-09-01T00:00:00.000Z'));
      expect(data.completedAt).toBe(data.attestedAt);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('attestCourse — guards still hold', () => {
  it('throws Unauthorized when neither session is present', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(attestCourse(ENROLLMENT_ID, SIGNATURE, 'Nurse')).rejects.toThrow('Unauthorized');
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('throws when neither session owns the enrollment, leaving completedAt unwritten', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({
        organizationUser: {
          userId: 'someone-else',
          organizationId: 'org-1',
          user: { fullName: 'Other', email: 'other@example.com' },
        },
      }),
    );

    await expect(attestCourse(ENROLLMENT_ID, SIGNATURE, 'Nurse')).rejects.toThrow('Unauthorized');
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('refuses a blank signature without recording a completion', async () => {
    await expect(attestCourse(ENROLLMENT_ID, '   ', 'Nurse')).rejects.toThrow(
      'Signature is required.',
    );
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });
});
