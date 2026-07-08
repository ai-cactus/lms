import prisma from '@/lib/prisma';
import { REMINDER_STAGE_DEFAULTS } from './stages';
import { DEFAULT_TZ, diffInDaysInTz } from './time';

/**
 * Status tracker reporting for the admin status-tracker page and dashboard banner.
 *
 * "Overdue" means an enrollment whose deadline (`dueAt`) has passed and which has
 * not reached a terminal status (`completed`/`attested`). A "hard escalation" is
 * an overdue enrollment that has crossed the HARD_ESCALATION threshold
 * (`REMINDER_STAGE_DEFAULTS.HARD_ESCALATION.offsetDays`, i.e. 7+ days overdue) —
 * the same boundary the reminder sweep uses to escalate to managers/admins.
 *
 * Day math is timezone-aware (org's IANA zone, falling back to `DEFAULT_TZ`) so
 * "days overdue" agrees with the sweep's notion of a day.
 */

/** Statuses that take an enrollment out of the overdue population. */
const TERMINAL_STATUSES = ['completed', 'attested'] as const;

/** Days-overdue boundary at which an enrollment is a hard escalation. */
const HARD_ESCALATION_THRESHOLD_DAYS = REMINDER_STAGE_DEFAULTS.HARD_ESCALATION.offsetDays;

export interface StatusTrackerRow {
  enrollmentId: string;
  userId: string;
  workerName: string;
  workerEmail: string;
  courseId: string;
  courseTitle: string;
  dueAt: Date;
  daysOverdue: number;
  status: string;
  managerName: string | null;
}

export interface StatusTrackerSummary {
  overdueCount: number;
  hardEscalationCount: number;
  rows: StatusTrackerRow[];
}

/**
 * Overdue / at-risk status-tracker picture for a single organization.
 *
 * One bulk query (no N+1) joins each overdue enrollment to its course, worker
 * profile/email, the worker's manager name, and the org timezone. Rows are sorted
 * most-overdue first.
 *
 * `now` is injectable (defaulting to the current instant) so callers/tests can
 * pin the clock — mirroring `runReminderSweep`'s explicit `now`.
 */
export async function getStatusTrackerSummaryForOrg(
  orgId: string,
  now: Date = new Date(),
): Promise<StatusTrackerSummary> {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      dueAt: { not: null, lt: now },
      status: { notIn: [...TERMINAL_STATUSES] },
      user: { is: { organizationId: orgId } },
    },
    select: {
      id: true,
      userId: true,
      courseId: true,
      dueAt: true,
      status: true,
      course: { select: { title: true } },
      user: {
        select: {
          email: true,
          profile: { select: { fullName: true } },
          manager: { select: { profile: { select: { fullName: true } } } },
          organization: { select: { timezone: true } },
        },
      },
    },
  });

  const rows: StatusTrackerRow[] = enrollments.map((enrollment) => {
    // `dueAt` is guaranteed non-null by the query filter; assert for the type.
    const dueAt = enrollment.dueAt as Date;
    const tz = enrollment.user.organization?.timezone ?? DEFAULT_TZ;

    return {
      enrollmentId: enrollment.id,
      userId: enrollment.userId,
      workerName: enrollment.user.profile?.fullName ?? enrollment.user.email,
      workerEmail: enrollment.user.email,
      courseId: enrollment.courseId,
      courseTitle: enrollment.course.title,
      dueAt,
      daysOverdue: diffInDaysInTz(now, dueAt, tz),
      status: enrollment.status,
      managerName: enrollment.user.manager?.profile?.fullName ?? null,
    };
  });

  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const hardEscalationCount = rows.filter(
    (r) => r.daysOverdue >= HARD_ESCALATION_THRESHOLD_DAYS,
  ).length;

  return {
    overdueCount: rows.length,
    hardEscalationCount,
    rows,
  };
}
