'use server';

import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { listAccessibleFacilities, isOrgWideFacilityRole } from '@/lib/facility/scope';
import type { AccessibleFacility } from '@/lib/facility/scope';
import {
  ACTIVE_ENROLLMENT_STATUSES,
  APPROACHING_DEADLINE_WINDOW_DAYS,
  COMPLETED_ENROLLMENT_STATUSES,
  DORMANT_STAFF_DAYS,
  EXPIRING_CREDENTIALS_WINDOW_DAYS,
  RISK_OVERDUE_GRACE_DAYS,
  TREND_WINDOW_DAYS,
  classifyAuditReadiness,
  computeAuditReadinessPercent,
  computeCompletionPercent,
  computeRiskLevel,
  computeTrendPercent,
  riskWeight,
  type AuditReadinessLevel,
  type FacilityComplianceSignals,
  type RiskLevel,
} from '@/lib/facility/metrics';
import type { Prisma } from '@/generated/prisma/client';

/**
 * Global (all-facilities) dashboard aggregates.
 *
 * Every figure is produced by a grouped/aggregate query over `Enrollment.facilityId`
 * and friends — the query count is fixed regardless of how many facilities the
 * organisation has, so a 3-site customer and a 300-site customer issue the same
 * work. Nothing in this module may loop a query over facilities.
 *
 * Enrollments created before facility stamping (or for members with no active
 * facility assignment) carry a null `facilityId`. They are legitimately part of
 * the organisation, so they count towards org-wide totals but belong to no
 * facility row — the per-facility groupings simply skip the null bucket.
 */

/**
 * Passing bar applied when a course's quiz does not define one. Mirrors
 * `getDashboardData`'s fallback so the two dashboards can't disagree on whether
 * a given score passed.
 */
const DEFAULT_PASSING_SCORE = 70;

/** A headline figure plus its month-over-month movement (null = no basis). */
export interface DashboardMetric {
  value: number;
  /**
   * Percentage change against the previous {@link TREND_WINDOW_DAYS}-day window,
   * or `null` when the metric has no historical basis (a point-in-time state
   * that the schema does not historise) and no trend should be rendered.
   */
  trendPercent: number | null;
}

export interface PriorityRiskRow {
  facilityId: string;
  name: string;
  type: string | null;
  activeLearners: number;
  approachingDeadlines: number;
  overdueTrainings: number;
  riskLevel: RiskLevel;
}

export interface FacilityOverviewRow {
  facilityId: string;
  name: string;
  type: string | null;
  staffCount: number;
  activeTrainings: number;
  completionPercent: number;
  auditReadinessPercent: number;
  auditReadiness: AuditReadinessLevel;
  riskLevel: RiskLevel;
}

export interface GlobalDashboardData {
  /** Facilities the caller may view — also feeds the scope switcher. */
  facilities: AccessibleFacility[];
  enterpriseFootprint: {
    totalFacilities: DashboardMetric;
    totalStaff: DashboardMetric;
  };
  trainingVelocity: {
    activeLearners: DashboardMetric;
    ongoingCourses: DashboardMetric;
    firstTimePassRate: DashboardMetric;
  };
  riskCompliance: {
    overdueTrainings: DashboardMetric;
    dormantStaff: DashboardMetric;
    expiringCredentials: DashboardMetric;
  };
  /** Every accessible facility, most at risk first. */
  priorityRisks: PriorityRiskRow[];
  /** Every accessible facility, alphabetical. */
  facilitiesOverview: FacilityOverviewRow[];
}

function daysAgo(from: Date, days: number): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

function daysAhead(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** A metric with no reconstructible history — rendered without a trend chip. */
function pointInTime(value: number): DashboardMetric {
  return { value, trendPercent: null };
}

interface EnrollmentTotals {
  total: number;
  completed: number;
  active: number;
}

const EMPTY_ENROLLMENT_TOTALS: EnrollmentTotals = { total: 0, completed: 0, active: 0 };

/**
 * Collapses a `groupBy(['facilityId'])` result into a per-facility lookup plus
 * the organisation-wide total. Enrollments in the null-facility bucket belong
 * to the organisation but to no facility row, so they count towards the total
 * only.
 */
function splitByFacility(groups: { facilityId: string | null; _count: { _all: number } }[]): {
  total: number;
  byFacilityId: Map<string, number>;
} {
  const byFacilityId = new Map<string, number>();
  let total = 0;
  for (const row of groups) {
    total += row._count._all;
    if (row.facilityId) byFacilityId.set(row.facilityId, row._count._all);
  }
  return { total, byFacilityId };
}

function emptyGlobalDashboardData(facilities: AccessibleFacility[]): GlobalDashboardData {
  const zero = pointInTime(0);
  return {
    facilities,
    enterpriseFootprint: { totalFacilities: zero, totalStaff: zero },
    trainingVelocity: {
      activeLearners: zero,
      ongoingCourses: zero,
      firstTimePassRate: zero,
    },
    riskCompliance: {
      overdueTrainings: zero,
      dormantStaff: zero,
      expiringCredentials: zero,
    },
    priorityRisks: [],
    facilitiesOverview: [],
  };
}

/**
 * Enterprise-wide metrics and the two facility tables of the Global View.
 *
 * Authorisation mirrors the dashboard's Status Tracker widget (`assignment.read`):
 * this surface is roster-wide training and compliance data, so a role without
 * that visibility (e.g. Finance) is refused and falls back to its own dashboard.
 * A facility-bound caller (Supervisor) is narrowed to their assigned facilities —
 * their "organisation total" is the total across those facilities only.
 */
export async function getGlobalDashboardData(): Promise<GlobalDashboardData> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');

  const { organizationId, role } = session.user;

  // Mirrors the page's own gate: aggregates only (no staff name or email), so
  // finance qualifies via `billing.read`. NOT `enrollment.read` — every worker
  // role holds that, and this is a `'use server'` export a worker could POST to
  // directly.
  const roleKey = dbRoleToRoleKey(role);
  if (!can(roleKey, 'assignment.read') && !can(roleKey, 'billing.read')) {
    logger.warn({
      msg: '[dashboard] Global facility dashboard denied',
      userId: session.user.id,
      organizationId,
      role,
    });
    throw new Error('Forbidden');
  }

  const facilities = await listAccessibleFacilities(session);
  if (!organizationId) return emptyGlobalDashboardData(facilities);

  const orgWide = isOrgWideFacilityRole(role);
  const facilityIds = facilities.map((facility) => facility.id);

  // With no facility in view there is nothing for this dashboard to aggregate —
  // short-circuit rather than issuing a dozen queries that can only return
  // empty, and let the caller fall back to the organisation-wide dashboard.
  if (facilityIds.length === 0) return emptyGlobalDashboardData(facilities);

  const now = new Date();
  const windowStart = daysAgo(now, TREND_WINDOW_DAYS);
  const dormantCutoff = daysAgo(now, DORMANT_STAFF_DAYS);
  const overdueGraceCutoff = daysAgo(now, RISK_OVERDUE_GRACE_DAYS);
  const approachingCutoff = daysAhead(now, APPROACHING_DEADLINE_WINDOW_DAYS);
  const expiringCutoff = daysAhead(now, EXPIRING_CREDENTIALS_WINDOW_DAYS);
  const previousExpiringStart = daysAgo(now, EXPIRING_CREDENTIALS_WINDOW_DAYS);

  // Tenancy is structural: every `where` below extends one of these three bases,
  // each of which pins the organisation (and, for a facility-bound caller, the
  // permitted facility set) unconditionally.
  const facilityWhere: Prisma.FacilityWhereInput = {
    organizationId,
    ...(orgWide ? {} : { id: { in: facilityIds } }),
  };

  const staffWhere: Prisma.OrganizationUserWhereInput = {
    organizationId,
    active: true,
    ...(orgWide ? {} : { facilities: { some: { facilityId: { in: facilityIds }, active: true } } }),
  };

  const enrollmentWhere: Prisma.EnrollmentWhereInput = {
    organizationUser: { organizationId },
    ...(orgWide ? {} : { facilityId: { in: facilityIds } }),
  };

  const [
    previousFacilityCount,
    totalStaff,
    previousStaffCount,
    dormantStaff,
    staffPerFacility,
    enrollmentsByFacilityStatus,
    activeLearnerPairs,
    overdueByFacility,
    overdueBeyondGraceByFacility,
    approachingByFacility,
    withDeadlineByFacility,
    onTimeByFacility,
    expiredCredentialsByFacility,
    expiringCredentialsByFacility,
    ongoingCourseGroups,
    firstAttemptScores,
    previousExpiringCredentials,
  ] = await Promise.all([
    prisma.facility.count({ where: { ...facilityWhere, createdAt: { lt: windowStart } } }),

    prisma.organizationUser.count({ where: staffWhere }),

    // Roster as it stood a window ago: joined before the window and either still
    // active or deactivated since.
    prisma.organizationUser.count({
      where: {
        ...staffWhere,
        active: undefined,
        createdAt: { lt: windowStart },
        OR: [{ active: true }, { deactivatedAt: { gte: windowStart } }],
      },
    }),

    prisma.organizationUser.count({
      where: {
        ...staffWhere,
        OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: dormantCutoff } }],
      },
    }),

    prisma.organizationUserFacility.groupBy({
      by: ['facilityId'],
      where: {
        active: true,
        facilityId: { in: facilityIds },
        organizationUser: { organizationId, active: true },
      },
      _count: { _all: true },
    }),

    prisma.enrollment.groupBy({
      by: ['facilityId', 'status'],
      where: enrollmentWhere,
      _count: { _all: true },
    }),

    // One row per (facility, member) with outstanding training — collapsed to
    // distinct learners in memory, which SQL cannot do inside a single groupBy.
    prisma.enrollment.groupBy({
      by: ['facilityId', 'organizationUserId'],
      where: { ...enrollmentWhere, status: { in: [...ACTIVE_ENROLLMENT_STATUSES] } },
      _count: { _all: true },
    }),

    prisma.enrollment.groupBy({
      by: ['facilityId'],
      where: {
        ...enrollmentWhere,
        dueAt: { lt: now },
        status: { notIn: [...COMPLETED_ENROLLMENT_STATUSES] },
      },
      _count: { _all: true },
    }),

    // Risk escalates once an overdue training passes the grace period, so the
    // overdue population is also counted at the older cutoff; the 1-to-grace
    // bucket is the difference between the two rather than a third query.
    prisma.enrollment.groupBy({
      by: ['facilityId'],
      where: {
        ...enrollmentWhere,
        dueAt: { lt: overdueGraceCutoff },
        status: { notIn: [...COMPLETED_ENROLLMENT_STATUSES] },
      },
      _count: { _all: true },
    }),

    prisma.enrollment.groupBy({
      by: ['facilityId'],
      where: {
        ...enrollmentWhere,
        dueAt: { gte: now, lte: approachingCutoff },
        status: { notIn: [...COMPLETED_ENROLLMENT_STATUSES] },
      },
      _count: { _all: true },
    }),

    prisma.enrollment.groupBy({
      by: ['facilityId'],
      where: { ...enrollmentWhere, dueAt: { not: null } },
      _count: { _all: true },
    }),

    // Audit readiness numerator — completed on or before the deadline. The
    // column-to-column comparison is a Prisma field reference, so it stays one
    // grouped query instead of a row-level scan.
    prisma.enrollment.groupBy({
      by: ['facilityId'],
      where: {
        ...enrollmentWhere,
        dueAt: { not: null },
        status: { in: [...COMPLETED_ENROLLMENT_STATUSES] },
        completedAt: { lte: prisma.enrollment.fields.dueAt },
      },
      _count: { _all: true },
    }),

    // Credential proxy: an enrollment whose assignment carries a renewal cycle.
    // Expired = its renewal deadline has passed with no completion recorded;
    // completing it renews the credential, so completions are excluded.
    prisma.enrollment.groupBy({
      by: ['facilityId'],
      where: {
        ...enrollmentWhere,
        assignment: { renewalCycle: { not: 'none' } },
        dueAt: { lt: now },
        status: { notIn: [...COMPLETED_ENROLLMENT_STATUSES] },
      },
      _count: { _all: true },
    }),

    prisma.enrollment.groupBy({
      by: ['facilityId'],
      where: {
        ...enrollmentWhere,
        assignment: { renewalCycle: { not: 'none' } },
        dueAt: { gte: now, lte: expiringCutoff },
      },
      _count: { _all: true },
    }),

    prisma.enrollment.groupBy({
      by: ['courseId'],
      where: { ...enrollmentWhere, status: { in: [...ACTIVE_ENROLLMENT_STATUSES] } },
      _count: { _all: true },
    }),

    // First-time pass rate population: graded, non-retake enrollments. Grouped
    // by score so the per-course passing bar can be applied in memory — scores
    // are 0-100 integers, so this is bounded at 101 rows per course.
    prisma.enrollment.groupBy({
      by: ['courseId', 'score'],
      where: { ...enrollmentWhere, retakeOf: null, score: { not: null } },
      _count: { _all: true },
    }),

    prisma.enrollment.count({
      where: {
        ...enrollmentWhere,
        assignment: { renewalCycle: { not: 'none' } },
        dueAt: { gte: previousExpiringStart, lt: now },
      },
    }),
  ]);

  const gradedCourseIds = [...new Set(firstAttemptScores.map((row) => row.courseId))];
  const quizzes =
    gradedCourseIds.length > 0
      ? await prisma.quiz.findMany({
          // A quiz hangs off either a lesson or the course directly, so both
          // attachment points have to be resolved back to a course.
          where: {
            OR: [
              { courseId: { in: gradedCourseIds } },
              { lesson: { courseId: { in: gradedCourseIds } } },
            ],
          },
          select: {
            passingScore: true,
            courseId: true,
            lesson: { select: { courseId: true } },
          },
        })
      : [];

  const passingScoreByCourse = new Map<string, number>();
  for (const quiz of quizzes) {
    const courseId = quiz.courseId ?? quiz.lesson?.courseId;
    if (!courseId) continue;
    // A course with several quizzes passes at its strictest bar.
    const current = passingScoreByCourse.get(courseId);
    if (current === undefined || quiz.passingScore > current) {
      passingScoreByCourse.set(courseId, quiz.passingScore);
    }
  }

  let firstAttemptTotal = 0;
  let firstAttemptPassed = 0;
  for (const row of firstAttemptScores) {
    const count = row._count._all;
    firstAttemptTotal += count;
    const passingScore = passingScoreByCourse.get(row.courseId) ?? DEFAULT_PASSING_SCORE;
    if ((row.score ?? 0) >= passingScore) firstAttemptPassed += count;
  }

  const staffCountByFacility = new Map<string, number>();
  for (const row of staffPerFacility) {
    staffCountByFacility.set(row.facilityId, row._count._all);
  }

  const totalsByFacility = new Map<string, EnrollmentTotals>();
  for (const row of enrollmentsByFacilityStatus) {
    if (!row.facilityId) continue;
    const entry = totalsByFacility.get(row.facilityId) ?? { ...EMPTY_ENROLLMENT_TOTALS };
    entry.total += row._count._all;
    if ((COMPLETED_ENROLLMENT_STATUSES as readonly string[]).includes(row.status)) {
      entry.completed += row._count._all;
    }
    if ((ACTIVE_ENROLLMENT_STATUSES as readonly string[]).includes(row.status)) {
      entry.active += row._count._all;
    }
    totalsByFacility.set(row.facilityId, entry);
  }

  const activeLearnersByFacility = new Map<string, number>();
  const distinctActiveLearners = new Set<string>();
  for (const row of activeLearnerPairs) {
    distinctActiveLearners.add(row.organizationUserId);
    if (!row.facilityId) continue;
    activeLearnersByFacility.set(
      row.facilityId,
      (activeLearnersByFacility.get(row.facilityId) ?? 0) + 1,
    );
  }

  const overdue = splitByFacility(overdueByFacility);
  const overdueBeyondGrace = splitByFacility(overdueBeyondGraceByFacility);
  const approaching = splitByFacility(approachingByFacility);
  const withDeadline = splitByFacility(withDeadlineByFacility);
  const onTime = splitByFacility(onTimeByFacility);
  const expiredCredentials = splitByFacility(expiredCredentialsByFacility);
  const expiringCredentials = splitByFacility(expiringCredentialsByFacility);

  const complianceSignals = (facilityId: string): FacilityComplianceSignals => {
    const totals = totalsByFacility.get(facilityId) ?? EMPTY_ENROLLMENT_TOTALS;
    const beyondGrace = overdueBeyondGrace.byFacilityId.get(facilityId) ?? 0;
    return {
      overdueBeyondGrace: beyondGrace,
      overdueWithinGrace: Math.max((overdue.byFacilityId.get(facilityId) ?? 0) - beyondGrace, 0),
      completionPercent:
        totals.total > 0 ? computeCompletionPercent(totals.completed, totals.total) : null,
      expiredCredentials: expiredCredentials.byFacilityId.get(facilityId) ?? 0,
      expiringCredentials: expiringCredentials.byFacilityId.get(facilityId) ?? 0,
    };
  };

  const priorityRisks: PriorityRiskRow[] = facilities.map((facility) => ({
    facilityId: facility.id,
    name: facility.name,
    type: facility.type,
    activeLearners: activeLearnersByFacility.get(facility.id) ?? 0,
    approachingDeadlines: approaching.byFacilityId.get(facility.id) ?? 0,
    overdueTrainings: overdue.byFacilityId.get(facility.id) ?? 0,
    riskLevel: computeRiskLevel(complianceSignals(facility.id)),
  }));

  priorityRisks.sort(
    (a, b) =>
      riskWeight(b.riskLevel) - riskWeight(a.riskLevel) ||
      b.overdueTrainings - a.overdueTrainings ||
      b.activeLearners - a.activeLearners ||
      a.name.localeCompare(b.name),
  );

  const facilitiesOverview: FacilityOverviewRow[] = facilities
    .map((facility) => {
      const totals = totalsByFacility.get(facility.id) ?? EMPTY_ENROLLMENT_TOTALS;
      const signals = complianceSignals(facility.id);
      return {
        facilityId: facility.id,
        name: facility.name,
        type: facility.type,
        staffCount: staffCountByFacility.get(facility.id) ?? 0,
        activeTrainings: totals.active,
        completionPercent: computeCompletionPercent(totals.completed, totals.total),
        auditReadinessPercent: computeAuditReadinessPercent(
          onTime.byFacilityId.get(facility.id) ?? 0,
          withDeadline.byFacilityId.get(facility.id) ?? 0,
        ),
        auditReadiness: classifyAuditReadiness(signals),
        riskLevel: computeRiskLevel(signals),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  logger.info({
    msg: '[dashboard] Global facility dashboard resolved',
    userId: session.user.id,
    organizationId,
    facilityCount: facilities.length,
    orgWide,
  });

  return {
    facilities,
    enterpriseFootprint: {
      totalFacilities: {
        value: facilities.length,
        trendPercent: computeTrendPercent(facilities.length, previousFacilityCount),
      },
      totalStaff: {
        value: totalStaff,
        trendPercent: computeTrendPercent(totalStaff, previousStaffCount),
      },
    },
    trainingVelocity: {
      activeLearners: pointInTime(distinctActiveLearners.size),
      ongoingCourses: pointInTime(ongoingCourseGroups.length),
      firstTimePassRate: pointInTime(
        firstAttemptTotal > 0 ? Math.round((firstAttemptPassed / firstAttemptTotal) * 100) : 0,
      ),
    },
    riskCompliance: {
      overdueTrainings: pointInTime(overdue.total),
      dormantStaff: pointInTime(dormantStaff),
      expiringCredentials: {
        value: expiringCredentials.total,
        trendPercent: computeTrendPercent(expiringCredentials.total, previousExpiringCredentials),
      },
    },
    priorityRisks,
    facilitiesOverview,
  };
}
