import type { Prisma } from '@/generated/prisma/client';
import prisma from '@/lib/prisma';
import { REMINDER_STAGE_DEFAULTS } from './stages';
import { DEFAULT_TZ, addDays, diffInDaysInTz } from './time';

/**
 * Status tracker reporting for the admin status-tracker page and dashboard banner.
 *
 * "Overdue" means an enrollment whose deadline (`dueAt`) has passed and which has
 * not reached a terminal status (`completed`/`attested`). A "hard escalation" is
 * an overdue enrollment that has crossed its HARD_ESCALATION threshold. That
 * threshold is resolved per enrollment from its assignment's
 * `AssignmentReminderStage` override (falling back to
 * `REMINDER_STAGE_DEFAULTS.HARD_ESCALATION.offsetDays`) — mirroring the reminder
 * sweep, so the tracker agrees with when the sweep actually escalates to
 * managers/admins. A disabled HARD_ESCALATION stage means the assignment never
 * escalates, so such rows are never flagged.
 *
 * "At risk" means a not-yet-overdue enrollment whose deadline falls within the
 * next {@link AT_RISK_WINDOW_DAYS} days — surfaced so admins can intervene before
 * the deadline passes. The window is a fixed product constant, independent of any
 * per-assignment reminder offsets.
 *
 * Day math is timezone-aware (worker facility's IANA zone, falling back to
 * `DEFAULT_TZ`) so "days overdue"/"days until due" agree with the sweep's notion
 * of a day.
 */

/** Statuses that take an enrollment out of the overdue/at-risk population. */
const TERMINAL_STATUSES = ['completed', 'attested'] as const;

/** Fallback hard-escalation offset when an assignment has no explicit override. */
const DEFAULT_HARD_ESCALATION_OFFSET_DAYS = REMINDER_STAGE_DEFAULTS.HARD_ESCALATION.offsetDays;

/** Fixed look-ahead window (days) for the "At Risk" near-deadline view. */
export const AT_RISK_WINDOW_DAYS = 7;

/**
 * Shared select for both the overdue and near-deadline queries. Includes each
 * enrollment's assignment reminder-stage overrides so the hard-escalation
 * threshold can be resolved in-memory without a per-row query (no N+1).
 */
const enrollmentRowSelect = {
  id: true,
  organizationUserId: true,
  courseId: true,
  dueAt: true,
  status: true,
  assignment: {
    select: {
      reminderStages: { select: { stage: true, offsetDays: true, enabled: true } },
    },
  },
  course: { select: { title: true } },
  facility: { select: { name: true } },
  organizationUser: {
    select: {
      user: { select: { email: true, fullName: true } },
      manager: { select: { user: { select: { fullName: true } } } },
      facilities: {
        where: { active: true },
        take: 1,
        select: { facility: { select: { timezone: true } } },
      },
    },
  },
} satisfies Prisma.EnrollmentSelect;

type EnrollmentRow = Prisma.EnrollmentGetPayload<{ select: typeof enrollmentRowSelect }>;

export interface StatusTrackerRow {
  enrollmentId: string;
  /** `OrganizationUser.id` — the membership this row is about. */
  userId: string;
  workerName: string;
  workerEmail: string;
  courseId: string;
  courseTitle: string;
  /** Facility stamped on the enrollment at assignment time; null when none. */
  facilityName: string | null;
  dueAt: Date;
  daysOverdue: number;
  status: string;
  managerName: string | null;
  /** Whether this row has crossed its (per-assignment) hard-escalation threshold. */
  isHardEscalation: boolean;
}

export interface NearDeadlineRow {
  enrollmentId: string;
  /** `OrganizationUser.id` — the membership this row is about. */
  userId: string;
  workerName: string;
  workerEmail: string;
  courseId: string;
  courseTitle: string;
  /** Facility stamped on the enrollment at assignment time; null when none. */
  facilityName: string | null;
  dueAt: Date;
  /** Whole days from now until the deadline (0 = due today, tz-aware). */
  daysUntilDue: number;
  status: string;
  managerName: string | null;
}

export interface StatusTrackerSummary {
  overdueCount: number;
  hardEscalationCount: number;
  rows: StatusTrackerRow[];
  nearDeadline: {
    count: number;
    rows: NearDeadlineRow[];
  };
}

/**
 * Resolve the effective hard-escalation threshold for an enrollment, mirroring
 * `runTrackA` in `sweep.ts`: prefer the assignment's `HARD_ESCALATION` override
 * (offset + enabled), otherwise fall back to the system default. Returns `null`
 * when the stage is explicitly disabled — the assignment never escalates, so no
 * overdue row for it should be flagged as a hard escalation.
 */
function resolveHardEscalationThreshold(enrollment: EnrollmentRow): number | null {
  const override = enrollment.assignment?.reminderStages.find((s) => s.stage === 'HARD_ESCALATION');
  if (!override) return DEFAULT_HARD_ESCALATION_OFFSET_DAYS;
  if (!override.enabled) return null;
  return override.offsetDays;
}

function displayName(enrollment: EnrollmentRow): string {
  return enrollment.organizationUser.user.fullName ?? enrollment.organizationUser.user.email;
}

/**
 * Overdue + at-risk status-tracker picture for a single organization.
 *
 * Two bulk queries (no N+1): one for the overdue population, one for the
 * not-yet-overdue enrollments due within {@link AT_RISK_WINDOW_DAYS}. Each joins
 * the enrollment to its course, worker profile/email, manager name, facility
 * timezone, and assignment reminder-stage overrides. Overdue rows are sorted
 * most-overdue first; near-deadline rows soonest-due first.
 *
 * `now` is injectable (defaulting to the current instant) so callers/tests can
 * pin the clock — mirroring `runReminderSweep`'s explicit `now`.
 *
 * `facilityId` narrows the picture to the enrollments stamped with that facility,
 * for the facility-scoped dashboard. Callers must have already authorised the id
 * (see `resolveFacilityScope`); omit it for the organisation-wide view.
 */
export async function getStatusTrackerSummaryForOrg(
  orgId: string,
  now: Date = new Date(),
  facilityId?: string | string[] | null,
): Promise<StatusTrackerSummary> {
  const facilityFilter = Array.isArray(facilityId)
    ? facilityId.length > 0
      ? { facilityId: { in: facilityId } }
      : {}
    : facilityId
      ? { facilityId }
      : {};

  const [overdueEnrollments, nearDeadlineEnrollments] = await Promise.all([
    prisma.enrollment.findMany({
      where: {
        dueAt: { not: null, lt: now },
        status: { notIn: [...TERMINAL_STATUSES] },
        organizationUser: { is: { organizationId: orgId, active: true } },
        ...facilityFilter,
      },
      select: enrollmentRowSelect,
    }),
    prisma.enrollment.findMany({
      where: {
        dueAt: { gte: now, lte: addDays(now, AT_RISK_WINDOW_DAYS) },
        status: { notIn: [...TERMINAL_STATUSES] },
        organizationUser: { is: { organizationId: orgId, active: true } },
        ...facilityFilter,
      },
      select: enrollmentRowSelect,
    }),
  ]);

  const rows: StatusTrackerRow[] = overdueEnrollments.map((enrollment) => {
    // `dueAt` is guaranteed non-null by the query filter; assert for the type.
    const dueAt = enrollment.dueAt as Date;
    const tz = enrollment.organizationUser.facilities[0]?.facility.timezone ?? DEFAULT_TZ;
    const daysOverdue = diffInDaysInTz(now, dueAt, tz);
    const threshold = resolveHardEscalationThreshold(enrollment);

    return {
      enrollmentId: enrollment.id,
      userId: enrollment.organizationUserId,
      workerName: displayName(enrollment),
      workerEmail: enrollment.organizationUser.user.email,
      courseId: enrollment.courseId,
      courseTitle: enrollment.course.title,
      facilityName: enrollment.facility?.name ?? null,
      dueAt,
      daysOverdue,
      status: enrollment.status,
      managerName: enrollment.organizationUser.manager?.user.fullName ?? null,
      isHardEscalation: threshold !== null && daysOverdue >= threshold,
    };
  });

  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const nearDeadlineRows: NearDeadlineRow[] = nearDeadlineEnrollments.map((enrollment) => {
    const dueAt = enrollment.dueAt as Date;
    const tz = enrollment.organizationUser.facilities[0]?.facility.timezone ?? DEFAULT_TZ;

    return {
      enrollmentId: enrollment.id,
      userId: enrollment.organizationUserId,
      workerName: displayName(enrollment),
      workerEmail: enrollment.organizationUser.user.email,
      courseId: enrollment.courseId,
      courseTitle: enrollment.course.title,
      facilityName: enrollment.facility?.name ?? null,
      dueAt,
      daysUntilDue: diffInDaysInTz(dueAt, now, tz),
      status: enrollment.status,
      managerName: enrollment.organizationUser.manager?.user.fullName ?? null,
    };
  });

  nearDeadlineRows.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  const hardEscalationCount = rows.filter((r) => r.isHardEscalation).length;

  return {
    overdueCount: rows.length,
    hardEscalationCount,
    rows,
    nearDeadline: {
      count: nearDeadlineRows.length,
      rows: nearDeadlineRows,
    },
  };
}
