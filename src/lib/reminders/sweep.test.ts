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

// ─── Hoisted mock references ──────────────────────────────────────────────────

const {
  prismaMock,
  mockDispatchLadderStage,
  mockDispatchNudge,
  mockResolveEscalationRecipients,
  mockLoggerError,
} = vi.hoisted(() => {
  const prismaMock = {
    enrollment: { findMany: vi.fn() },
    reminderLog: { findMany: vi.fn() },
    quizAttempt: { findMany: vi.fn() },
    notification: { updateMany: vi.fn() },
  };
  const mockDispatchLadderStage = vi.fn();
  const mockDispatchNudge = vi.fn();
  const mockResolveEscalationRecipients = vi.fn();
  const mockLoggerError = vi.fn();
  return {
    prismaMock,
    mockDispatchLadderStage,
    mockDispatchNudge,
    mockResolveEscalationRecipients,
    mockLoggerError,
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));

vi.mock('@/lib/reminders/dispatch', () => ({
  dispatchLadderStage: mockDispatchLadderStage,
  dispatchNudge: mockDispatchNudge,
  noopEmailSender: vi.fn(),
}));

vi.mock('@/lib/reminders/recipients', () => ({
  resolveEscalationRecipients: mockResolveEscalationRecipients,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { runReminderSweep, resolveOnCompletion } from './sweep';

// ─── Shared dates ─────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
      facility: { timezone: null }, // → DEFAULT_TZ (America/New_York)
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

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Safe defaults: empty result sets (both tracks empty)
  prismaMock.enrollment.findMany.mockResolvedValue([]);
  prismaMock.reminderLog.findMany.mockResolvedValue([]);
  prismaMock.quizAttempt.findMany.mockResolvedValue([]);
  prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
  mockDispatchLadderStage.mockResolvedValue({ sent: true, reason: 'sent' });
  mockDispatchNudge.mockResolvedValue({ sent: true, reason: 'sent' });
  mockResolveEscalationRecipients.mockResolvedValue({ userIds: [], emails: [] });
});

// ─── Track A — deadline ladder ────────────────────────────────────────────────

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
    expect(summary.skipped).toBe(4); // URGENT, DAY_OF, GRACE, HARD all skip
    expect(summary.errors).toBe(0);
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
    // All 5 SWEEP_STAGES skipped (FRIENDLY due to sentSet; others not yet due)
    expect(summary.skipped).toBe(5);
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
    expect(summary.skipped).toBe(5); // FRIENDLY disabled + 4 not-due
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
    expect(summary.skipped).toBe(5);
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
    expect(run2.skipped).toBe(5);
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
    expect(summary.skipped).toBe(4); // URGENT, DAY_OF, GRACE, HARD all skip
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

// ─── Track B — quiz nudges ────────────────────────────────────────────────────

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
