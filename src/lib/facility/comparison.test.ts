/**
 * Unit tests for the facility comparison projection: which rows survive, which
 * KPIs are re-aggregated over the selection, and which keep their organisation
 * value because the payload carries no per-facility breakdown for them.
 */
import { describe, it, expect } from 'vitest';
import { buildFacilityComparison } from './comparison';
import type {
  FacilityOverviewRow,
  GlobalDashboardData,
  PriorityRiskRow,
} from '@/app/actions/dashboard-facility';

function overviewRow(overrides: Partial<FacilityOverviewRow> = {}): FacilityOverviewRow {
  return {
    facilityId: 'fac-a',
    name: 'Alpha Site',
    type: 'clinic',
    staffCount: 10,
    activeTrainings: 4,
    completionPercent: 90,
    auditReadinessPercent: 95,
    auditReadiness: 'audit_ready',
    riskLevel: 'low',
    ...overrides,
  };
}

function riskRow(overrides: Partial<PriorityRiskRow> = {}): PriorityRiskRow {
  return {
    facilityId: 'fac-a',
    name: 'Alpha Site',
    type: 'clinic',
    activeLearners: 5,
    approachingDeadlines: 1,
    overdueTrainings: 2,
    riskLevel: 'low',
    ...overrides,
  };
}

const DATA: GlobalDashboardData = {
  facilities: [
    { id: 'fac-a', name: 'Alpha Site', type: 'clinic', city: 'Austin' },
    { id: 'fac-b', name: 'Beta Site', type: 'clinic', city: 'Dallas' },
    { id: 'fac-c', name: 'Gamma Site', type: 'clinic', city: 'Houston' },
  ],
  enterpriseFootprint: {
    totalFacilities: { value: 3, trendPercent: 20 },
    totalStaff: { value: 60, trendPercent: 5 },
  },
  trainingVelocity: {
    activeLearners: { value: 30, trendPercent: null },
    ongoingCourses: { value: 12, trendPercent: null },
    firstTimePassRate: { value: 88, trendPercent: null },
  },
  riskCompliance: {
    overdueTrainings: { value: 9, trendPercent: null },
    dormantStaff: { value: 4, trendPercent: null },
    expiringCredentials: { value: 7, trendPercent: -10 },
  },
  priorityRisks: [
    riskRow({ facilityId: 'fac-c', name: 'Gamma Site', activeLearners: 7, overdueTrainings: 6 }),
    riskRow({ facilityId: 'fac-a', activeLearners: 5, overdueTrainings: 2 }),
    riskRow({ facilityId: 'fac-b', name: 'Beta Site', activeLearners: 3, overdueTrainings: 1 }),
  ],
  facilitiesOverview: [
    overviewRow({ facilityId: 'fac-a', staffCount: 10 }),
    overviewRow({ facilityId: 'fac-b', name: 'Beta Site', staffCount: 20 }),
    overviewRow({ facilityId: 'fac-c', name: 'Gamma Site', staffCount: 30 }),
  ],
};

describe('buildFacilityComparison', () => {
  it.each([[[]], [['fac-a']], [['fac-a', 'fac-a']]])(
    'returns null for %j — fewer than two facilities is not a comparison',
    (requested) => {
      expect(buildFacilityComparison(DATA, requested)).toBeNull();
    },
  );

  it('returns null when only one requested id exists in the payload', () => {
    expect(buildFacilityComparison(DATA, ['fac-a', 'not-in-payload'])).toBeNull();
  });

  it('ignores ids absent from the payload — the payload is already the tenancy boundary', () => {
    const comparison = buildFacilityComparison(DATA, ['fac-a', 'fac-b', 'other-tenant']);

    expect(comparison?.facilityIds).toEqual(['fac-a', 'fac-b']);
    expect(comparison?.facilitiesOverview.map((row) => row.facilityId)).toEqual(['fac-a', 'fac-b']);
    expect(comparison?.priorityRisks.map((row) => row.facilityId)).toEqual(['fac-a', 'fac-b']);
  });

  it('orders the compared ids by the payload, not by the request', () => {
    const comparison = buildFacilityComparison(DATA, ['fac-c', 'fac-a']);

    expect(comparison?.facilityIds).toEqual(['fac-a', 'fac-c']);
  });

  it('reports the accessible total as the "Comparing N of M" denominator', () => {
    const comparison = buildFacilityComparison(DATA, ['fac-a', 'fac-b']);

    expect(comparison?.totalFacilityCount).toBe(3);
  });

  it('re-aggregates the per-facility KPIs over the selection, without a trend', () => {
    const comparison = buildFacilityComparison(DATA, ['fac-a', 'fac-b']);

    expect(comparison?.enterpriseFootprint.totalFacilities).toEqual({
      value: 2,
      trendPercent: null,
    });
    expect(comparison?.enterpriseFootprint.totalStaff).toEqual({ value: 30, trendPercent: null });
    expect(comparison?.trainingVelocity.activeLearners).toEqual({ value: 8, trendPercent: null });
    expect(comparison?.riskCompliance.overdueTrainings).toEqual({ value: 3, trendPercent: null });
  });

  it('keeps the organisation value for metrics with no per-facility breakdown', () => {
    const comparison = buildFacilityComparison(DATA, ['fac-a', 'fac-b']);

    expect(comparison?.trainingVelocity.ongoingCourses).toEqual(
      DATA.trainingVelocity.ongoingCourses,
    );
    expect(comparison?.trainingVelocity.firstTimePassRate).toEqual(
      DATA.trainingVelocity.firstTimePassRate,
    );
    expect(comparison?.riskCompliance.dormantStaff).toEqual(DATA.riskCompliance.dormantStaff);
    expect(comparison?.riskCompliance.expiringCredentials).toEqual(
      DATA.riskCompliance.expiringCredentials,
    );
  });

  it('leaves the source payload untouched', () => {
    const snapshot = JSON.stringify(DATA);

    buildFacilityComparison(DATA, ['fac-a', 'fac-b']);

    expect(JSON.stringify(DATA)).toBe(snapshot);
  });
});
