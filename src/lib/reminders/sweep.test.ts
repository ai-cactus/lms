/**
 * Unit tests for src/lib/reminders/sweep.ts
 *
 * runReminderSweep covered (Track A — deadline ladder):
 *   - Stage fires when target date == today (daysSinceTarget == 0)
 *   - Already-logged stage is skipped (sentSet check)
 *   - Disabled stage config is skipped
 *   - Catch-up window: target yesterday (daysSinceTarget=1) fires when catchUpDays=1
 *   - Catch-up window: target 3 days ago skipped when catchUpDays=2
 *   - Assignment-less enrollment (null assignment) fires its due stage via stage defaults
 *   - Assignment with remindersEnabled:false excluded (modelled via empty prisma result)
 *   - Completed/attested enrollments excluded (modelled via empty prisma result)
 *   - Idempotent re-run: second run skips stages already in sentSet
 *   - Per-enrollment error isolation: one throw increments errors, others proceed
 *
 * runReminderSweep covered (Track B — quiz nudges):
 *   - in_progress + failing score + attempts remaining → WORKER_RETAKE dispatched
 *   - in_progress + passing score → skipped
 *   - in_progress + no quiz data → skipped
 *   - locked + no active retake → ADMIN_REASSIGN dispatched (resolveEscalationRecipients called)
 *   - locked + active retake exists → skipped
 *   - Per-enrollment error isolation
 *
 * resolveOnCompletion:
 *   - Calls notification.updateMany with correct type filter and metadata path
 *   - Never throws
 *
 * Dates: fixed at 2024-06-15T12:00:00Z (noon UTC = 08:00 EDT, local date "2024-06-15").
 * Enrollment dueAt = 2024-06-29T12:00:00Z (14 days later) so FRIENDLY_REMINDER
 * offset -14 lands exactly on 2024-06-15 → fires; all other stages: skip.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReminderStage } from '@/generated/prisma/enums';

/** Shape of a single AssignmentReminderStage row as selected by the sweep query. */
type StageConfig = {
  stage: ReminderStage;
  offsetDays: number;
  enabled: boolean;
  channels: string[];
};

const {
  prismaMock,
  mockDispatchLadderStage,
  mockDispatchNudge,
  mockRetryReminderEmail,
  mockResolveEscalationRecipients,
  mockRunRetentionPurge,
  mockLoggerError,
  mockCreateEnrollmentForUser,
  mockCreateNotification,
  mockSendCourseLaunchEmail,
} = vi.hoisted(() => {
  const prismaMock = {
    enrollment: { findMany: vi.fn(), create: vi.fn() },
    reminderLog: { findMany: vi.fn(), create: vi.fn() },
    quizAttempt: { findMany: vi.fn() },
    notification: { updateMany: vi.fn() },
    emailMessage: { findMany: vi.fn() },
    courseAssignment: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  };
  const mockDispatchLadderStage = vi.fn();
  const mockDispatchNudge = vi.fn();
  const mockRetryReminderEmail = vi.fn();
  const mockResolveEscalationRecipients = vi.fn();
  const mockRunRetentionPurge = vi.fn();
  const mockLoggerError = vi.fn();
  const mockCreateEnrollmentForUser = vi.fn();
  const mockCreateNotification = vi.fn();
  const mockSendCourseLaunchEmail = vi.fn();
  return {
    prismaMock,
    mockDispatchLadderStage,
    mockDispatchNudge,
    mockRetryReminderEmail,
    mockResolveEscalationRecipients,
    mockRunRetentionPurge,
    mockLoggerError,
    mockCreateEnrollmentForUser,
    mockCreateNotification,
    mockSendCourseLaunchEmail,
  };
});

vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));

vi.mock('@/lib/reminders/dispatch', () => ({
  dispatchLadderStage: mockDispatchLadderStage,
  dispatchNudge: mockDispatchNudge,
  retryReminderEmail: mockRetryReminderEmail,
  noopEmailSender: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/reminders/recipients', () => ({
  resolveEscalationRecipients: mockResolveEscalationRecipients,
}));

vi.mock('@/lib/retention', () => ({
  runRetentionPurge: mockRunRetentionPurge,
}));

// Role-target reconcile pre-pass delegates per-user enrollment creation to the
// shared helper (its own internals — cross-tenant guard, dueAt computation,
// idempotency — are covered by create.test.ts); here we only assert the
// pre-pass calls it with the right holder/context.
vi.mock('@/lib/enrollment/create', () => ({
  createEnrollmentForUser: mockCreateEnrollmentForUser,
}));

// Renewal re-trigger pre-pass notifies + emails directly (not via createEnrollmentForUser).
vi.mock('@/app/actions/notifications', () => ({
  createNotification: mockCreateNotification,
  notifyOrganizationAdmins: vi.fn(),
}));

vi.mock('@/lib/email', () => ({
  sendCourseLaunchEmail: mockSendCourseLaunchEmail,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

import { runReminderSweep, resolveOnCompletion } from './sweep';

/**
 * noon UTC June 15 = 08:00 EDT — local date is "2024-06-15" in America/New_York.
 * dueAt set 14 days out so FRIENDLY_REMINDER (offset=-14) targets exactly today.
 */
const NOW = new Date('2024-06-15T12:00:00Z');
// dueAt that makes FRIENDLY_REMINDER land exactly on TODAY.
// startOfDayInTz('2024-06-29T12:00:00Z', 'America/New_York') = '2024-06-29T04:00:00Z' (EDT)
// addDays('2024-06-29T04:00:00Z', -14) = '2024-06-15T04:00:00Z'
// diffInDaysInTz(NOW, '2024-06-15T04:00:00Z', NY) = 0 → fires ✓
const DUE_AT_FIRES_TODAY = new Date('2024-06-29T12:00:00Z');

// dueAt that makes FRIENDLY_REMINDER target yesterday (daysSinceTarget = 1).
const DUE_AT_TARGET_YESTERDAY = new Date('2024-06-28T12:00:00Z');

// dueAt that makes FRIENDLY_REMINDER target 3 days ago (daysSinceTarget = 3).
const DUE_AT_TARGET_3_DAYS_AGO = new Date('2024-06-26T12:00:00Z');

/** Assignment slice as selected by the Track A query (null when the enrollment has no CourseAssignment). */
type AssignmentSlice = { reminderStages: StageConfig[] } | null;

function makeTrackAEnrollment(
  id: string,
  dueAt: Date = DUE_AT_FIRES_TODAY,
  assignment: AssignmentSlice = { reminderStages: [] }, // default: assignment present, use stage defaults
) {
  return {
    id,
    userId: `user-${id}`,
    courseId: `course-${id}`,
    dueAt,
    assignment, // null models an assignment-less enrollment (assignmentId === null)
    course: { title: `Course ${id}` },
    user: {
      id: `user-${id}`,
      email: `worker-${id}@test.com`,
      profile: { fullName: `Worker ${id}` },
      facility: { timezone: null } as { timezone: string | null } | null, // → DEFAULT_TZ (America/New_York)
    },
  };
}

function makeTrackBEnrollment(
  id: string,
  status: 'in_progress' | 'locked',
  quiz: { passingScore: number; allowedAttempts: number } | null = {
    passingScore: 80,
    allowedAttempts: 3,
  },
) {
  return {
    id,
    userId: `user-${id}`,
    courseId: `course-${id}`,
    status,
    course: { title: `Course ${id}`, quiz },
    user: {
      id: `user-${id}`,
      email: `worker-${id}@test.com`,
      profile: { fullName: `Worker ${id}` },
    },
  };
}

const BASE_OPTS = {
  now: NOW,
  catchUpDays: 0,
  nudgeIntervalDays: 3,
  dryRun: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Safe defaults: empty result sets (both tracks empty)
  prismaMock.enrollment.findMany.mockResolvedValue([]);
  prismaMock.reminderLog.findMany.mockResolvedValue([]);
  prismaMock.quizAttempt.findMany.mockResolvedValue([]);
  prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.emailMessage.findMany.mockResolvedValue([]); // retry pre-pass: no failed rows
  // Role-target reconcile + renewal re-trigger pre-passes share this mock (each
  // filters on a different `where` clause) — [] ⇒ both are a clean no-op by default.
  prismaMock.courseAssignment.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.enrollment.create.mockResolvedValue({ id: 'new-enrollment-1' });
  prismaMock.reminderLog.create.mockResolvedValue({ id: 'log-1' });
  mockCreateEnrollmentForUser.mockResolvedValue({
    status: 'enrolled',
    email: 'holder@test.com',
    userId: 'holder-1',
    enrollmentId: 'enrollment-1',
  });
  mockCreateNotification.mockResolvedValue(undefined);
  mockSendCourseLaunchEmail.mockResolvedValue(undefined);
  mockDispatchLadderStage.mockResolvedValue({ sent: true, reason: 'sent' });
  mockDispatchNudge.mockResolvedValue({ sent: true, reason: 'sent' });
  mockRetryReminderEmail.mockResolvedValue(true);
  mockResolveEscalationRecipients.mockResolvedValue({ userIds: [], emails: [] });
  mockRunRetentionPurge.mockResolvedValue({
    verificationTokens: 0,
    invites: 0,
    jobs: 0,
    emailMessages: 0,
  });
  delete process.env.RETENTION_PURGE_ENABLED;
});

describe('runReminderSweep — Track A (deadline ladder)', () => {
  it('dispatches only FRIENDLY_REMINDER when dueAt is exactly 14 days out (catchUpDays=0)', async () => {
    // Track A returns 1 enrollment; Track B returns 0
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeTrackAEnrollment('e1')]) // Track A
      .mockResolvedValueOnce([]); // Track B
    prismaMock.reminderLog.findMany.mockResolvedValue([]);

    const summary = await runReminderSweep(BASE_OPTS);

    // FRIENDLY_REMINDER fires; 4 other SWEEP_STAGES skip
    expect(mockDispatchLadderStage).toHaveBeenCalledTimes(1);
    expect(mockDispatchLadderStage).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'FRIENDLY_REMINDER',
        enrollment: expect.objectContaining({ id: 'e1' }),
      }),
    );
    expect(summary.scanned).toBe(1);
    expect(summary.ladderSent).toBe(1);
    expect(summary.skipped).toBe(5); // URGENT, DAY_OF, GRACE, HARD, ADMIN_PRE_DEADLINE all skip
    expect(summary.errors).toBe(0);
  });

  it('reads timezone from the worker facility (Org/Facility split) — regression guard', async () => {
    // Non-default timezone on facility so a fallback-to-DEFAULT_TZ bug (e.g.
    // reverting to enrollment.user.organization.timezone, which no longer
    // exists on the select) cannot masquerade as a pass. If the code read
    // organization.timezone instead, this field is absent from the mock
    // entirely, so `?? DEFAULT_TZ` would silently kick in and the assertion
    // below would fail (America/New_York !== America/Los_Angeles).
    const enrollment = makeTrackAEnrollment('e1');
    enrollment.user.facility = { timezone: 'America/Los_Angeles' };

    prismaMock.enrollment.findMany.mockResolvedValueOnce([enrollment]).mockResolvedValueOnce([]);
    prismaMock.reminderLog.findMany.mockResolvedValue([]);

    await runReminderSweep(BASE_OPTS);

    expect(mockDispatchLadderStage).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'America/Los_Angeles' }),
    );

    // Structural guard: the query must select facility.timezone, not
    // organization.timezone — Organization no longer has a timezone column.
    const call = prismaMock.enrollment.findMany.mock.calls[0][0];
    expect(call.select.user.select.facility).toEqual({ select: { timezone: true } });
    expect(call.select.user.select.organization).toBeUndefined();
  });

  it('falls back to DEFAULT_TZ when the worker has no facility (facility: null)', async () => {
    const enrollment = makeTrackAEnrollment('e1');
    // Models a worker who has not been attached to a facility yet.
    enrollment.user.facility = null;

    prismaMock.enrollment.findMany.mockResolvedValueOnce([enrollment]).mockResolvedValueOnce([]);
    prismaMock.reminderLog.findMany.mockResolvedValue([]);

    await runReminderSweep(BASE_OPTS);

    expect(mockDispatchLadderStage).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'America/New_York' }),
    );
  });

  it('skips a stage that already has a ReminderLog entry (sentSet dedup)', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeTrackAEnrollment('e1')]) // Track A
      .mockResolvedValueOnce([]); // Track B
    // Simulate that FRIENDLY_REMINDER was already sent
    prismaMock.reminderLog.findMany.mockResolvedValue([
      { enrollmentId: 'e1', stage: 'FRIENDLY_REMINDER' },
    ]);

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockDispatchLadderStage).not.toHaveBeenCalled();
    expect(summary.ladderSent).toBe(0);
    // All 6 ladder stages skipped (FRIENDLY due to sentSet; others not yet due)
    expect(summary.skipped).toBe(6);
  });

  it('skips a stage when the assignment config marks it disabled (enabled:false)', async () => {
    const enrollment = makeTrackAEnrollment('e1', DUE_AT_FIRES_TODAY, {
      reminderStages: [
        {
          stage: 'FRIENDLY_REMINDER' as ReminderStage,
          offsetDays: -14,
          enabled: false,
          channels: ['email', 'in_app'],
        },
      ],
    });
    prismaMock.enrollment.findMany.mockResolvedValueOnce([enrollment]).mockResolvedValueOnce([]);
    prismaMock.reminderLog.findMany.mockResolvedValue([]);

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockDispatchLadderStage).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(6); // FRIENDLY disabled + 5 not-due (incl. ADMIN_PRE_DEADLINE)
    expect(summary.ladderSent).toBe(0);
  });

  it('fires a stage that is 1 day past target when catchUpDays=1 (catch-up window)', async () => {
    // FRIENDLY_REMINDER target = June 14 (yesterday), daysSinceTarget=1 ≤ catchUpDays=1 → fires
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeTrackAEnrollment('e1', DUE_AT_TARGET_YESTERDAY)])
      .mockResolvedValueOnce([]);
    prismaMock.reminderLog.findMany.mockResolvedValue([]);

    const summary = await runReminderSweep({ ...BASE_OPTS, catchUpDays: 1 });

    expect(mockDispatchLadderStage).toHaveBeenCalledTimes(1);
    expect(summary.ladderSent).toBe(1);
  });

  it('does NOT fire when target is 3 days past and catchUpDays=2 (outside catch-up window)', async () => {
    // FRIENDLY_REMINDER target = June 12 (3 days ago), daysSinceTarget=3 > catchUpDays=2 → skip
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeTrackAEnrollment('e1', DUE_AT_TARGET_3_DAYS_AGO)])
      .mockResolvedValueOnce([]);
    prismaMock.reminderLog.findMany.mockResolvedValue([]);

    const summary = await runReminderSweep({ ...BASE_OPTS, catchUpDays: 2 });

    expect(mockDispatchLadderStage).not.toHaveBeenCalled();
    expect(summary.ladderSent).toBe(0);
    expect(summary.skipped).toBe(6);
  });

  it('is idempotent: re-running with the same logs skips all stages (sends=0)', async () => {
    // First run: send FRIENDLY_REMINDER
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeTrackAEnrollment('e1')]) // Track A run 1
      .mockResolvedValueOnce([]) // Track B run 1
      .mockResolvedValueOnce([makeTrackAEnrollment('e1')]) // Track A run 2
      .mockResolvedValueOnce([]); // Track B run 2
    prismaMock.reminderLog.findMany
      .mockResolvedValueOnce([]) // run 1: no existing logs
      .mockResolvedValueOnce([{ enrollmentId: 'e1', stage: 'FRIENDLY_REMINDER' }]); // run 2: logged

    const run1 = await runReminderSweep(BASE_OPTS);
    expect(run1.ladderSent).toBe(1);

    const run2 = await runReminderSweep(BASE_OPTS);
    expect(run2.ladderSent).toBe(0);
    expect(run2.skipped).toBe(6);
  });

  it('isolates per-enrollment errors: one throw increments errors, the other enrollment still fires', async () => {
    const e1 = makeTrackAEnrollment('e1'); // will succeed
    const e2 = makeTrackAEnrollment('e2'); // will throw

    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([e1, e2]) // Track A
      .mockResolvedValueOnce([]); // Track B
    prismaMock.reminderLog.findMany.mockResolvedValue([]);

    // e1 fires → success; e2 fires → throw (outer catch catches it)
    mockDispatchLadderStage
      .mockResolvedValueOnce({ sent: true, reason: 'sent' }) // e1
      .mockRejectedValueOnce(new Error('Unexpected failure')); // e2

    const summary = await runReminderSweep(BASE_OPTS);

    expect(summary.scanned).toBe(2);
    expect(summary.ladderSent).toBe(1); // e1 succeeded
    expect(summary.errors).toBe(1); // e2 threw
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('Track A enrollment failed') }),
    );
  });

  it('fires the due stage for an assignment-less enrollment (null assignment) using stage defaults', async () => {
    // Compliance-page parity: an overdue enrollment with no CourseAssignment must still
    // be escalated. With assignment === null, stageConfig falls back to REMINDER_STAGE_DEFAULTS,
    // so FRIENDLY_REMINDER (offset -14) still targets today and fires.
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeTrackAEnrollment('e1', DUE_AT_FIRES_TODAY, null)]) // Track A: no assignment
      .mockResolvedValueOnce([]); // Track B
    prismaMock.reminderLog.findMany.mockResolvedValue([]);

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockDispatchLadderStage).toHaveBeenCalledTimes(1);
    expect(mockDispatchLadderStage).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'FRIENDLY_REMINDER',
        enrollment: expect.objectContaining({ id: 'e1' }),
      }),
    );
    expect(summary.scanned).toBe(1);
    expect(summary.ladderSent).toBe(1);
    expect(summary.skipped).toBe(5); // URGENT, DAY_OF, GRACE, HARD, ADMIN_PRE_DEADLINE all skip
    expect(summary.errors).toBe(0);
  });

  it('excludes assignments with remindersEnabled:false (Track A prisma returns empty)', async () => {
    // Model the DB-level filter: findMany returns [] because the WHERE clause excludes those rows
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([]) // Track A: query filtered remindersEnabled=false out
      .mockResolvedValueOnce([]); // Track B

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockDispatchLadderStage).not.toHaveBeenCalled();
    expect(summary.scanned).toBe(0);
  });

  it('skips enrollments in terminal status (Track A prisma query excludes them)', async () => {
    // Terminal statuses excluded by WHERE; model as empty prisma result
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([]) // Track A
      .mockResolvedValueOnce([]); // Track B

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockDispatchLadderStage).not.toHaveBeenCalled();
    expect(summary.ladderSent).toBe(0);
  });
});

describe('runReminderSweep — Track B (quiz nudges)', () => {
  function makeAttempt(enrollmentId: string, score: number, attemptCount: number) {
    return { enrollmentId, score, attemptCount };
  }

  it('dispatches WORKER_RETAKE for in_progress enrollment with failing score and attempts remaining', async () => {
    const enrollment = makeTrackBEnrollment('e1', 'in_progress', {
      passingScore: 80,
      allowedAttempts: 3,
    });
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([]) // Track A
      .mockResolvedValueOnce([enrollment]); // Track B
    prismaMock.quizAttempt.findMany.mockResolvedValue([makeAttempt('e1', 60, 1)]); // score 60 < 80, attemptCount 1 < 3

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockDispatchNudge).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'WORKER_RETAKE',
        enrollmentId: 'e1',
        attemptsRemaining: 2, // 3 - 1
      }),
    );
    expect(summary.nudgesSent).toBe(1);
    expect(summary.scanned).toBe(1);
  });

  it('skips in_progress enrollment with passing score', async () => {
    const enrollment = makeTrackBEnrollment('e1', 'in_progress', {
      passingScore: 80,
      allowedAttempts: 3,
    });
    prismaMock.enrollment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([enrollment]);
    prismaMock.quizAttempt.findMany.mockResolvedValue([makeAttempt('e1', 90, 1)]); // 90 >= 80 → passing

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockDispatchNudge).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
  });

  it('skips in_progress enrollment when course has no quiz (null quiz data)', async () => {
    const enrollment = makeTrackBEnrollment('e1', 'in_progress', null); // no quiz
    prismaMock.enrollment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([enrollment]);
    prismaMock.quizAttempt.findMany.mockResolvedValue([]);

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockDispatchNudge).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
  });

  it('dispatches ADMIN_REASSIGN for locked enrollment with no active retake', async () => {
    const enrollment = makeTrackBEnrollment('e1', 'locked');
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([]) // Track A
      .mockResolvedValueOnce([enrollment]) // Track B
      .mockResolvedValueOnce([]); // active retakes: none
    prismaMock.quizAttempt.findMany.mockResolvedValue([]);
    mockResolveEscalationRecipients.mockResolvedValue({
      userIds: ['admin-1'],
      emails: [{ email: 'admin@test.com', name: 'Admin' }],
    });

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockResolveEscalationRecipients).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-e1' }),
    );
    expect(mockDispatchNudge).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ADMIN_REASSIGN',
        enrollmentId: 'e1',
        recipients: expect.objectContaining({ userIds: ['admin-1'] }),
      }),
    );
    expect(summary.nudgesSent).toBe(1);
  });

  it('skips locked enrollment that already has an active (non-terminal) retake', async () => {
    const enrollment = makeTrackBEnrollment('e1', 'locked');
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([]) // Track A
      .mockResolvedValueOnce([enrollment]) // Track B
      .mockResolvedValueOnce([{ retakeOf: 'e1' }]); // active retake exists
    prismaMock.quizAttempt.findMany.mockResolvedValue([]);

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockDispatchNudge).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
  });

  it('isolates per-enrollment Track B errors: one throw increments errors, the other dispatches', async () => {
    const e1 = makeTrackBEnrollment('e1', 'in_progress', { passingScore: 80, allowedAttempts: 3 });
    const e2 = makeTrackBEnrollment('e2', 'in_progress', { passingScore: 80, allowedAttempts: 3 });

    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([]) // Track A
      .mockResolvedValueOnce([e1, e2]); // Track B
    prismaMock.quizAttempt.findMany.mockResolvedValue([
      makeAttempt('e1', 60, 1),
      makeAttempt('e2', 60, 1),
    ]);

    mockDispatchNudge
      .mockResolvedValueOnce({ sent: true, reason: 'sent' }) // e1 succeeds
      .mockRejectedValueOnce(new Error('Nudge failure')); // e2 throws

    const summary = await runReminderSweep(BASE_OPTS);

    expect(summary.nudgesSent).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.scanned).toBe(2);
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('Track B enrollment failed') }),
    );
  });
});

// ─── Email retry pre-pass (F-020) ─────────────────────────────────────────────

describe('runReminderSweep — email retry pre-pass', () => {
  function makeFailedEmail(overrides: Record<string, unknown> = {}) {
    return {
      id: 'email-1',
      toEmail: 'worker-e1@test.com',
      attempts: 1,
      maxAttempts: 3,
      reminderLogId: 'log-1',
      ...overrides,
    };
  }

  function makeReminderLog(id = 'log-1') {
    return {
      id,
      stage: 'FRIENDLY_REMINDER',
      targetDate: new Date('2024-06-15T04:00:00Z'),
      enrollment: {
        dueAt: DUE_AT_FIRES_TODAY,
        course: { title: 'Course e1' },
        user: {
          email: 'worker-e1@test.com',
          profile: { fullName: 'Worker e1' },
          facility: { timezone: null },
        },
      },
    };
  }

  it('re-sends a failed reminder email that is under maxAttempts', async () => {
    prismaMock.emailMessage.findMany.mockResolvedValue([makeFailedEmail()]);
    prismaMock.reminderLog.findMany.mockResolvedValue([makeReminderLog()]);
    prismaMock.enrollment.findMany.mockResolvedValue([]); // both tracks empty
    mockRetryReminderEmail.mockResolvedValue(true);

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockRetryReminderEmail).toHaveBeenCalledTimes(1);
    expect(mockRetryReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        emailMessage: { id: 'email-1', toEmail: 'worker-e1@test.com' },
        stage: 'FRIENDLY_REMINDER',
        courseTitle: 'Course e1',
      }),
    );
    expect(summary.retriesSent).toBe(1);
  });

  it('does NOT re-send a row that has reached maxAttempts (cap)', async () => {
    prismaMock.emailMessage.findMany.mockResolvedValue([
      makeFailedEmail({ attempts: 3, maxAttempts: 3 }),
    ]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockRetryReminderEmail).not.toHaveBeenCalled();
    // No reconstruction lookup either — the row is filtered out before the join.
    expect(prismaMock.reminderLog.findMany).not.toHaveBeenCalled();
    expect(summary.retriesSent).toBe(0);
  });

  it('skips a failed row with no reminderLogId (nudge / generic — not reconstructable)', async () => {
    prismaMock.emailMessage.findMany.mockResolvedValue([makeFailedEmail({ reminderLogId: null })]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockRetryReminderEmail).not.toHaveBeenCalled();
    expect(summary.retriesSent).toBe(0);
  });

  it('does not run the retry pre-pass in dry-run mode', async () => {
    prismaMock.emailMessage.findMany.mockResolvedValue([makeFailedEmail()]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    await runReminderSweep({ ...BASE_OPTS, dryRun: true });

    expect(prismaMock.emailMessage.findMany).not.toHaveBeenCalled();
    expect(mockRetryReminderEmail).not.toHaveBeenCalled();
  });
});

// ─── Retention purge pre-pass (F-054) ─────────────────────────────────────────

describe('runReminderSweep — retention purge pre-pass', () => {
  it('runs the purge and records its counts on the summary', async () => {
    mockRunRetentionPurge.mockResolvedValue({
      verificationTokens: 5,
      invites: 2,
      jobs: 9,
      emailMessages: 4,
    });

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockRunRetentionPurge).toHaveBeenCalledWith(NOW);
    expect(summary.retentionPurged).toEqual({
      verificationTokens: 5,
      invites: 2,
      jobs: 9,
      emailMessages: 4,
    });
  });

  it('is a no-op under dry-run (purge not called, summary null)', async () => {
    const summary = await runReminderSweep({ ...BASE_OPTS, dryRun: true });

    expect(mockRunRetentionPurge).not.toHaveBeenCalled();
    expect(summary.retentionPurged).toBeNull();
  });

  it('is skipped when RETENTION_PURGE_ENABLED=false', async () => {
    process.env.RETENTION_PURGE_ENABLED = 'false';

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockRunRetentionPurge).not.toHaveBeenCalled();
    expect(summary.retentionPurged).toBeNull();
  });
});

// ─── Role-target reconcile pre-pass (Issue #4 / TC-016 backstop) ─────────────
//
// courseAssignment.findMany is shared by this pre-pass (where.targetRole) and
// the renewal pre-pass (where.renewalCycle) — route by which key is present so
// each test only has to supply the fixture it cares about.

function wireCourseAssignmentFindMany(opts: { roleTarget?: unknown[]; renewal?: unknown[] } = {}) {
  const { roleTarget = [], renewal = [] } = opts;
  prismaMock.courseAssignment.findMany.mockImplementation(
    (args: { where: Record<string, unknown> }) => {
      if ('targetRole' in args.where) return Promise.resolve(roleTarget);
      if ('renewalCycle' in args.where) return Promise.resolve(renewal);
      throw new Error(`Unexpected courseAssignment.findMany args: ${JSON.stringify(args)}`);
    },
  );
}

function makeRoleTargetAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assignment-role-1',
    organizationId: 'org-1',
    courseId: 'course-role-1',
    targetRole: 'nurse',
    dueWindowDays: 14,
    course: { title: 'Role Course' },
    organization: { name: 'Acme Corp' },
    ...overrides,
  };
}

function makeRoleHolder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'holder-1',
    email: 'holder@test.com',
    organizationId: 'org-1',
    role: 'nurse',
    roleAssignedAt: new Date('2024-06-01T00:00:00Z'),
    ...overrides,
  };
}

describe('runReminderSweep — role-target reconcile pre-pass', () => {
  it('enrolls a role-holder missing an enrollment, with the deadline window counted from roleAssignedAt', async () => {
    wireCourseAssignmentFindMany({ roleTarget: [makeRoleTargetAssignment()] });
    prismaMock.user.findMany.mockResolvedValue([makeRoleHolder()]);
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([]) // existing-enrollments check for role-target holders: none
      .mockResolvedValueOnce([]) // Track A
      .mockResolvedValueOnce([]); // Track B

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledExactlyOnceWith(
      { email: 'holder@test.com' },
      expect.objectContaining({
        courseId: 'course-role-1',
        organizationId: 'org-1',
        assignmentId: 'assignment-role-1',
        scheduleAt: new Date('2024-06-01T00:00:00Z'), // roleAssignedAt
        assignmentDueAt: null, // role-target assignments never carry an absolute dueAt
        assignmentWindowDays: 14,
      }),
    );
    expect(summary.roleTargetEnrolled).toBe(1);
  });

  it('skips a holder who already has an enrollment for the targeted course (idempotent second run)', async () => {
    wireCourseAssignmentFindMany({ roleTarget: [makeRoleTargetAssignment()] });
    prismaMock.user.findMany.mockResolvedValue([makeRoleHolder()]);
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([{ userId: 'holder-1', courseId: 'course-role-1' }]) // already enrolled
      .mockResolvedValueOnce([]) // Track A
      .mockResolvedValueOnce([]); // Track B

    const summary = await runReminderSweep(BASE_OPTS);

    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
    expect(summary.roleTargetEnrolled).toBe(0);
  });

  it('only enrolls holders matching the assignment org+role (no cross-org, no other-role leakage)', async () => {
    wireCourseAssignmentFindMany({ roleTarget: [makeRoleTargetAssignment()] }); // targets org-1/nurse
    prismaMock.user.findMany.mockResolvedValue([
      makeRoleHolder({ id: 'holder-1', email: 'nurse@test.com' }), // org-1 nurse — matches
      makeRoleHolder({ id: 'holder-2', email: 'other-org@test.com', organizationId: 'org-2' }), // wrong org
      makeRoleHolder({ id: 'holder-3', email: 'wrong-role@test.com', role: 'front_desk_admin' }), // wrong role
    ]);
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await runReminderSweep(BASE_OPTS);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledExactlyOnceWith(
      { email: 'nurse@test.com' },
      expect.anything(),
    );
  });

  it('does not run the role-target reconcile pre-pass in dry-run mode', async () => {
    wireCourseAssignmentFindMany({ roleTarget: [makeRoleTargetAssignment()] });

    await runReminderSweep({ ...BASE_OPTS, dryRun: true });

    expect(prismaMock.courseAssignment.findMany).not.toHaveBeenCalled();
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });
});

// ─── Renewal re-trigger pre-pass (Issue #6 / TC-019) ──────────────────────────

function makeRenewalAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assignment-renewal-1',
    courseId: 'course-renewal-1',
    organizationId: 'org-1',
    renewalCycle: 'annual',
    course: { title: 'Renewal Course' },
    organization: { name: 'Acme Corp' },
    ...overrides,
  };
}

function makeRenewalCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'completed-enrollment-1',
    userId: 'user-1',
    courseId: 'course-renewal-1',
    completedAt: new Date('2023-01-01T12:00:00Z'), // well past a 365-day annual cycle by NOW
    assignmentId: 'assignment-renewal-1',
    user: { email: 'worker@test.com', profile: { fullName: 'Worker One' } },
    ...overrides,
  };
}

describe('runReminderSweep — renewal re-trigger pre-pass', () => {
  it('creates a renewal enrollment once the cycle has elapsed, with renewedFrom, reset progress, and the correct dueAt', async () => {
    // Role-target pre-pass short-circuits without querying enrollment.findMany at
    // all (no role-target assignments), so the queue below starts at the renewal
    // pre-pass's own two calls, then Track A, then Track B.
    wireCourseAssignmentFindMany({ renewal: [makeRenewalAssignment()] });
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeRenewalCandidate()]) // renewal candidates
      .mockResolvedValueOnce([]) // newer-enrollment guard: no newer starts
      .mockResolvedValueOnce([]) // Track A
      .mockResolvedValueOnce([]); // Track B

    const summary = await runReminderSweep(BASE_OPTS);

    expect(prismaMock.enrollment.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          courseId: 'course-renewal-1',
          status: 'enrolled',
          progress: 0,
          assignmentId: 'assignment-renewal-1',
          renewedFrom: 'completed-enrollment-1',
          dueAt: new Date('2024-01-01T12:00:00Z'), // completedAt + 365 days
        }),
      }),
    );
    expect(summary.renewalsCreated).toBe(1);
  });

  it('creates the renewal exactly at dueAt − RENEWAL_LEAD_DAYS (14d before the deadline), keeping dueAt = completedAt + cycle', async () => {
    // completedAt 2023-06-30 → annual dueAt 2024-06-29; lead window opens 14d
    // earlier, on 2024-06-15 == NOW. So the pre-deadline ladder (−14/−7/−3) can
    // fire against the renewal, while the deadline itself is unchanged.
    wireCourseAssignmentFindMany({ renewal: [makeRenewalAssignment()] });
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        makeRenewalCandidate({ completedAt: new Date('2023-06-30T12:00:00Z') }),
      ])
      .mockResolvedValueOnce([]) // newer-enrollment guard: no newer starts
      .mockResolvedValueOnce([]) // Track A
      .mockResolvedValueOnce([]); // Track B

    const summary = await runReminderSweep(BASE_OPTS);

    expect(prismaMock.enrollment.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        data: expect.objectContaining({
          renewedFrom: 'completed-enrollment-1',
          dueAt: new Date('2024-06-29T12:00:00Z'), // completedAt + 365 days (deadline unchanged)
        }),
      }),
    );
    expect(summary.renewalsCreated).toBe(1);
  });

  it('does NOT create the renewal one day before the lead window opens', async () => {
    // completedAt 2023-07-01 → annual dueAt 2024-06-30; lead window opens
    // 2024-06-16, one day after NOW (2024-06-15) → not yet eligible.
    wireCourseAssignmentFindMany({ renewal: [makeRenewalAssignment()] });
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        makeRenewalCandidate({ completedAt: new Date('2023-07-01T12:00:00Z') }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const summary = await runReminderSweep(BASE_OPTS);

    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(summary.renewalsCreated).toBe(0);
  });

  it('remains idempotent when created early: a second run skips (the renewal started after the completion)', async () => {
    // First run created the renewal at the lead window; on the next sweep the
    // candidate is still terminal but the renewal's startedAt (== creation time,
    // after completedAt) trips the newer-enrollment guard → no second renewal.
    wireCourseAssignmentFindMany({ renewal: [makeRenewalAssignment()] });
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        makeRenewalCandidate({ completedAt: new Date('2023-06-30T12:00:00Z') }),
      ])
      .mockResolvedValueOnce([
        {
          userId: 'user-1',
          courseId: 'course-renewal-1',
          startedAt: new Date('2024-06-15T12:00:00Z'),
        },
      ])
      .mockResolvedValueOnce([]) // Track A
      .mockResolvedValueOnce([]); // Track B

    const summary = await runReminderSweep(BASE_OPTS);

    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(summary.renewalsCreated).toBe(0);
  });

  it('is idempotent: a second run creates nothing once the renewal already exists (newer-enrollment guard)', async () => {
    wireCourseAssignmentFindMany({ renewal: [makeRenewalAssignment()] });
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeRenewalCandidate()]) // renewal candidates (still terminal)
      .mockResolvedValueOnce([
        // The renewal created on the first run started AFTER the original completion.
        {
          userId: 'user-1',
          courseId: 'course-renewal-1',
          startedAt: new Date('2024-01-01T12:00:00Z'),
        },
      ])
      .mockResolvedValueOnce([]) // Track A
      .mockResolvedValueOnce([]); // Track B

    const summary = await runReminderSweep(BASE_OPTS);

    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(summary.renewalsCreated).toBe(0);
  });

  it('suppresses renewal when an existing (active) enrollment already supersedes the completed one', async () => {
    wireCourseAssignmentFindMany({ renewal: [makeRenewalAssignment()] });
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeRenewalCandidate()])
      .mockResolvedValueOnce([
        // A manual re-enroll/active retake started after the completion.
        {
          userId: 'user-1',
          courseId: 'course-renewal-1',
          startedAt: new Date('2023-06-01T00:00:00Z'),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const summary = await runReminderSweep(BASE_OPTS);

    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(summary.renewalsCreated).toBe(0);
  });

  it('does not renew a candidate whose cycle has not yet elapsed', async () => {
    wireCourseAssignmentFindMany({ renewal: [makeRenewalAssignment()] });
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        makeRenewalCandidate({ completedAt: new Date('2024-06-01T12:00:00Z') }), // completed 2 weeks ago; annual cycle far from elapsed
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const summary = await runReminderSweep(BASE_OPTS);

    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(summary.renewalsCreated).toBe(0);
  });

  it('does not run the renewal re-trigger pre-pass in dry-run mode', async () => {
    wireCourseAssignmentFindMany({ renewal: [makeRenewalAssignment()] });

    await runReminderSweep({ ...BASE_OPTS, dryRun: true });

    // Only whatever the (also-dry-run-skipped) role-target pre-pass would have
    // called — the renewal query itself must never fire.
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });
});

// ─── Dry-run accuracy (Issue #12): wouldSend vs skipped ───────────────────────

describe('runReminderSweep — dry-run tally accuracy', () => {
  it('tallies a dry-run dispatch into wouldSend, not skipped, and never increments ladderSent', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeTrackAEnrollment('e1')]) // Track A
      .mockResolvedValueOnce([]); // Track B
    prismaMock.reminderLog.findMany.mockResolvedValue([]);
    mockDispatchLadderStage.mockResolvedValue({ sent: false, reason: 'dry-run' });

    const summary = await runReminderSweep({ ...BASE_OPTS, dryRun: true });

    // Exactly the one stage whose target date matches today (FRIENDLY_REMINDER,
    // per DUE_AT_FIRES_TODAY) reaches dispatchLadderStage; the rest of the ladder
    // is skipped on date-mismatch alone, so `skipped` is intentionally not
    // asserted here — only the classification of the DISPATCHED stage's result.
    expect(summary.wouldSend).toBe(1);
    expect(summary.ladderSent).toBe(0);
  });

  it('a genuinely skipped (non-dry-run) dispatch still tallies into skipped, not wouldSend', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeTrackAEnrollment('e1')])
      .mockResolvedValueOnce([]);
    prismaMock.reminderLog.findMany.mockResolvedValue([]);
    mockDispatchLadderStage.mockResolvedValue({ sent: false, reason: 'no-recipients' });

    const summary = await runReminderSweep(BASE_OPTS);

    expect(summary.wouldSend).toBe(0);
    expect(summary.ladderSent).toBe(0);
    expect(mockDispatchLadderStage).toHaveBeenCalledOnce();
  });

  it('a real (non-dry-run) sent dispatch tallies into ladderSent, never wouldSend', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeTrackAEnrollment('e1')])
      .mockResolvedValueOnce([]);
    prismaMock.reminderLog.findMany.mockResolvedValue([]);
    mockDispatchLadderStage.mockResolvedValue({ sent: true, reason: 'sent' });

    const summary = await runReminderSweep(BASE_OPTS);

    expect(summary.ladderSent).toBe(1);
    expect(summary.wouldSend).toBe(0);
  });
});

// ─── resolveOnCompletion ──────────────────────────────────────────────────────

describe('resolveOnCompletion', () => {
  it('calls notification.updateMany with the correct type filter and metadata path', async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 2 });

    await resolveOnCompletion('enroll-42');

    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: {
        type: { in: ['COURSE_OVERDUE', 'COMPLIANCE_ESCALATION', 'COURSE_RETAKE_REMINDER'] },
        resolvedAt: null,
        metadata: { path: ['enrollmentId'], equals: 'enroll-42' },
      },
      data: expect.objectContaining({ isRead: true }),
    });
  });

  it('sets isRead:true and a resolvedAt timestamp', async () => {
    const before = Date.now();
    prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });

    await resolveOnCompletion('enroll-1');

    const call = prismaMock.notification.updateMany.mock.calls[0][0];
    expect(call.data.isRead).toBe(true);
    expect(call.data.resolvedAt).toBeInstanceOf(Date);
    expect(call.data.resolvedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('never throws when notification.updateMany rejects', async () => {
    prismaMock.notification.updateMany.mockRejectedValue(new Error('DB down'));

    await expect(resolveOnCompletion('enroll-1')).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('Failed to resolve notifications on completion'),
      }),
    );
  });
});
