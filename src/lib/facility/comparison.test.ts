/**
 * Unit tests for the facility comparison projection. The comparison HEADLINE is
 * counted server-side from the compared facilities' data
 * (`GlobalDashboardData.comparison`); this module must pass it through verbatim
 * and never re-derive it by summing rows, which double-counts a member who
 * works at two compared facilities.
 */
import { describe, it, expect } from 'vitest';
import { buildFacilityComparison } from './comparison';
import type {
  FacilityOverviewRow,
  GlobalDashboardData,
  GlobalHeadline,
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
    activeLearners: 5,
    activeCourses: 2,
    averageGrade: 80,
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

function headline(staff: number, learners: number): GlobalHeadline {
  return {
    enterpriseFootprint: {
      totalFacilities: { value: 2, trendPercent: null },
      totalStaff: { value: staff, trendPercent: null },
    },
    trainingVelocity: {
      activeLearners: { value: learners, trendPercent: null },
      ongoingCourses: { value: 3, trendPercent: null },
      firstTimePassRate: { value: 75, trendPercent: null },
    },
    riskCompliance: {
      overdueTrainings: { value: 3, trendPercent: null },
      dormantStaff: { value: 1, trendPercent: null },
      expiringCredentials: { value: 0, trendPercent: null },
    },
  };
}

function data(comparison: GlobalDashboardData['comparison']): GlobalDashboardData {
  return {
    facilities: [
      { id: 'fac-a', name: 'Alpha Site', type: 'clinic', city: 'Austin' },
      { id: 'fac-b', name: 'Beta Site', type: 'clinic', city: 'Dallas' },
      { id: 'fac-c', name: 'Gamma Site', type: 'clinic', city: 'Houston' },
    ],
    ...headline(60, 30),
    priorityRisks: [
      riskRow({ facilityId: 'fac-c', name: 'Gamma Site' }),
      riskRow({ facilityId: 'fac-a' }),
      riskRow({ facilityId: 'fac-b', name: 'Beta Site' }),
    ],
    facilitiesOverview: [
      overviewRow({ facilityId: 'fac-a', staffCount: 10 }),
      overviewRow({ facilityId: 'fac-b', name: 'Beta Site', staffCount: 20 }),
      overviewRow({ facilityId: 'fac-c', name: 'Gamma Site', staffCount: 30 }),
    ],
    comparison,
  };
}

describe('buildFacilityComparison', () => {
  it('returns null when the server computed no comparison', () => {
    expect(buildFacilityComparison(data(null))).toBeNull();
  });

  it('passes the server-counted headline through instead of summing rows', () => {
    // fac-a (10) + fac-c (30) would sum to 40; one member works at both, so the
    // distinct count the server returns is 39.
    const comparison = buildFacilityComparison(
      data({ facilityIds: ['fac-c', 'fac-a'], ...headline(39, 12) }),
    );

    expect(comparison?.enterpriseFootprint.totalStaff).toEqual({ value: 39, trendPercent: null });
    expect(comparison?.trainingVelocity.activeLearners).toEqual({ value: 12, trendPercent: null });
  });

  it('narrows both tables to the compared rows, ordered by the payload', () => {
    const comparison = buildFacilityComparison(
      data({ facilityIds: ['fac-c', 'fac-a'], ...headline(39, 12) }),
    );

    expect(comparison?.facilityIds).toEqual(['fac-a', 'fac-c']);
    expect(comparison?.facilitiesOverview.map((row) => row.facilityId)).toEqual(['fac-a', 'fac-c']);
    expect(comparison?.priorityRisks.map((row) => row.facilityId)).toEqual(['fac-c', 'fac-a']);
  });

  it('reports the accessible total as the "Comparing N of M" denominator', () => {
    const comparison = buildFacilityComparison(
      data({ facilityIds: ['fac-a', 'fac-b'], ...headline(25, 8) }),
    );

    expect(comparison?.totalFacilityCount).toBe(3);
  });

  it('leaves the source payload untouched', () => {
    const payload = data({ facilityIds: ['fac-a', 'fac-b'], ...headline(25, 8) });
    const before = JSON.stringify(payload);

    buildFacilityComparison(payload);

    expect(JSON.stringify(payload)).toBe(before);
  });
});
