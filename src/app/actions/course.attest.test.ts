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
    enrollment: { findUnique: vi.fn(), updateMany: vi.fn() },
    quizAttempt: { findFirst: vi.fn() },
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

import {
  LEARNER_ENROLLMENT_UNAVAILABLE_MESSAGE,
  LEARNER_SIGNED_OUT_MESSAGE,
} from '@/lib/enrollment/learner-refusals';
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
    progress: 100,
    course: { title: 'Bloodborne Pathogens', quiz: null, lessons: [] },
    ...overrides,
  };
}

function updateData(): Record<string, unknown> {
  const call = prismaMock.enrollment.updateMany.mock.calls[0]?.[0] as
    { data: Record<string, unknown> } | undefined;
  if (!call) throw new Error('enrollment.updateMany was never called');
  return call.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue({ user: { id: WORKER_ID } });
  prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());
  prismaMock.enrollment.updateMany.mockResolvedValue({ count: 1 });
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
  // BUG-60: refused by RETURN, because production redacts a thrown message.
  it('refuses with the signed-out message when neither session is present', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(attestCourse(ENROLLMENT_ID, SIGNATURE, 'Nurse')).resolves.toEqual({
      success: false,
      refusedReason: LEARNER_SIGNED_OUT_MESSAGE,
    });
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a missing enrollment with the same message as a foreign one', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(null);

    await expect(attestCourse(ENROLLMENT_ID, SIGNATURE, 'Nurse')).resolves.toEqual({
      success: false,
      refusedReason: LEARNER_ENROLLMENT_UNAVAILABLE_MESSAGE,
    });
    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it('refuses when neither session owns the enrollment, leaving completedAt unwritten', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({
        organizationUser: {
          userId: 'someone-else',
          organizationId: 'org-1',
          user: { fullName: 'Other', email: 'other@example.com' },
        },
      }),
    );

    await expect(attestCourse(ENROLLMENT_ID, SIGNATURE, 'Nurse')).resolves.toEqual({
      success: false,
      refusedReason: LEARNER_ENROLLMENT_UNAVAILABLE_MESSAGE,
    });
    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a blank signature without recording a completion', async () => {
    await expect(attestCourse(ENROLLMENT_ID, '   ', 'Nurse')).rejects.toThrow(
      'Signature is required.',
    );
    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * RISK-10 (ruled 2026-09-28: refuse, no side effects). `attestedAt` dates the
 * compliance record and `completedAt` starts the renewal clock, so replaying the
 * action must move neither — and must not re-notify admins or re-fire analytics.
 */
describe('attestCourse — an existing attestation is never re-stamped (RISK-10)', () => {
  const ALREADY_ATTESTED = {
    success: false,
    refusedReason: 'This course has already been attested.',
    alreadyAttested: true,
  };

  it('refuses an already-attested enrollment with zero writes and zero side effects', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ status: 'attested', attestedAt: new Date('2026-01-01') }),
    );

    await expect(attestCourse(ENROLLMENT_ID, SIGNATURE, 'Nurse')).resolves.toEqual(
      ALREADY_ATTESTED,
    );

    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
    expect(mockNotifyOrganizationAdmins).not.toHaveBeenCalled();
    expect(mockCaptureServer).not.toHaveBeenCalled();
    expect(mockResolveOnCompletion).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it('writes conditionally, so the row cannot be stamped once it is attested', async () => {
    await attestCourse(ENROLLMENT_ID, SIGNATURE, 'Nurse');

    expect(prismaMock.enrollment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ENROLLMENT_ID, status: { not: 'attested' } } }),
    );
  });

  // Both calls pass the pre-read before either writes — the interleaving the
  // conditional write exists for. The fake row flips on the first write, as
  // Postgres would, so the second write matches nothing.
  it('two concurrent calls produce exactly one attestation and one set of side effects', async () => {
    let attested = false;
    prismaMock.enrollment.updateMany.mockImplementation(async () => {
      if (attested) return { count: 0 };
      attested = true;
      return { count: 1 };
    });

    const results = await Promise.all([
      attestCourse(ENROLLMENT_ID, SIGNATURE, 'Nurse'),
      attestCourse(ENROLLMENT_ID, SIGNATURE, 'Nurse'),
    ]);

    expect(results).toContainEqual({ success: true });
    expect(results).toContainEqual(ALREADY_ATTESTED);
    expect(mockNotifyOrganizationAdmins).toHaveBeenCalledTimes(1);
    expect(mockCaptureServer).toHaveBeenCalledTimes(1);
    expect(mockResolveOnCompletion).toHaveBeenCalledTimes(1);
  });
});

/**
 * BUG-28: a course with no quiz reaches `lessons_complete` when its last lesson
 * is done and has nowhere further to go. Attestation is the completion act, so
 * that status must be attestable — this pins that the action accepts it.
 */
describe('attestCourse — a no-quiz course at lessons_complete (BUG-28)', () => {
  it('attests an enrollment whose lessons are complete', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ status: 'lessons_complete', progress: 100 }),
    );

    await expect(attestCourse(ENROLLMENT_ID, SIGNATURE, '')).resolves.toEqual({ success: true });
    expect(updateData()).toMatchObject({ status: 'attested', attestationSignature: SIGNATURE });
    expect(mockNotifyOrganizationAdmins).toHaveBeenCalledTimes(1);
  });
});

/**
 * Q-27 (ruled: enforce "finished before attest" on the server). The UI offers
 * the attestation only after a pass or at the end of the last lesson, but the
 * Server Action is callable directly, so the action re-derives the finish line.
 */
describe('attestCourse — the course must be finished first (Q-27)', () => {
  const QUIZ = { id: 'quiz-1', passingScore: 80 };
  const QUIZ_NOT_PASSED = {
    success: false,
    refusedReason: 'You need to pass this course’s quiz before you can attest to completing it.',
  };
  const LESSONS_NOT_COMPLETE = {
    success: false,
    refusedReason:
      'You need to finish every lesson in this course before you can attest to completing it.',
  };

  function withLessonQuiz(overrides: Record<string, unknown> = {}) {
    return makeEnrollment({
      status: 'in_progress',
      progress: 100,
      course: { title: 'Bloodborne Pathogens', quiz: null, lessons: [{ quiz: QUIZ }] },
      ...overrides,
    });
  }

  function expectNoSideEffects() {
    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
    expect(mockNotifyOrganizationAdmins).not.toHaveBeenCalled();
    expect(mockCaptureServer).not.toHaveBeenCalled();
    expect(mockResolveOnCompletion).not.toHaveBeenCalled();
  }

  it('refuses a quiz course the learner has never submitted an attempt for', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(withLessonQuiz({ progress: 40 }));
    prismaMock.quizAttempt.findFirst.mockResolvedValue(null);

    await expect(attestCourse(ENROLLMENT_ID, SIGNATURE, '')).resolves.toEqual(QUIZ_NOT_PASSED);
    expectNoSideEffects();
  });

  it('refuses when the latest submitted attempt is below the quiz’s passing score', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(withLessonQuiz());
    prismaMock.quizAttempt.findFirst.mockResolvedValue({ score: 79 });

    await expect(attestCourse(ENROLLMENT_ID, SIGNATURE, '')).resolves.toEqual(QUIZ_NOT_PASSED);
    expectNoSideEffects();
  });

  it('attests once the latest submitted attempt meets the passing score', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(withLessonQuiz());
    prismaMock.quizAttempt.findFirst.mockResolvedValue({ score: 80 });

    await expect(attestCourse(ENROLLMENT_ID, SIGNATURE, '')).resolves.toEqual({ success: true });
    expect(updateData()).toMatchObject({ status: 'attested' });
  });

  it('judges fail-then-pass on the latest SUBMITTED attempt at the assessment quiz', async () => {
    // The query returns the newest submission, so a pass after a fail attests.
    // An in-progress draft (timeTaken null) is not a submission and never counts.
    prismaMock.enrollment.findUnique.mockResolvedValue(withLessonQuiz());
    prismaMock.quizAttempt.findFirst.mockResolvedValue({ score: 95 });

    await expect(attestCourse(ENROLLMENT_ID, SIGNATURE, '')).resolves.toEqual({ success: true });
    expect(prismaMock.quizAttempt.findFirst).toHaveBeenCalledWith({
      where: { enrollmentId: ENROLLMENT_ID, quizId: QUIZ.id, timeTaken: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: { score: true },
    });
  });

  it('holds a video course to its course-level quiz', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      withLessonQuiz({
        course: {
          title: 'Hand Hygiene',
          quiz: { id: 'course-quiz', passingScore: 70 },
          lessons: [{ quiz: null }],
        },
      }),
    );
    prismaMock.quizAttempt.findFirst.mockResolvedValue({ score: 60 });

    await expect(attestCourse(ENROLLMENT_ID, SIGNATURE, '')).resolves.toEqual(QUIZ_NOT_PASSED);
    expect(prismaMock.quizAttempt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ quizId: 'course-quiz' }) }),
    );
  });

  it('attests a passed retake enrolment on the strength of its own attempts', async () => {
    // A retake is a new enrolment (retakeOf → the locked one); its attempts are
    // keyed to its own id, so it is judged only on what it submitted.
    prismaMock.enrollment.findUnique.mockResolvedValue(
      withLessonQuiz({ id: 'retake-1', retakeOf: ENROLLMENT_ID }),
    );
    prismaMock.quizAttempt.findFirst.mockResolvedValue({ score: 85 });

    await expect(attestCourse('retake-1', SIGNATURE, '')).resolves.toEqual({ success: true });
    expect(prismaMock.quizAttempt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ enrollmentId: 'retake-1' }) }),
    );
  });

  it('refuses a no-quiz course whose lessons are not all read', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ status: 'in_progress', progress: 67 }),
    );

    await expect(attestCourse(ENROLLMENT_ID, SIGNATURE, '')).resolves.toEqual(LESSONS_NOT_COMPLETE);
    expectNoSideEffects();
    expect(prismaMock.quizAttempt.findFirst).not.toHaveBeenCalled();
  });

  it('still reports an existing attestation as already attested, not as unfinished', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      withLessonQuiz({ status: 'attested', progress: 100 }),
    );
    prismaMock.quizAttempt.findFirst.mockResolvedValue(null);

    await expect(attestCourse(ENROLLMENT_ID, SIGNATURE, '')).resolves.toMatchObject({
      alreadyAttested: true,
    });
  });
});
