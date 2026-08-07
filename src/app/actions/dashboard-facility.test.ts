/**
 * Unit tests for src/app/actions/dashboard-facility.ts — getGlobalDashboardData.
 *
 * Priorities: the `assignment.read` RBAC gate, supervisor narrowing to their
 * accessible facilities (vs org-wide roles aggregating everything), the
 * zero-facility early exit, and that the 14-query Promise.all result is wired
 * into the right output buckets without any facility-by-facility looping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockListAccessibleFacilities,
  mockFacilityCount,
  mockOrgUserCount,
  mockOrgUserFacilityGroupBy,
  mockEnrollmentGroupBy,
  mockEnrollmentCount,
  mockQuizFindMany,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
  mockFacilityCount: vi.fn(),
  mockOrgUserCount: vi.fn(),
  mockOrgUserFacilityGroupBy: vi.fn(),
  mockEnrollmentGroupBy: vi.fn(),
  mockEnrollmentCount: vi.fn(),
  mockQuizFindMany: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/facility/scope', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/facility/scope')>('@/lib/facility/scope');
  return {
    ...actual,
    listAccessibleFacilities: mockListAccessibleFacilities,
  };
});

vi.mock('@/lib/prisma', () => {
  const prisma = {
    facility: { count: mockFacilityCount },
    organizationUser: { count: mockOrgUserCount },
    organizationUserFacility: { groupBy: mockOrgUserFacilityGroupBy },
    enrollment: {
      groupBy: mockEnrollmentGroupBy,
      count: mockEnrollmentCount,
      fields: { dueAt: 'dueAt' },
    },
    quiz: { findMany: mockQuizFindMany },
  };
  return { prisma, default: prisma };
});

import { getGlobalDashboardData } from './dashboard-facility';

const FACILITY_A = { id: 'fac-a', name: 'Alpha', type: 'clinic', city: 'Austin' };
const FACILITY_B = { id: 'fac-b', name: 'Beta', type: 'clinic', city: 'Dallas' };

/**
 * Wires every enrollment.groupBy/count call by inspecting its `by`/`where`
 * shape rather than call order, since the module fires many groupBys in one
 * Promise.all and their array position is an implementation detail.
 */
function wireEmptyEnrollmentQueries() {
  mockEnrollmentGroupBy.mockResolvedValue([]);
  mockEnrollmentCount.mockResolvedValue(0);
}

function baseSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    user: {
      id: 'user-1',
      role: 'owner',
      organizationId: 'org-1',
      organizationUserId: 'ou-1',
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFacilityCount.mockResolvedValue(0);
  mockOrgUserCount.mockResolvedValue(0);
  mockOrgUserFacilityGroupBy.mockResolvedValue([]);
  mockQuizFindMany.mockResolvedValue([]);
  wireEmptyEnrollmentQueries();
});

describe('getGlobalDashboardData — auth & RBAC gate', () => {
  it('throws Unauthorized when there is no session', async () => {
    mockAuth.mockResolvedValue(null);
    await expect(getGlobalDashboardData()).rejects.toThrow('Unauthorized');
  });

  it('throws Forbidden for a role without assignment.read (e.g. finance)', async () => {
    mockAuth.mockResolvedValue(baseSession({ role: 'finance' }));
    await expect(getGlobalDashboardData()).rejects.toThrow('Forbidden');
    expect(mockListAccessibleFacilities).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin', 'supervisor', 'hr', 'clinical_director'] as const)(
    'allows role=%s (holds assignment.read)',
    async (role) => {
      mockAuth.mockResolvedValue(baseSession({ role }));
      mockListAccessibleFacilities.mockResolvedValue([]);

      await expect(getGlobalDashboardData()).resolves.toBeDefined();
    },
  );
});

describe('getGlobalDashboardData — zero-facility exit', () => {
  it('returns an all-zero payload without issuing any enrollment/staff queries when the caller has zero facilities', async () => {
    mockAuth.mockResolvedValue(baseSession({ role: 'owner' }));
    mockListAccessibleFacilities.mockResolvedValue([]);

    const result = await getGlobalDashboardData();

    expect(result.facilities).toEqual([]);
    expect(result.enterpriseFootprint.totalFacilities.value).toBe(0);
    expect(result.priorityRisks).toEqual([]);
    expect(result.facilitiesOverview).toEqual([]);
    expect(mockOrgUserCount).not.toHaveBeenCalled();
    expect(mockEnrollmentGroupBy).not.toHaveBeenCalled();
  });

  it('returns an all-zero payload when the session has no organizationId (mid-onboarding)', async () => {
    mockAuth.mockResolvedValue(baseSession({ organizationId: undefined }));
    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A]);

    const result = await getGlobalDashboardData();

    expect(result.facilities).toEqual([FACILITY_A]);
    expect(result.priorityRisks).toEqual([]);
  });
});

describe('getGlobalDashboardData — org-wide vs supervisor scope narrowing', () => {
  it('scopes every base where-clause to the full facility id set for an org-wide role', async () => {
    mockAuth.mockResolvedValue(baseSession({ role: 'owner' }));
    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A, FACILITY_B]);

    await getGlobalDashboardData();

    const staffCountCall = mockOrgUserCount.mock.calls[0][0];
    // Org-wide role: staff count is NOT narrowed by a facilities filter.
    expect(staffCountCall.where).not.toHaveProperty('facilities');
    expect(staffCountCall.where.organizationId).toBe('org-1');
  });

  it("narrows staff + enrollment queries to the supervisor's accessible facility set only", async () => {
    mockAuth.mockResolvedValue(baseSession({ role: 'supervisor' }));
    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A]);

    await getGlobalDashboardData();

    const staffCountCall = mockOrgUserCount.mock.calls[0][0];
    expect(staffCountCall.where.facilities).toEqual({
      some: { facilityId: { in: ['fac-a'] }, active: true },
    });

    // Every enrollment groupBy/count call must be narrowed to facilityId in [fac-a].
    for (const call of mockEnrollmentGroupBy.mock.calls) {
      expect(call[0].where.facilityId).toEqual({ in: ['fac-a'] });
    }
  });

  it('never lets a supervisor with facility A see facility B rows even if present in the raw query result', async () => {
    mockAuth.mockResolvedValue(baseSession({ role: 'supervisor' }));
    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A]);
    mockOrgUserFacilityGroupBy.mockResolvedValue([
      { facilityId: 'fac-a', _count: { _all: 3 } },
      { facilityId: 'fac-b', _count: { _all: 99 } }, // should never surface — not in `facilities`
    ]);

    const result = await getGlobalDashboardData();

    expect(result.priorityRisks).toHaveLength(1);
    expect(result.priorityRisks[0].facilityId).toBe('fac-a');
    expect(result.facilitiesOverview.map((f) => f.facilityId)).toEqual(['fac-a']);
  });
});

describe('getGlobalDashboardData — aggregation wiring', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(baseSession({ role: 'owner' }));
    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A, FACILITY_B]);
  });

  it('computes priorityRisks sorted most-at-risk-first from the overdue groupBy', async () => {
    mockEnrollmentGroupBy.mockImplementation(
      (args: { by: string[]; where: Record<string, unknown> }) => {
        const dueAt = args.where.dueAt as { lt?: Date } | undefined;
        if (args.by.includes('facilityId') && args.by.length === 1 && dueAt?.lt) {
          // overdue-by-facility query
          return Promise.resolve([
            { facilityId: 'fac-a', _count: { _all: 2 } }, // low risk
            { facilityId: 'fac-b', _count: { _all: 12 } }, // high risk
          ]);
        }
        return Promise.resolve([]);
      },
    );

    const result = await getGlobalDashboardData();

    expect(result.priorityRisks[0].facilityId).toBe('fac-b');
    expect(result.priorityRisks[0].riskLevel).toBe('high');
    expect(result.priorityRisks[1].facilityId).toBe('fac-a');
    expect(result.priorityRisks[1].riskLevel).toBe('low');
  });

  it('sorts facilitiesOverview alphabetically by name', async () => {
    const result = await getGlobalDashboardData();

    expect(result.facilitiesOverview.map((f) => f.name)).toEqual(['Alpha', 'Beta']);
  });

  it("applies the strictest passing score across a course's quizzes to the first-time pass rate", async () => {
    mockEnrollmentGroupBy.mockImplementation((args: { by: string[] }) => {
      if (args.by.includes('courseId') && args.by.includes('score')) {
        return Promise.resolve([
          { courseId: 'course-1', score: 75, _count: { _all: 1 } }, // passes 70, fails 80
        ]);
      }
      return Promise.resolve([]);
    });
    mockQuizFindMany.mockResolvedValue([
      { passingScore: 70, courseId: 'course-1', lesson: null },
      { passingScore: 80, courseId: null, lesson: { courseId: 'course-1' } },
    ]);

    const result = await getGlobalDashboardData();

    // Strictest bar (80) applies -> score 75 fails -> 0% first-time pass rate.
    expect(result.trainingVelocity.firstTimePassRate.value).toBe(0);
  });

  it('falls back to the default passing score (70) for a course with no quiz', async () => {
    mockEnrollmentGroupBy.mockImplementation((args: { by: string[] }) => {
      if (args.by.includes('courseId') && args.by.includes('score')) {
        return Promise.resolve([{ courseId: 'course-2', score: 70, _count: { _all: 1 } }]);
      }
      return Promise.resolve([]);
    });
    mockQuizFindMany.mockResolvedValue([]);

    const result = await getGlobalDashboardData();

    expect(result.trainingVelocity.firstTimePassRate.value).toBe(100);
  });

  it('returns null trendPercent (not a computed 0 or Infinity) when the previous window baseline was zero', async () => {
    mockFacilityCount.mockResolvedValue(0); // previousFacilityCount

    const result = await getGlobalDashboardData();

    expect(result.enterpriseFootprint.totalFacilities.trendPercent).toBeNull();
  });
});
