import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { SWEEP_STAGES, REMINDER_STAGE_DEFAULTS } from './stages';
import { DEFAULT_TZ, startOfDayInTz, addDays, diffInDaysInTz } from './time';
import {
  dispatchLadderStage,
  dispatchNudge,
  type DispatchResult,
  type ReminderEmailSender,
} from './dispatch';
import { resolveEscalationRecipients } from './recipients';

/**
 * Reminder sweep — pure, unit-testable orchestration (mirrors `runVideoSweep`).
 *
 * One daily pass recomputes each stage's target date from `dueAt + offset` and
 * dispatches anything "due today (within the catch-up window) and not already
 * sent". Recompute-and-dedup stays correct when deadlines, completions, or
 * failures change underneath it, and is resilient to a missed cron day.
 *
 * Bulk queries only (no N+1): one query per track plus one batched lookup each
 * for existing logs, quiz attempts, and active retakes. Per-enrollment failures
 * are isolated so one bad row never aborts the run.
 *
 * Note: `renewalCycle` is out of scope for v1 — the deadline is always the
 * current enrollment's `dueAt`.
 */

export interface ReminderSweepOptions {
  now: Date;
  /** Days behind "today" a stage may still fire, covering a missed cron day. */
  catchUpDays: number;
  /** Minimum days between Track B nudges of the same kind. */
  nudgeIntervalDays: number;
  /** When true, log intended sends and perform zero writes. */
  dryRun: boolean;
  /**
   * Email transport injected by the worker (the real template-backed sender).
   * Optional so unit tests can omit it and fall back to dispatch's no-op sender.
   */
  sendEmail?: ReminderEmailSender;
}

export interface ReminderSweepSummary {
  scanned: number;
  ladderSent: number;
  nudgesSent: number;
  skipped: number;
  errors: number;
}

// Statuses that take an enrollment out of the active reminder population.
const TERMINAL_STATUSES = ['completed', 'attested'] as const;

export async function runReminderSweep(opts: ReminderSweepOptions): Promise<ReminderSweepSummary> {
  const { catchUpDays, nudgeIntervalDays, dryRun } = opts;

  const summary: ReminderSweepSummary = {
    scanned: 0,
    ladderSent: 0,
    nudgesSent: 0,
    skipped: 0,
    errors: 0,
  };

  const tallyLadder = (result: DispatchResult): void => {
    if (result.sent) summary.ladderSent += 1;
    else if (result.reason === 'error') summary.errors += 1;
    else summary.skipped += 1;
  };

  const tallyNudge = (result: DispatchResult): void => {
    if (result.sent) summary.nudgesSent += 1;
    else if (result.reason === 'error') summary.errors += 1;
    else summary.skipped += 1;
  };

  logger.info({ msg: '[reminders] Starting sweep', catchUpDays, nudgeIntervalDays, dryRun });

  await runTrackA(opts, summary, tallyLadder);
  await runTrackB(opts, summary, tallyNudge);

  logger.info({ msg: '[reminders] Sweep complete', dryRun, ...summary });
  return summary;
}

async function runTrackA(
  opts: ReminderSweepOptions,
  summary: ReminderSweepSummary,
  tally: (result: DispatchResult) => void,
): Promise<void> {
  const { now, catchUpDays, dryRun } = opts;

  // One query for the active reminder population.
  //
  // Include assignment-less enrollments (`assignmentId: null`) so the ladder
  // matches the compliance page's overdue population (getOverdueComplianceForOrg
  // lists every overdue enrollment regardless of assignment). Without this, an
  // overdue enrollment with no CourseAssignment would surface on the compliance
  // page yet never be escalated — a silent gap. Such enrollments fall back to
  // REMINDER_STAGE_DEFAULTS for their offsets/channels. We still exclude
  // enrollments whose assignment explicitly opted out (`remindersEnabled: false`).
  const enrollments = await prisma.enrollment.findMany({
    where: {
      dueAt: { not: null },
      status: { notIn: [...TERMINAL_STATUSES] },
      OR: [{ assignmentId: null }, { assignment: { is: { remindersEnabled: true } } }],
    },
    select: {
      id: true,
      userId: true,
      courseId: true,
      dueAt: true,
      assignment: {
        select: {
          reminderStages: {
            select: { stage: true, offsetDays: true, enabled: true, channels: true },
          },
        },
      },
      course: { select: { title: true } },
      user: {
        select: {
          id: true,
          email: true,
          profile: { select: { fullName: true } },
          facility: { select: { timezone: true } },
        },
      },
    },
  });

  if (enrollments.length === 0) return;

  // One batched lookup of already-sent stages.
  const logs = await prisma.reminderLog.findMany({
    where: { enrollmentId: { in: enrollments.map((e) => e.id) } },
    select: { enrollmentId: true, stage: true },
  });
  const sentSet = new Set(logs.map((l) => `${l.enrollmentId}|${l.stage}`));

  for (const enrollment of enrollments) {
    summary.scanned += 1;
    try {
      const dueAt = enrollment.dueAt;
      if (!dueAt) continue; // Defensive: the query already filters non-null.

      const tz = enrollment.user.facility?.timezone ?? DEFAULT_TZ;
      const dueStart = startOfDayInTz(dueAt, tz);
      const stageConfig = enrollment.assignment?.reminderStages ?? [];
      const worker = {
        id: enrollment.user.id,
        email: enrollment.user.email,
        name: enrollment.user.profile?.fullName ?? null,
      };

      for (const stage of SWEEP_STAGES) {
        const defaults = REMINDER_STAGE_DEFAULTS[stage];
        const config = stageConfig.find((s) => s.stage === stage);

        const enabled = config ? config.enabled : true;
        if (!enabled) {
          summary.skipped += 1;
          continue;
        }

        if (sentSet.has(`${enrollment.id}|${stage}`)) {
          summary.skipped += 1;
          continue;
        }

        const offsetDays = config ? config.offsetDays : defaults.offsetDays;
        const channels = config && config.channels.length > 0 ? config.channels : defaults.channels;

        const target = addDays(dueStart, offsetDays);
        // Fire when the target's local date is in [today - catchUpDays, today].
        const daysSinceTarget = diffInDaysInTz(now, target, tz);
        if (daysSinceTarget < 0 || daysSinceTarget > catchUpDays) {
          summary.skipped += 1;
          continue;
        }

        const result = await dispatchLadderStage({
          enrollment: {
            id: enrollment.id,
            userId: enrollment.userId,
            courseId: enrollment.courseId,
          },
          courseTitle: enrollment.course.title,
          worker,
          stage,
          channels,
          targetDate: target,
          dueAt,
          timezone: tz,
          dryRun,
          sendEmail: opts.sendEmail,
        });
        tally(result);
      }
    } catch (err) {
      summary.errors += 1;
      logger.error({
        msg: '[reminders] Track A enrollment failed',
        enrollmentId: enrollment.id,
        err,
      });
    }
  }
}

async function runTrackB(
  opts: ReminderSweepOptions,
  summary: ReminderSweepSummary,
  tally: (result: DispatchResult) => void,
): Promise<void> {
  const { now, nudgeIntervalDays, dryRun } = opts;

  // Track B is keyed off observable enrollment+quiz state (not which notification
  // fired), so it behaves correctly regardless of the quiz-submit path used.
  const enrollments = await prisma.enrollment.findMany({
    where: { status: { in: ['in_progress', 'locked'] } },
    select: {
      id: true,
      userId: true,
      courseId: true,
      status: true,
      course: {
        select: {
          title: true,
          quiz: { select: { passingScore: true, allowedAttempts: true } },
        },
      },
      user: {
        select: {
          id: true,
          email: true,
          profile: { select: { fullName: true } },
        },
      },
    },
  });

  if (enrollments.length === 0) return;

  const enrollmentIds = enrollments.map((e) => e.id);

  // One batched lookup of the (single, per-enrollment) quiz attempt.
  const attempts = await prisma.quizAttempt.findMany({
    where: { enrollmentId: { in: enrollmentIds } },
    select: { enrollmentId: true, score: true, attemptCount: true },
  });
  const attemptByEnrollment = new Map(attempts.map((a) => [a.enrollmentId, a]));

  // One batched lookup of active (non-terminal) retakes for locked enrollments.
  const lockedIds = enrollments.filter((e) => e.status === 'locked').map((e) => e.id);
  const activeRetakes = lockedIds.length
    ? await prisma.enrollment.findMany({
        where: { retakeOf: { in: lockedIds }, status: { notIn: [...TERMINAL_STATUSES] } },
        select: { retakeOf: true },
      })
    : [];
  const hasActiveRetake = new Set(
    activeRetakes.map((r) => r.retakeOf).filter((id): id is string => id !== null),
  );

  for (const enrollment of enrollments) {
    summary.scanned += 1;
    try {
      const worker = {
        id: enrollment.user.id,
        email: enrollment.user.email,
        name: enrollment.user.profile?.fullName ?? null,
      };

      if (enrollment.status === 'in_progress') {
        // WORKER_RETAKE: failed but attempts remain.
        const passingScore = enrollment.course.quiz?.passingScore ?? null;
        const allowedAttempts = enrollment.course.quiz?.allowedAttempts ?? null;
        const attempt = attemptByEnrollment.get(enrollment.id);

        const shouldNudge =
          passingScore !== null &&
          allowedAttempts !== null &&
          attempt !== undefined &&
          attempt.score < passingScore &&
          attempt.attemptCount < allowedAttempts;

        if (!shouldNudge) {
          summary.skipped += 1;
          continue;
        }

        const attemptsRemaining =
          allowedAttempts !== null && attempt ? allowedAttempts - attempt.attemptCount : undefined;

        const result = await dispatchNudge({
          kind: 'WORKER_RETAKE',
          enrollmentId: enrollment.id,
          courseId: enrollment.courseId,
          courseTitle: enrollment.course.title,
          worker,
          recipients: { userIds: [], emails: [] },
          nudgeIntervalDays,
          attemptsRemaining,
          now,
          dryRun,
          sendEmail: opts.sendEmail,
        });
        tally(result);
      } else {
        // status === 'locked': ADMIN_REASSIGN unless a retake is already active.
        if (hasActiveRetake.has(enrollment.id)) {
          summary.skipped += 1;
          continue;
        }

        const recipients = await resolveEscalationRecipients({ userId: enrollment.userId });
        const result = await dispatchNudge({
          kind: 'ADMIN_REASSIGN',
          enrollmentId: enrollment.id,
          courseId: enrollment.courseId,
          courseTitle: enrollment.course.title,
          worker,
          recipients,
          nudgeIntervalDays,
          now,
          dryRun,
          sendEmail: opts.sendEmail,
        });
        tally(result);
      }
    } catch (err) {
      summary.errors += 1;
      logger.error({
        msg: '[reminders] Track B enrollment failed',
        enrollmentId: enrollment.id,
        err,
      });
    }
  }
}

/**
 * Stamp `resolvedAt`/`isRead` on the open reminder/escalation notifications for
 * an enrollment once it completes, so the compliance banner/page self-clear.
 * Called wherever an enrollment transitions to completed/attested (Phase 8).
 * Never throws.
 */
export async function resolveOnCompletion(enrollmentId: string): Promise<void> {
  try {
    await prisma.notification.updateMany({
      where: {
        type: { in: ['COURSE_OVERDUE', 'COMPLIANCE_ESCALATION', 'COURSE_RETAKE_REMINDER'] },
        resolvedAt: null,
        metadata: { path: ['enrollmentId'], equals: enrollmentId },
      },
      data: { resolvedAt: new Date(), isRead: true },
    });
  } catch (err) {
    logger.error({
      msg: '[reminders] Failed to resolve notifications on completion',
      enrollmentId,
      err,
    });
  }
}
