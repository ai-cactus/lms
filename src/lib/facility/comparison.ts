/**
 * Facility comparison view-model.
 *
 * The headline over the compared facilities is counted server-side from their
 * data (`GlobalDashboardData.comparison`) — summing per-facility rows counts a
 * member on two compared facilities twice. This module only narrows the two
 * tables to the compared rows.
 */
import type {
  FacilityOverviewRow,
  GlobalDashboardData,
  GlobalHeadline,
  PriorityRiskRow,
} from '@/app/actions/dashboard-facility';

export interface FacilityComparison extends GlobalHeadline {
  /** The compared facilities, in the payload's (alphabetical) order. */
  facilityIds: string[];
  /** Accessible facility count — the denominator of "Comparing N of M". */
  totalFacilityCount: number;
  facilitiesOverview: FacilityOverviewRow[];
  priorityRisks: PriorityRiskRow[];
}

/** The comparison projection of the payload, or `null` when it is not a comparison. */
export function buildFacilityComparison(data: GlobalDashboardData): FacilityComparison | null {
  if (!data.comparison) return null;

  const selected = new Set(data.comparison.facilityIds);
  const { enterpriseFootprint, trainingVelocity, riskCompliance } = data.comparison;

  return {
    facilityIds: data.facilities.filter((f) => selected.has(f.id)).map((f) => f.id),
    totalFacilityCount: data.facilities.length,
    facilitiesOverview: data.facilitiesOverview.filter((row) => selected.has(row.facilityId)),
    priorityRisks: data.priorityRisks.filter((row) => selected.has(row.facilityId)),
    enterpriseFootprint,
    trainingVelocity,
    riskCompliance,
  };
}
