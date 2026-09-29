import type { Prisma } from '@/generated/prisma/client';
import prisma from '@/lib/prisma';
import { buildDashboardScope } from '@/lib/dashboard/scope';
import {
  dueSoonEnrollmentWhere,
  overdueEnrollmentWhere,
  retakesOfWhere,
  supersededEnrollmentIds,
} from '@/lib/dashboard/definitions';
import { REMINDER_STAGE_DEFAULTS } from './stages';
import { DEFAULT_TZ, diffInDaysInTz } from './time';

/**
 * Status tracker reporting for the admin status-tracker page and dashboard banner.
 *
 * "Overdue" and "at risk" are the dashboards' own predicates
 * (`overdueEnrollmentWhere` / `dueSoonEnrollmentWhere` in
 * `@/lib/dashboard/definitions`) over the dashboards' own population
 * (`buildDashboardScope`), so the Global View's Overdue tile and this tracker
 * count the same rows for the same scope. A "hard escalation" is
 * an overdue enrollment that has crossed its HARD_ESCALATION threshold. That
 * threshold is resolved per enrollment from its assignment's
 * `AssignmentReminderStage` override (falling back to
 * `REMINDER_STAGE_DEFAULTS.HARD_ESCALATION.offsetDays`) — mirroring the reminder
 * sweep, so the tracker agrees with when the sweep actually escalates to
 * managers/admins. A disabled HARD_ESCALATION stage means the assignment never
 * escalates, so such rows are never flagged.
 *
 * "At risk" means a not-yet-overdue enrollment whose deadline falls within the
 * next `DUE_SOON_WINDOW_DAYS` (`@/lib/facility/metrics`) days — the same window as the Global View's
 * "Approaching Deadlines" (BUG-35), independent of any per-assignment reminder
 * offsets.
 *
 * An enrolment a retake has superseded is never listed, in either section: the
 * retake carries the obligation (`supersededEnrollmentIds`, BUG-38).
 *
 * Facility is the member's CURRENT roster, never the `Enrollment.facilityId`
 * stamp — a transferred worker is listed under, and visible to, their current
 * facility (BUG-36).
 *
 * Day math is timezone-aware (worker facility's IANA zone, falling back to
 * `DEFAULT_TZ`) so "days overdue"/"days until due" agree with the sweep's notion
 * of a day.
 */

/** Fallback hard-escalation offset when an assignment has no explicit override. */
const DEFAULT_HARD_ESCALATION_OFFSET_DAYS = REMINDER_STAGE_DEFAULTS.HARD_ESCALATION.offsetDays;

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
  organizationUser: {
    select: {
      user: { select: { email: true, fullName: true } },
      manager: { select: { user: { select: { fullName: true } } } },
      facilities: {
        where: { active: true },
        orderBy: { joinedAt: 'asc' },
        select: { facilityId: true, facility: { select: { name: true, timezone: true } } },
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
  /** The member's current facility (in scope), comma-joined if several; null when none. */
  facilityName: string | null;
  dueAt: Date;
  /** The IANA zone `dueAt` is read in — its date is shown as it falls there (BUG-12.3). */
  timeZone: string;
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
  /** The member's current facility (in scope), comma-joined if several; null when none. */
  facilityName: string | null;
  dueAt: Date;
  /** The IANA zone `dueAt` is read in — its date is shown as it falls there (BUG-12.3). */
  timeZone: string;
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
 * The member's roster facilities that fall inside the caller's scope — a
 * supervisor of facility A is not told that a two-facility worker also works at
 * facility C.
 */
function scopedRosterFacilities(enrollment: EnrollmentRow, dataFacilityIds: string[] | null) {
  const rows = enrollment.organizationUser.facilities;
  if (dataFacilityIds === null) return rows;
  const inScope = new Set(dataFacilityIds);
  return rows.filter((row) => inScope.has(row.facilityId));
}

function rosterFacilityName(rows: ReturnType<typeof scopedRosterFacilities>): string | null {
  return rows.length > 0 ? rows.map((row) => row.facility.name).join(', ') : null;
}

export interface StatusTrackerQuery {
  organizationId: string;
  /**
   * The `string[] | null` contract from `@/lib/facility/staff-where`: `null`
   * for an org-wide caller (no narrowing, members with no facility included),
   * an array — possibly EMPTY, meaning nothing — otherwise. Callers must have
   * already authorised the ids.
   */
  dataFacilityIds: string[] | null;
  /** Injectable clock for callers/tests; defaults to the current instant. */
  now?: Date;
}

/**
 * Overdue + at-risk status-tracker picture for a single organization.
 *
 * Two bulk queries, one batched retake lookup over their ids (no N+1), plus the
 * organisation's course predicate. Each row
 * joins the enrollment to its course, worker profile/email, manager name,
 * current roster facilities and assignment reminder-stage overrides. Overdue
 * rows are sorted most-overdue first; near-deadline rows soonest-due first.
 * Enrolments on an archived course, or of a deactivated member, are excluded —
 * the same population the dashboards count.
 */
export async function getStatusTrackerSummaryForOrg({
  organizationId,
  dataFacilityIds,
  now = new Date(),
}: StatusTrackerQuery): Promise<StatusTrackerSummary> {
  const { enrollmentWhere } = await buildDashboardScope({ organizationId, dataFacilityIds });

  const [overdueCandidates, nearDeadlineCandidates] = await Promise.all([
    prisma.enrollment.findMany({
      where: { ...enrollmentWhere, ...overdueEnrollmentWhere(now) },
      select: enrollmentRowSelect,
    }),
    prisma.enrollment.findMany({
      where: { ...enrollmentWhere, ...dueSoonEnrollmentWhere(now) },
      select: enrollmentRowSelect,
    }),
  ]);

  const candidateIds = [...overdueCandidates, ...nearDeadlineCandidates].map((e) => e.id);
  const retakes =
    candidateIds.length > 0
      ? await prisma.enrollment.findMany({
          where: { ...enrollmentWhere, ...retakesOfWhere(candidateIds) },
          select: { retakeOf: true },
        })
      : [];
  const superseded = supersededEnrollmentIds(retakes);
  const overdueEnrollments = overdueCandidates.filter((e) => !superseded.has(e.id));
  const nearDeadlineEnrollments = nearDeadlineCandidates.filter((e) => !superseded.has(e.id));

  const rows: StatusTrackerRow[] = overdueEnrollments.map((enrollment) => {
    // `dueAt` is guaranteed non-null by the query filter; assert for the type.
    const dueAt = enrollment.dueAt as Date;
    const facilities = scopedRosterFacilities(enrollment, dataFacilityIds);
    const tz = facilities[0]?.facility.timezone ?? DEFAULT_TZ;
    const daysOverdue = diffInDaysInTz(now, dueAt, tz);
    const threshold = resolveHardEscalationThreshold(enrollment);

    return {
      enrollmentId: enrollment.id,
      userId: enrollment.organizationUserId,
      workerName: displayName(enrollment),
      workerEmail: enrollment.organizationUser.user.email,
      courseId: enrollment.courseId,
      courseTitle: enrollment.course.title,
      facilityName: rosterFacilityName(facilities),
      dueAt,
      timeZone: tz,
      daysOverdue,
      status: enrollment.status,
      managerName: enrollment.organizationUser.manager?.user.fullName ?? null,
      isHardEscalation: threshold !== null && daysOverdue >= threshold,
    };
  });

  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const nearDeadlineRows: NearDeadlineRow[] = nearDeadlineEnrollments.map((enrollment) => {
    const dueAt = enrollment.dueAt as Date;
    const facilities = scopedRosterFacilities(enrollment, dataFacilityIds);
    const tz = facilities[0]?.facility.timezone ?? DEFAULT_TZ;

    return {
      enrollmentId: enrollment.id,
      userId: enrollment.organizationUserId,
      workerName: displayName(enrollment),
      workerEmail: enrollment.organizationUser.user.email,
      courseId: enrollment.courseId,
      courseTitle: enrollment.course.title,
      facilityName: rosterFacilityName(facilities),
      dueAt,
      timeZone: tz,
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
