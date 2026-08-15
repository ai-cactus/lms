/**
 * Facility comparison view-model.
 *
 * The Global dashboard is fetched once, org-wide; comparing a subset of
 * facilities is a projection of that payload rather than a second round of
 * queries. Only figures that already exist per facility are re-aggregated —
 * an org-only metric (no per-facility breakdown in the payload) keeps its
 * organisation value rather than being fabricated for the subset.
 */
import { MIN_COMPARISON_FACILITIES } from '@/lib/facility/scope-param';
import type {
  DashboardMetric,
  FacilityOverviewRow,
  GlobalDashboardData,
  PriorityRiskRow,
} from '@/app/actions/dashboard-facility';

export interface FacilityComparison {
  /** The compared facilities, in the payload's (alphabetical) order. */
  facilityIds: string[];
  /** Accessible facility count — the denominator of "Comparing N of M". */
  totalFacilityCount: number;
  facilitiesOverview: FacilityOverviewRow[];
  priorityRisks: PriorityRiskRow[];
  enterpriseFootprint: GlobalDashboardData['enterpriseFootprint'];
  trainingVelocity: GlobalDashboardData['trainingVelocity'];
  riskCompliance: GlobalDashboardData['riskCompliance'];
}

/**
 * A figure re-derived from the per-facility rows. The payload carries no
 * per-facility history, so a subset total has no basis for a trend.
 */
function derived(value: number): DashboardMetric {
  return { value, trendPercent: null };
}

function sumBy<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

/**
 * Project the Global dashboard payload onto the requested facilities, or `null`
 * when the request is not a comparison (fewer than two of the requested ids are
 * in the payload — which only ever contains facilities the caller may view, so
 * this doubles as a tenancy filter).
 */
export function buildFacilityComparison(
  data: GlobalDashboardData,
  requestedFacilityIds: string[],
): FacilityComparison | null {
  const requested = new Set(requestedFacilityIds);
  const facilityIds = data.facilities
    .filter((facility) => requested.has(facility.id))
    .map((facility) => facility.id);

  if (facilityIds.length < MIN_COMPARISON_FACILITIES) return null;

  const selected = new Set(facilityIds);
  const facilitiesOverview = data.facilitiesOverview.filter((row) => selected.has(row.facilityId));
  const priorityRisks = data.priorityRisks.filter((row) => selected.has(row.facilityId));

  return {
    facilityIds,
    totalFacilityCount: data.facilities.length,
    facilitiesOverview,
    priorityRisks,
    enterpriseFootprint: {
      totalFacilities: derived(facilityIds.length),
      totalStaff: derived(sumBy(facilitiesOverview, (row) => row.staffCount)),
    },
    trainingVelocity: {
      ...data.trainingVelocity,
      activeLearners: derived(sumBy(priorityRisks, (row) => row.activeLearners)),
    },
    riskCompliance: {
      ...data.riskCompliance,
      overdueTrainings: derived(sumBy(priorityRisks, (row) => row.overdueTrainings)),
    },
  };
}
