import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createNotification } from '@/app/actions/notifications';
import { runRetentionPurge, type RetentionPurgeSummary } from '@/lib/retention';
import { createEnrollmentForUser, type CreateEnrollmentContext } from '@/lib/enrollment/create';
import type { UserRole, RenewalCycle } from '@/generated/prisma/enums';
import { SWEEP_LADDER_STAGES, REMINDER_STAGE_DEFAULTS } from './stages';
import { DEFAULT_TZ, startOfDayInTz, addDays, diffInDaysInTz } from './time';
import {
  dispatchLadderStage,
  dispatchNudge,
  noopEmailSender,
  retryReminderEmail,
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
  /**
   * Sends the sweep *would* have made were it not a dry run. Counted separately
   * from {@link skipped} (Issue #12) so a dry-run summary reflects intended sends
   * instead of masking them as genuine skips (disabled/out-of-window/already-sent).
   * Always 0 outside dry-run.
   */
  wouldSend: number;
  errors: number;
  /** Failed reminder emails successfully re-sent by the retry pre-pass (F-020). */
  retriesSent: number;
  /** Rows deleted by the data-retention purge pre-pass (F-054); null when skipped. */
  retentionPurged: RetentionPurgeSummary | null;
  /** Role holders backfilled by the role-target reconcile pre-pass (Issue #4). */
  roleTargetEnrolled: number;
  /** Renewal enrollments created by the recurrence re-trigger pre-pass (Issue #6). */
  renewalsCreated: number;
}

/**
 * Whether the data-retention purge pre-pass runs. Enabled by default; set
 * `RETENTION_PURGE_ENABLED=false` to disable. Any other value is treated as
 * enabled.
 */
function isRetentionPurgeEnabled(): boolean {
  return process.env.RETENTION_PURGE_ENABLED !== 'false';
}

// Statuses that take an enrollment out of the active reminder population.
const TERMINAL_STATUSES = ['completed', 'attested'] as const;

/**
 * Backoff floor for the email retry pre-pass: a failed EmailMessage is only
 * re-attempted once its last attempt is older than this, so a transient outage
 * isn't hammered on back-to-back sweeps.
 */
const RETRY_BACKOFF_MS = 60 * 60 * 1000; // 1 hour

export async function runReminderSweep(opts: ReminderSweepOptions): Promise<ReminderSweepSummary> {
  const { catchUpDays, nudgeIntervalDays, dryRun } = opts;

  const summary: ReminderSweepSummary = {
    scanned: 0,
    ladderSent: 0,
    nudgesSent: 0,
    skipped: 0,
    wouldSend: 0,
    errors: 0,
    retriesSent: 0,
    retentionPurged: null,
    roleTargetEnrolled: 0,
    renewalsCreated: 0,
  };

  const tallyLadder = (result: DispatchResult): void => {
    if (result.sent) summary.ladderSent += 1;
    else if (result.reason === 'error') summary.errors += 1;
    else if (result.reason === 'dry-run') summary.wouldSend += 1;
    else summary.skipped += 1;
  };

  const tallyNudge = (result: DispatchResult): void => {
    if (result.sent) summary.nudgesSent += 1;
    else if (result.reason === 'error') summary.errors += 1;
    else if (result.reason === 'dry-run') summary.wouldSend += 1;
    else summary.skipped += 1;
  };

  logger.info({ msg: '[reminders] Starting sweep', catchUpDays, nudgeIntervalDays, dryRun });

  await runRetryPrePass(opts, summary);
  await runRetentionPrePass(opts, summary);
  await runRoleTargetReconcilePrePass(opts, summary);
  await runRenewalRetriggerPrePass(opts, summary);
  await runTrackA(opts, summary, tallyLadder);
  await runTrackB(opts, summary, tallyNudge);

  logger.info({ msg: '[reminders] Sweep complete', dryRun, ...summary });
  return summary;
}

/**
 * Re-attempt reminder emails that failed to deliver on an earlier sweep.
 *
 * Runs before the ladder/nudge tracks. Selects `EmailMessage` rows that are
 * still `failed`, whose last attempt is older than {@link RETRY_BACKOFF_MS}, and
 * that remain under their per-row `maxAttempts` cap. Only ladder sends carry a
 * `reminderLogId`, so they alone are reconstructable from the claimed
 * ReminderLog + enrollment context; each is rebuilt and re-sent via the injected
 * sender. A no-op under `dryRun` (it would otherwise mutate delivery state).
 */
async function runRetryPrePass(
  opts: ReminderSweepOptions,
  summary: ReminderSweepSummary,
): Promise<void> {
  const { now, dryRun } = opts;
  if (dryRun) return;

  const sendEmail = opts.sendEmail ?? noopEmailSender;
  const backoffFloor = new Date(now.getTime() - RETRY_BACKOFF_MS);

  // Column-to-column comparison (attempts < maxAttempts) isn't expressible in a
  // Prisma filter, so gate on status/backoff in SQL and cap in JS.
  const candidates = await prisma.emailMessage.findMany({
    where: { status: 'failed', updatedAt: { lt: backoffFloor } },
    select: { id: true, toEmail: true, attempts: true, maxAttempts: true, reminderLogId: true },
  });

  const retryable = candidates.filter(
    (m): m is typeof m & { reminderLogId: string } =>
      m.attempts < m.maxAttempts && m.reminderLogId !== null,
  );
  if (retryable.length === 0) return;

  // One batched lookup of the claimed logs + their enrollment context.
  const logIds = [...new Set(retryable.map((m) => m.reminderLogId))];
  const logs = await prisma.reminderLog.findMany({
    where: { id: { in: logIds } },
    select: {
      id: true,
      stage: true,
      targetDate: true,
      enrollment: {
        select: {
          dueAt: true,
          course: { select: { title: true } },
          user: {
            select: {
              email: true,
              profile: { select: { fullName: true } },
              facility: { select: { timezone: true } },
            },
          },
        },
      },
    },
  });
  const logById = new Map(logs.map((l) => [l.id, l]));

  for (const message of retryable) {
    try {
      const log = logById.get(message.reminderLogId);
      if (!log) {
        // The linked ReminderLog is gone (e.g. enrollment deleted) — nothing to
        // reconstruct from; leave the row as-is rather than guess.
        summary.skipped += 1;
        continue;
      }

      const tz = log.enrollment.user.facility?.timezone ?? DEFAULT_TZ;
      const resent = await retryReminderEmail({
        sendEmail,
        emailMessage: { id: message.id, toEmail: message.toEmail },
        stage: log.stage,
        targetDate: log.targetDate,
        courseTitle: log.enrollment.course.title,
        dueAt: log.enrollment.dueAt,
        timezone: tz,
        worker: {
          email: log.enrollment.user.email,
          name: log.enrollment.user.profile?.fullName ?? null,
        },
      });

      if (resent) summary.retriesSent += 1;
    } catch (err) {
      summary.errors += 1;
      logger.error({ msg: '[reminders] Email retry failed', emailMessageId: message.id, err });
    }
  }
}

/**
 * Run the data-retention purge before the reminder tracks. Deletes expired
 * verification tokens and stale terminal invites/jobs/emails on HIPAA-sensible,
 * env-configurable windows (see {@link runRetentionPurge}). A no-op under
 * `dryRun` (it mutates persistent state) and when disabled via
 * `RETENTION_PURGE_ENABLED=false`. Best-effort: `runRetentionPurge` never
 * throws, so it can't break the sweep.
 */
async function runRetentionPrePass(
  opts: ReminderSweepOptions,
  summary: ReminderSweepSummary,
): Promise<void> {
  if (opts.dryRun || !isRetentionPurgeEnabled()) return;
  summary.retentionPurged = await runRetentionPurge(opts.now);
}

/**
 * Reconcile role-target course assignments before the reminder tracks.
 *
 * A backstop for the live {@link enrollUserForRoleTargets} hook: for every active
 * role-target assignment, find org users who hold the targeted role but have no
 * enrollment for that course and enroll them, with a deadline counted from each
 * user's `roleAssignedAt` (role-target assignments never carry an absolute
 * `dueAt`). This catches any role-write site the live hook missed and any user
 * who gained the role while the app was down.
 *
 * Bulk queries only (no N+1): one query for the assignments, one for all
 * candidate holders across every targeted (org, role), and one for their existing
 * enrollments. The per-user create runs only for genuinely missing enrollments,
 * and {@link createEnrollmentForUser}'s own existence check makes it idempotent —
 * a second sweep enrolls no one twice. A no-op under `dryRun` (it writes
 * enrollments and sends launch emails).
 *
 * Self-contained so later sweep pre-passes can slot in alongside it untouched.
 */
async function runRoleTargetReconcilePrePass(
  opts: ReminderSweepOptions,
  summary: ReminderSweepSummary,
): Promise<void> {
  if (opts.dryRun) return;

  try {
    const assignments = await prisma.courseAssignment.findMany({
      where: { targetRole: { not: null } },
      select: {
        id: true,
        organizationId: true,
        courseId: true,
        targetRole: true,
        dueWindowDays: true,
        course: { select: { title: true } },
        organization: { select: { name: true } },
      },
    });
    if (assignments.length === 0) return;

    const orgIds = [...new Set(assignments.map((a) => a.organizationId))];
    const roles = [
      ...new Set(assignments.map((a) => a.targetRole).filter((r): r is UserRole => r !== null)),
    ];
    const courseIds = [...new Set(assignments.map((a) => a.courseId))];

    // One query for every candidate holder across all targeted orgs/roles.
    const holders = await prisma.user.findMany({
      where: { organizationId: { in: orgIds }, role: { in: roles } },
      select: { id: true, email: true, organizationId: true, role: true, roleAssignedAt: true },
    });
    if (holders.length === 0) return;

    // One query for the holders already enrolled in the targeted courses.
    const existing = await prisma.enrollment.findMany({
      where: { courseId: { in: courseIds }, userId: { in: holders.map((h) => h.id) } },
      select: { userId: true, courseId: true },
    });
    const enrolledSet = new Set(existing.map((e) => `${e.userId}|${e.courseId}`));

    // Index holders by `${organizationId}|${role}` for O(1) assignment matching.
    const holdersByOrgRole = new Map<string, typeof holders>();
    for (const holder of holders) {
      if (!holder.organizationId) continue;
      const key = `${holder.organizationId}|${holder.role}`;
      const list = holdersByOrgRole.get(key);
      if (list) list.push(holder);
      else holdersByOrgRole.set(key, [holder]);
    }

    for (const assignment of assignments) {
      if (!assignment.targetRole) continue;
      const matches =
        holdersByOrgRole.get(`${assignment.organizationId}|${assignment.targetRole}`) ?? [];

      for (const holder of matches) {
        const enrollmentKey = `${holder.id}|${assignment.courseId}`;
        if (enrolledSet.has(enrollmentKey)) continue;

        try {
          const ctx: CreateEnrollmentContext = {
            courseId: assignment.courseId,
            courseTitle: assignment.course.title,
            organizationId: assignment.organizationId,
            organizationName: assignment.organization?.name || 'Your Organization',
            facilityId: null,
            assignmentId: assignment.id,
            // Count the deadline window from the holder's role-join date.
            scheduleAt: holder.roleAssignedAt,
            assignmentDueAt: null,
            assignmentWindowDays: assignment.dueWindowDays,
            enrolledByUserId: 'system-sweep',
          };

          const outcome = await createEnrollmentForUser({ email: holder.email }, ctx);
          if (outcome.status === 'enrolled' || outcome.status === 'newInvited') {
            summary.roleTargetEnrolled += 1;
          }
          // Guard against re-processing the same pair within this run.
          enrolledSet.add(enrollmentKey);
        } catch (err) {
          summary.errors += 1;
          logger.error({
            msg: '[reminders] Role-target reconcile failed',
            userId: holder.id,
            courseId: assignment.courseId,
            err,
          });
        }
      }
    }
  } catch (err) {
    // Best-effort pre-pass (mirrors retention/retry): a bulk-query failure here
    // must never prevent the reminder tracks from dispatching.
    summary.errors += 1;
    logger.error({ msg: '[reminders] Role-target reconcile pre-pass failed', err });
  }
}

/**
 * Days before a renewal's deadline at which the renewal enrollment is created.
 * Matches the earliest pre-deadline ladder stage (FRIENDLY_REMINDER's −14d) so
 * the whole pre-deadline ladder (−14/−7/−3) gets its full window to fire — the
 * renewal deadline itself stays `completedAt + cycleLengthDays` (unchanged).
 */
const RENEWAL_LEAD_DAYS = 14;

/**
 * Length of a renewal cycle in days. Approximate calendar spans (monthly ≈ 30,
 * quarterly ≈ 90, semiannual ≈ 180, annual ≈ 365) — only a consistent interval
 * from completion to the next deadline is required, not an exact anniversary.
 * `none` is 0 (the assignment never renews) and is filtered out before this runs.
 */
function cycleLengthDays(cycle: RenewalCycle): number {
  switch (cycle) {
    case 'monthly':
      return 30;
    case 'quarterly':
      return 90;
    case 'semiannual':
      return 180;
    case 'annual':
      return 365;
    case 'none':
      return 0;
  }
}

/**
 * Re-trigger recurring training before the reminder tracks (Issue #6 / TC-019).
 *
 * For every course assignment on a renewal cycle, find its terminal
 * (completed/attested) enrollments whose cycle has elapsed since completion and
 * that have not already been renewed or superseded, then create a fresh
 * enrollment for the same (user, course, assignment): progress reset, a new
 * `dueAt = completedAt + cycleLengthDays`, and a `renewedFrom` audit link back to
 * the completed enrollment. Each renewal seeds its own `INITIAL_LAUNCH` reminder
 * log so the ladder dedup lineage starts clean, notifies the worker in-app, and
 * emails the launch notice with the renewal deadline.
 *
 * Idempotent: a candidate is skipped when any newer enrollment already exists for
 * that (user, course) — which includes the renewal this pre-pass just created —
 * so a second sweep renews no one twice. Bulk queries only (no N+1): one for the
 * renewal assignments, one for their terminal enrollments, one for the newer-
 * enrollment guard. A no-op under `dryRun` (it writes enrollments and sends mail).
 *
 * Best-effort (mirrors the other pre-passes): a bulk-query failure is logged and
 * swallowed so it can never prevent the reminder tracks from dispatching.
 */
async function runRenewalRetriggerPrePass(
  opts: ReminderSweepOptions,
  summary: ReminderSweepSummary,
): Promise<void> {
  const { now, dryRun } = opts;
  if (dryRun) return;

  try {
    // Gate on renewal assignments first (empty in the common case) so a run with
    // no recurring courses never scans the enrollment table.
    const assignments = await prisma.courseAssignment.findMany({
      where: { renewalCycle: { not: 'none' } },
      select: {
        id: true,
        courseId: true,
        organizationId: true,
        renewalCycle: true,
        course: { select: { title: true } },
        organization: { select: { name: true } },
      },
    });
    if (assignments.length === 0) return;

    const assignmentById = new Map(assignments.map((a) => [a.id, a]));

    const candidates = await prisma.enrollment.findMany({
      where: {
        assignmentId: { in: assignments.map((a) => a.id) },
        status: { in: [...TERMINAL_STATUSES] },
        completedAt: { not: null },
      },
      select: {
        id: true,
        userId: true,
        courseId: true,
        completedAt: true,
        assignmentId: true,
        user: { select: { email: true, profile: { select: { fullName: true } } } },
      },
    });
    if (candidates.length === 0) return;

    // Newer-enrollment guard: the latest `startedAt` per (user, course). A
    // candidate whose latest start is after its own completion has already been
    // renewed or re-enrolled, so it must not renew again (idempotency).
    const userIds = [...new Set(candidates.map((c) => c.userId))];
    const courseIds = [...new Set(candidates.map((c) => c.courseId))];
    const related = await prisma.enrollment.findMany({
      where: { userId: { in: userIds }, courseId: { in: courseIds } },
      select: { userId: true, courseId: true, startedAt: true },
    });
    const latestStartByUserCourse = new Map<string, Date>();
    for (const row of related) {
      const key = `${row.userId}|${row.courseId}`;
      const current = latestStartByUserCourse.get(key);
      if (!current || row.startedAt > current) latestStartByUserCourse.set(key, row.startedAt);
    }

    // Guards against renewing the same (user, course) twice within one run.
    const renewedThisRun = new Set<string>();

    for (const candidate of candidates) {
      const completedAt = candidate.completedAt;
      if (!completedAt) continue; // Defensive: the query already filters non-null.

      const assignment = candidate.assignmentId
        ? assignmentById.get(candidate.assignmentId)
        : undefined;
      if (!assignment) continue;

      const key = `${candidate.userId}|${candidate.courseId}`;
      if (renewedThisRun.has(key)) continue;

      // A start strictly after this completion means a newer enrollment already
      // exists (a prior renewal or a manual re-enroll) — skip to stay idempotent.
      const latestStart = latestStartByUserCourse.get(key);
      if (latestStart && latestStart > completedAt) continue;

      const cycleDays = cycleLengthDays(assignment.renewalCycle);
      const renewalDueAt = addDays(completedAt, cycleDays);
      // Create the renewal RENEWAL_LEAD_DAYS ahead of the deadline so the full
      // pre-deadline ladder can fire; clamp the lead below the cycle length so a
      // renewal can never become eligible before the prior enrollment completed
      // (guarantees eligibleAt > completedAt for every cycle, incl. monthly=30d).
      const leadDays = Math.min(RENEWAL_LEAD_DAYS, cycleDays - 1);
      const renewalEligibleAt = addDays(renewalDueAt, -leadDays);
      if (now < renewalEligibleAt) continue;

      try {
        const renewal = await prisma.enrollment.create({
          data: {
            userId: candidate.userId,
            courseId: candidate.courseId,
            status: 'enrolled',
            progress: 0,
            assignmentId: candidate.assignmentId ?? undefined,
            renewedFrom: candidate.id,
            accessAt: now,
            dueAt: renewalDueAt,
          },
        });

        // Fresh INITIAL_LAUNCH lineage so the ladder never treats the renewal as
        // already-launched. A logging failure must not abort the renewal.
        try {
          await prisma.reminderLog.create({
            data: {
              enrollmentId: renewal.id,
              stage: 'INITIAL_LAUNCH',
              channels: ['email', 'in_app'],
              targetDate: now,
            },
          });
        } catch (logErr) {
          logger.warn({
            msg: '[reminders] Renewal INITIAL_LAUNCH reminder log not written',
            enrollmentId: renewal.id,
            err: logErr,
          });
        }

        await createNotification({
          userId: candidate.userId,
          type: 'COURSE_ASSIGNED',
          title: 'Training due for renewal',
          message: `Your training "${assignment.course.title}" is due for renewal. Please complete it again before the deadline.`,
          linkUrl: '/worker/trainings',
          metadata: { courseId: candidate.courseId, enrollmentId: renewal.id },
        });

        try {
          const { sendCourseLaunchEmail } = await import('@/lib/email');
          await sendCourseLaunchEmail(
            candidate.user.email,
            candidate.user.profile?.fullName || 'there',
            assignment.course.title,
            assignment.organization?.name || 'Your Organization',
            renewalDueAt,
          );
        } catch (emailErr) {
          logger.error({
            msg: '[reminders] Failed to send renewal launch email',
            enrollmentId: renewal.id,
            err: emailErr,
          });
        }

        renewedThisRun.add(key);
        summary.renewalsCreated += 1;
        logger.info({
          msg: '[reminders] Renewal enrollment created',
          renewedFrom: candidate.id,
          enrollmentId: renewal.id,
          courseId: candidate.courseId,
        });
      } catch (err) {
        summary.errors += 1;
        logger.error({
          msg: '[reminders] Renewal re-trigger failed',
          enrollmentId: candidate.id,
          courseId: candidate.courseId,
          err,
        });
      }
    }
  } catch (err) {
    // Best-effort pre-pass (mirrors retention/retry): a bulk-query failure here
    // must never prevent the reminder tracks from dispatching.
    summary.errors += 1;
    logger.error({ msg: '[reminders] Renewal re-trigger pre-pass failed', err });
  }
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
  // matches the status-tracker page's overdue population
  // (getStatusTrackerSummaryForOrg lists every overdue enrollment regardless of
  // assignment). Without this, an overdue enrollment with no CourseAssignment
  // would surface on the status-tracker page yet never be escalated — a silent
  // gap. Such enrollments fall back to
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

      for (const stage of SWEEP_LADDER_STAGES) {
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

  // One batched lookup of quiz attempts. Attempts are append-history (multiple
  // rows per enrollment+quiz), so order by completedAt desc and keep only the
  // latest attempt per enrollment.
  const attempts = await prisma.quizAttempt.findMany({
    where: { enrollmentId: { in: enrollmentIds } },
    orderBy: [{ enrollmentId: 'asc' }, { completedAt: 'desc' }],
    select: { enrollmentId: true, score: true, attemptCount: true },
  });
  const attemptByEnrollment = new Map<string, (typeof attempts)[number]>();
  for (const attempt of attempts) {
    if (!attemptByEnrollment.has(attempt.enrollmentId)) {
      attemptByEnrollment.set(attempt.enrollmentId, attempt);
    }
  }

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
 * an enrollment once it completes, so the status-tracker banner/page self-clear.
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
