'use server';

import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { listAccessibleFacilities, isOrgWideFacilityRole } from '@/lib/facility/scope';
import type { AccessibleFacility } from '@/lib/facility/scope';
import { MIN_COMPARISON_FACILITIES } from '@/lib/facility/scope-param';
import {
  TREND_WINDOW_DAYS,
  classifyAuditReadiness,
  computeRiskLevel,
  computeTrendPercent,
  riskWeight,
  type AuditReadinessLevel,
  type RiskLevel,
} from '@/lib/facility/metrics';
import {
  computeFacilityRow,
  computeHeadline,
  daysBefore,
  sliceSnapshot,
  type HeadlineFigures,
} from '@/lib/dashboard/definitions';
import { resolveDashboardScope } from '@/lib/dashboard/scope';
import { countPreviousStaffPopulation, loadDashboardSnapshot } from '@/lib/dashboard/snapshot';

/**
 * Global (all-facilities) dashboard.
 *
 * Every figure is counted by `@/lib/dashboard/definitions` over one snapshot
 * (`@/lib/dashboard/snapshot`, a fixed query set independent of facility
 * count). The headline reads the whole scope, each facility row reads that
 * facility's CURRENT-roster slice — the same slice `getDashboardData([id])`
 * reads — so a facility's row and its own dashboard cannot disagree. Members
 * with no facility row count in the headline only.
 */

/** A headline figure plus its month-over-month movement (null = no chip). */
export interface DashboardMetric {
  value: number;
  /**
   * Percentage change against the previous {@link TREND_WINDOW_DAYS}-day
   * window. Only Total Facilities and Total Staff carry one: they are the only
   * figures with an honest like-for-like history (founder ruling 2026-09-26).
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
  /**
   * The facility view's own tiles over the same slice — not rendered here, but
   * carried so the parity suite can prove a row and `getDashboardData([id])`
   * agree without a second code path.
   */
  activeLearners: number;
  activeCourses: number;
  averageGrade: number;
}

export interface GlobalHeadline {
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
}

export interface GlobalDashboardData extends GlobalHeadline {
  /** Facilities the caller may view — also feeds the scope switcher. */
  facilities: AccessibleFacility[];
  /** Every accessible facility, most at risk first. */
  priorityRisks: PriorityRiskRow[];
  /** Every accessible facility, alphabetical. */
  facilitiesOverview: FacilityOverviewRow[];
  /**
   * The headline over the compared facilities, counted from their data — never
   * summed from rows, which counts a two-facility member twice. `null` unless at
   * least {@link MIN_COMPARISON_FACILITIES} requested ids are accessible.
   */
  comparison: (GlobalHeadline & { facilityIds: string[] }) | null;
}

export interface GlobalDashboardOptions {
  /** Facilities to compare. A request, never a grant — intersected with the accessible set. */
  compareFacilityIds?: string[];
}

function pointInTime(value: number): DashboardMetric {
  return { value, trendPercent: null };
}

function toHeadline(
  facilityCount: number,
  figures: HeadlineFigures,
  trends: { facilities: number | null; staff: number | null },
): GlobalHeadline {
  return {
    enterpriseFootprint: {
      totalFacilities: { value: facilityCount, trendPercent: trends.facilities },
      totalStaff: { value: figures.totalStaff, trendPercent: trends.staff },
    },
    trainingVelocity: {
      activeLearners: pointInTime(figures.activeLearners),
      ongoingCourses: pointInTime(figures.ongoingCourses),
      firstTimePassRate: pointInTime(figures.firstTimePassRate),
    },
    riskCompliance: {
      overdueTrainings: pointInTime(figures.overdueTrainings),
      dormantStaff: pointInTime(figures.dormantStaff),
      expiringCredentials: pointInTime(figures.expiringCredentials),
    },
  };
}

const EMPTY_HEADLINE_FIGURES: HeadlineFigures = {
  totalStaff: 0,
  activeLearners: 0,
  ongoingCourses: 0,
  firstTimePassRate: 0,
  overdueTrainings: 0,
  dormantStaff: 0,
  expiringCredentials: 0,
};

function emptyGlobalDashboardData(facilities: AccessibleFacility[]): GlobalDashboardData {
  return {
    facilities,
    ...toHeadline(0, EMPTY_HEADLINE_FIGURES, { facilities: null, staff: null }),
    priorityRisks: [],
    facilitiesOverview: [],
    comparison: null,
  };
}

/**
 * Enterprise-wide metrics and the two facility tables of the Global View.
 *
 * Authorisation mirrors the dashboard page's own gate (`assignment.read` or
 * `billing.read`): aggregates only, no staff name or email. A facility-bound
 * caller (Supervisor) is narrowed to their assigned facilities — their
 * "organisation total" is the total across those facilities only.
 */
export async function getGlobalDashboardData(
  options: GlobalDashboardOptions = {},
): Promise<GlobalDashboardData> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');

  const { organizationId, role } = session.user;

  // NOT `enrollment.read` — every worker role holds that, and this is a
  // `'use server'` export a worker could POST to directly.
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

  // With no facility in view there is nothing for this dashboard to aggregate —
  // the caller falls back to the organisation-wide dashboard.
  if (facilities.length === 0) return emptyGlobalDashboardData(facilities);

  const now = new Date();
  const windowStart = daysBefore(now, TREND_WINDOW_DAYS);
  const scope = await resolveDashboardScope(session);

  const [snapshot, previousFacilityCount, previousStaffCount] = await Promise.all([
    loadDashboardSnapshot(scope, now),
    prisma.facility.count({
      where: {
        organizationId,
        createdAt: { lt: windowStart },
        ...(scope.dataFacilityIds === null ? {} : { id: { in: scope.dataFacilityIds } }),
      },
    }),
    countPreviousStaffPopulation(scope, windowStart),
  ]);

  // The snapshot is already roster-narrowed in SQL; slicing by the same ids here
  // keeps the headline correct even if a loader ever returns a superset.
  const headlineFigures = computeHeadline(sliceSnapshot(snapshot, scope.dataFacilityIds));

  const rows = facilities.map((facility) => ({
    facility,
    figures: computeFacilityRow(sliceSnapshot(snapshot, [facility.id])),
  }));

  const priorityRisks: PriorityRiskRow[] = rows
    .map(({ facility, figures }) => ({
      facilityId: facility.id,
      name: facility.name,
      type: facility.type,
      activeLearners: figures.activeLearners,
      approachingDeadlines: figures.approachingDeadlines,
      overdueTrainings: figures.overdueTrainings,
      riskLevel: computeRiskLevel(figures.signals),
    }))
    .sort(
      (a, b) =>
        riskWeight(b.riskLevel) - riskWeight(a.riskLevel) ||
        b.overdueTrainings - a.overdueTrainings ||
        b.activeLearners - a.activeLearners ||
        a.name.localeCompare(b.name),
    );

  const facilitiesOverview: FacilityOverviewRow[] = rows
    .map(({ facility, figures }) => ({
      facilityId: facility.id,
      name: facility.name,
      type: facility.type,
      staffCount: figures.staffCount,
      activeTrainings: figures.activeTrainings,
      completionPercent: figures.completionPercent,
      auditReadinessPercent: figures.auditReadinessPercent,
      auditReadiness: classifyAuditReadiness(figures.signals),
      riskLevel: computeRiskLevel(figures.signals),
      activeLearners: figures.activeLearners,
      activeCourses: figures.activeCourses,
      averageGrade: figures.averageGrade,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const requested = new Set(options.compareFacilityIds ?? []);
  const comparedIds = facilities.filter((f) => requested.has(f.id)).map((f) => f.id);
  const comparison =
    comparedIds.length >= MIN_COMPARISON_FACILITIES
      ? {
          facilityIds: comparedIds,
          // A subset has no history of its own, so no trend chip.
          ...toHeadline(comparedIds.length, computeHeadline(sliceSnapshot(snapshot, comparedIds)), {
            facilities: null,
            staff: null,
          }),
        }
      : null;

  logger.info({
    msg: '[dashboard] Global facility dashboard resolved',
    userId: session.user.id,
    organizationId,
    facilityCount: facilities.length,
    comparedFacilityCount: comparison?.facilityIds.length ?? 0,
    orgWide: isOrgWideFacilityRole(role),
  });

  return {
    facilities,
    ...toHeadline(facilities.length, headlineFigures, {
      facilities: computeTrendPercent(facilities.length, previousFacilityCount),
      staff: computeTrendPercent(headlineFigures.totalStaff, previousStaffCount),
    }),
    priorityRisks,
    facilitiesOverview,
    comparison,
  };
}
