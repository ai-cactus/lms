/**
 * Unit tests for src/app/actions/dashboard-facility.ts — getGlobalDashboardData.
 *
 * Priorities: the RBAC gate (rosters OR billing), supervisor narrowing to their
 * accessible facilities by CURRENT ROSTER (never the `Enrollment.facilityId`
 * stamp), the zero-facility early exit, per-facility rows sliced from one
 * snapshot, trend chips only where history is honest, and a comparison headline
 * counted from data rather than summed from rows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockAuth,
  mockListAccessibleFacilities,
  mockFacilityCount,
  mockOrgUserCount,
  mockOrgUserFindMany,
  mockEnrollmentFindMany,
  mockQuizAttemptFindMany,
  mockCertificateFindMany,
  mockCourseFindMany,
  mockQuizFindMany,
  mockOrgCourseOfferingFindMany,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
  mockFacilityCount: vi.fn(),
  mockOrgUserCount: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
  mockEnrollmentFindMany: vi.fn(),
  mockQuizAttemptFindMany: vi.fn(),
  mockCertificateFindMany: vi.fn(),
  mockCourseFindMany: vi.fn(),
  mockQuizFindMany: vi.fn(),
  mockOrgCourseOfferingFindMany: vi.fn(),
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
    organizationUser: { count: mockOrgUserCount, findMany: mockOrgUserFindMany },
    enrollment: { findMany: mockEnrollmentFindMany },
    quizAttempt: { findMany: mockQuizAttemptFindMany },
    certificate: { findMany: mockCertificateFindMany },
    course: { findMany: mockCourseFindMany },
    quiz: { findMany: mockQuizFindMany },
    // resolveDashboardScope -> listAdoptedCourseIds; empty means "nothing adopted".
    orgCourseOffering: { findMany: mockOrgCourseOfferingFindMany },
  };
  return { prisma, default: prisma };
});

import { getGlobalDashboardData } from './dashboard-facility';

const FACILITY_A = { id: 'fac-a', name: 'Alpha', type: 'clinic', city: 'Austin' };
const FACILITY_B = { id: 'fac-b', name: 'Beta', type: 'clinic', city: 'Dallas' };

/** Frozen clock so each date cutoff is an exact, identifiable value. */
const NOW = new Date('2026-06-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * DAY);

interface MemberRow {
  id: string;
  role?: string;
  joinedAt?: Date;
  lastLoginAt?: Date | null;
  facilityIds?: string[];
}

interface EnrollmentRow {
  id: string;
  organizationUserId: string;
  courseId?: string;
  status?: string;
  startedAt?: Date;
  lastActivityAt?: Date | null;
  dueAt?: Date | null;
  completedAt?: Date | null;
  retakeOf?: string | null;
}

interface Fixture {
  members?: MemberRow[];
  enrollments?: EnrollmentRow[];
  attempts?: { enrollmentId: string; quizId: string; score: number; completedAt: Date }[];
  certificates?: {
    id: string;
    enrollmentId: string;
    organizationUserId: string;
    courseId: string;
    issuedAt: Date;
    renewalCycle: string;
  }[];
  quizzes?: { id: string; passingScore: number; courseId: string }[];
  publishedCourseIds?: string[];
}

function wireSnapshot(fixture: Fixture = {}) {
  mockOrgUserFindMany.mockResolvedValue(
    (fixture.members ?? []).map(({ facilityIds = [], ...m }) => ({
      role: 'nurse',
      joinedAt: daysAgo(100),
      lastLoginAt: daysAgo(1),
      ...m,
      facilities: facilityIds.map((facilityId) => ({ facilityId })),
    })),
  );
  mockEnrollmentFindMany.mockResolvedValue(
    (fixture.enrollments ?? []).map((e) => ({
      courseId: 'course-1',
      status: 'in_progress',
      startedAt: daysAgo(2),
      accessAt: null,
      lastActivityAt: daysAgo(1),
      dueAt: null,
      completedAt: null,
      retakeOf: null,
      ...e,
    })),
  );
  mockQuizAttemptFindMany.mockResolvedValue(fixture.attempts ?? []);
  mockCertificateFindMany.mockResolvedValue(
    (fixture.certificates ?? []).map(({ renewalCycle, ...c }) => ({
      ...c,
      enrollment: { assignment: { renewalCycle } },
    })),
  );
  mockCourseFindMany.mockResolvedValue(
    (fixture.publishedCourseIds ?? ['course-1']).map((id) => ({ id })),
  );
  mockQuizFindMany.mockResolvedValue((fixture.quizzes ?? []).map((q) => ({ ...q, lesson: null })));
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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mockFacilityCount.mockResolvedValue(0);
  mockOrgUserCount.mockResolvedValue(0);
  mockOrgCourseOfferingFindMany.mockResolvedValue([]);
  wireSnapshot();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getGlobalDashboardData — auth & RBAC gate', () => {
  it('throws Unauthorized when there is no session', async () => {
    mockAuth.mockResolvedValue(null);
    await expect(getGlobalDashboardData()).rejects.toThrow('Unauthorized');
  });

  // This payload is per-facility AGGREGATES — counts, percentages, risk levels.
  // No staff name or email appears in it, so overseeing the organisation's
  // finances is reason enough to see it.
  it.each(['owner', 'admin', 'supervisor', 'hr', 'clinical_director', 'finance'] as const)(
    'allows role=%s (oversees rosters or oversees billing)',
    async (role) => {
      mockAuth.mockResolvedValue(baseSession({ role }));
      mockListAccessibleFacilities.mockResolvedValue([]);

      await expect(getGlobalDashboardData()).resolves.toBeDefined();
    },
  );

  // `'use server'` exports are POST-invocable directly, so the gate must exclude
  // workers on its own. `enrollment.read` — the obvious way to admit finance —
  // would NOT: every worker role holds it to read their own enrollments.
  it.each([
    'nurse',
    'psychiatrist_prescriber',
    'therapist_clinician',
    'case_manager',
    'behavioral_health_technician',
    'peer_support_specialist',
    'front_desk_admin',
    'facilities_support',
  ] as const)('throws Forbidden for worker role=%s', async (role) => {
    mockAuth.mockResolvedValue(baseSession({ role }));

    await expect(getGlobalDashboardData()).rejects.toThrow('Forbidden');
    expect(mockListAccessibleFacilities).not.toHaveBeenCalled();
  });
});

describe('getGlobalDashboardData — zero-facility exit', () => {
  it('returns an all-zero payload without issuing any snapshot query when the caller has zero facilities', async () => {
    mockAuth.mockResolvedValue(baseSession({ role: 'owner' }));
    mockListAccessibleFacilities.mockResolvedValue([]);

    const result = await getGlobalDashboardData();

    expect(result.facilities).toEqual([]);
    expect(result.enterpriseFootprint.totalFacilities.value).toBe(0);
    expect(result.priorityRisks).toEqual([]);
    expect(result.facilitiesOverview).toEqual([]);
    expect(result.comparison).toBeNull();
    expect(mockOrgUserFindMany).not.toHaveBeenCalled();
    expect(mockEnrollmentFindMany).not.toHaveBeenCalled();
  });

  it('returns an all-zero payload when the session has no organizationId (mid-onboarding)', async () => {
    mockAuth.mockResolvedValue(baseSession({ organizationId: undefined }));
    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A]);

    const result = await getGlobalDashboardData();

    expect(result.facilities).toEqual([FACILITY_A]);
    expect(result.priorityRisks).toEqual([]);
  });
});

describe('getGlobalDashboardData — scope narrowing by current roster', () => {
  it('applies no roster narrowing for an org-wide role', async () => {
    mockAuth.mockResolvedValue(baseSession({ role: 'owner' }));
    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A, FACILITY_B]);

    await getGlobalDashboardData();

    const populationWhere = mockOrgUserFindMany.mock.calls[0][0].where;
    expect(populationWhere).not.toHaveProperty('facilities');
    expect(populationWhere).toMatchObject({ organizationId: 'org-1', active: true });
  });

  it("narrows the population and every enrolment read to the supervisor's facilities, never by the stamp", async () => {
    mockAuth.mockResolvedValue(baseSession({ role: 'supervisor' }));
    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A]);

    await getGlobalDashboardData();

    const roster = { facilities: { some: { facilityId: { in: ['fac-a'] }, active: true } } };
    expect(mockOrgUserFindMany.mock.calls[0][0].where).toMatchObject(roster);
    const enrollmentWhere = mockEnrollmentFindMany.mock.calls[0][0].where;
    expect(enrollmentWhere).not.toHaveProperty('facilityId');
    expect(enrollmentWhere.organizationUser).toMatchObject(roster);
    expect(mockOrgUserCount.mock.calls[0][0].where).toMatchObject(roster);
  });

  it('never lets a supervisor with facility A see a facility B row or B-only member', async () => {
    mockAuth.mockResolvedValue(baseSession({ role: 'supervisor' }));
    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A]);
    wireSnapshot({
      members: [
        { id: 'at-a', facilityIds: ['fac-a'] },
        // A superset row the DB narrowing would have excluded.
        { id: 'at-b', facilityIds: ['fac-b'] },
      ],
    });

    const result = await getGlobalDashboardData();

    expect(result.facilitiesOverview.map((f) => f.facilityId)).toEqual(['fac-a']);
    expect(result.priorityRisks.map((f) => f.facilityId)).toEqual(['fac-a']);
    expect(result.enterpriseFootprint.totalStaff.value).toBe(1);
  });
});

describe('getGlobalDashboardData — figures', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(baseSession({ role: 'owner' }));
    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A, FACILITY_B]);
  });

  it('sorts priorityRisks most-at-risk first from each facility’s overdue work', async () => {
    wireSnapshot({
      members: [
        { id: 'a1', facilityIds: ['fac-a'] },
        { id: 'b1', facilityIds: ['fac-b'] },
      ],
      enrollments: [
        // Alpha: overdue within grace at 80% completion -> medium.
        { id: 'e1', organizationUserId: 'a1', dueAt: daysAgo(2) },
        ...[2, 3, 4, 5].map((n) => ({
          id: `done-${n}`,
          organizationUserId: 'a1',
          status: 'attested',
          completedAt: daysAgo(n),
        })),
        // Beta: overdue past the 14-day grace -> high.
        { id: 'e2', organizationUserId: 'b1', dueAt: daysAgo(20) },
      ],
    });

    const result = await getGlobalDashboardData();

    expect(result.priorityRisks.map((r) => [r.facilityId, r.riskLevel])).toEqual([
      ['fac-b', 'high'],
      ['fac-a', 'medium'],
    ]);
  });

  it('counts approaching deadlines over the shared 14-day window, per facility', async () => {
    wireSnapshot({
      members: [{ id: 'b1', facilityIds: ['fac-b'] }],
      enrollments: [
        { id: 'e1', organizationUserId: 'b1', dueAt: daysAhead(14) },
        { id: 'e2', organizationUserId: 'b1', dueAt: daysAhead(15) },
        { id: 'e3', organizationUserId: 'b1', dueAt: daysAhead(3), status: 'attested' },
      ],
    });

    const result = await getGlobalDashboardData();

    expect(result.priorityRisks.find((r) => r.facilityId === 'fac-b')?.approachingDeadlines).toBe(
      1,
    );
    expect(result.priorityRisks.find((r) => r.facilityId === 'fac-a')?.approachingDeadlines).toBe(
      0,
    );
  });

  it('raises risk to high on an expired certificate alone', async () => {
    wireSnapshot({
      members: [{ id: 'a1', facilityIds: ['fac-a'] }],
      enrollments: [
        {
          id: 'e1',
          organizationUserId: 'a1',
          status: 'attested',
          completedAt: daysAgo(40),
        },
      ],
      certificates: [
        {
          id: 'cert-1',
          enrollmentId: 'e1',
          organizationUserId: 'a1',
          courseId: 'course-1',
          issuedAt: daysAgo(40),
          renewalCycle: 'monthly',
        },
      ],
    });

    const result = await getGlobalDashboardData();
    const alpha = result.facilitiesOverview.find((row) => row.facilityId === 'fac-a');

    expect(alpha?.riskLevel).toBe('high');
    expect(alpha?.auditReadiness).toBe('critical');
    // Expired is not expiring: the headline counts the next 30 days only.
    expect(result.riskCompliance.expiringCredentials.value).toBe(0);
  });

  it('counts a certificate expiring within 30 days, unless a later completion renewed it', async () => {
    const cert = (id: string, member: string) => ({
      id: `cert-${id}`,
      enrollmentId: id,
      organizationUserId: member,
      courseId: 'course-1',
      issuedAt: daysAgo(20),
      renewalCycle: 'monthly',
    });
    wireSnapshot({
      members: [
        { id: 'a1', facilityIds: ['fac-a'] },
        { id: 'a2', facilityIds: ['fac-a'] },
      ],
      enrollments: [
        { id: 'e1', organizationUserId: 'a1', status: 'attested', completedAt: daysAgo(20) },
        { id: 'e2', organizationUserId: 'a2', status: 'attested', completedAt: daysAgo(20) },
        { id: 'e3', organizationUserId: 'a2', status: 'attested', completedAt: daysAgo(1) },
      ],
      certificates: [cert('e1', 'a1'), cert('e2', 'a2')],
    });

    const result = await getGlobalDashboardData();

    expect(result.riskCompliance.expiringCredentials).toEqual({ value: 1, trendPercent: null });
  });

  it('leaves a facility with nothing assigned at low risk and audit ready', async () => {
    const result = await getGlobalDashboardData();

    expect(result.facilitiesOverview[0].riskLevel).toBe('low');
    expect(result.facilitiesOverview[0].auditReadiness).toBe('audit_ready');
  });

  it('attributes staff by current roster: a two-facility member counts in both rows, once in the headline', async () => {
    wireSnapshot({
      members: [
        { id: 'both', facilityIds: ['fac-a', 'fac-b'] },
        { id: 'b-only', facilityIds: ['fac-b'] },
        { id: 'nowhere', facilityIds: [] },
      ],
    });

    const result = await getGlobalDashboardData();
    const staff = Object.fromEntries(
      result.facilitiesOverview.map((row) => [row.facilityId, row.staffCount]),
    );

    expect(staff).toEqual({ 'fac-a': 1, 'fac-b': 2 });
    // The no-facility member counts in the organisation total only.
    expect(result.enterpriseFootprint.totalStaff.value).toBe(3);
  });

  it('totals overdue org-wide, including a member with no facility row', async () => {
    wireSnapshot({
      members: [
        { id: 'a1', facilityIds: ['fac-a'] },
        { id: 'nowhere', facilityIds: [] },
      ],
      enrollments: [
        { id: 'e1', organizationUserId: 'a1', dueAt: daysAgo(1) },
        { id: 'e2', organizationUserId: 'a1', dueAt: daysAgo(1), status: 'locked' },
        { id: 'e3', organizationUserId: 'nowhere', dueAt: daysAgo(1) },
      ],
    });

    const result = await getGlobalDashboardData();

    expect(result.riskCompliance.overdueTrainings.value).toBe(3);
    expect(result.priorityRisks.find((r) => r.facilityId === 'fac-a')?.overdueTrainings).toBe(2);
  });

  it('sorts facilitiesOverview alphabetically by name', async () => {
    const result = await getGlobalDashboardData();

    expect(result.facilitiesOverview.map((f) => f.name)).toEqual(['Alpha', 'Beta']);
  });

  it("judges the FIRST submitted attempt against that quiz's passing score", async () => {
    wireSnapshot({
      members: [{ id: 'a1', facilityIds: ['fac-a'] }],
      enrollments: [{ id: 'e1', organizationUserId: 'a1' }],
      attempts: [
        { enrollmentId: 'e1', quizId: 'q-1', score: 60, completedAt: daysAgo(3) },
        { enrollmentId: 'e1', quizId: 'q-1', score: 95, completedAt: daysAgo(2) },
      ],
      quizzes: [{ id: 'q-1', passingScore: 70, courseId: 'course-1' }],
    });

    const result = await getGlobalDashboardData();

    // Enrollment.score would hold the LATEST (95) and read as a pass.
    expect(result.trainingVelocity.firstTimePassRate.value).toBe(0);
  });

  it('counts Ongoing Courses as published courses with an unfinished enrolment', async () => {
    wireSnapshot({
      members: [{ id: 'a1', facilityIds: ['fac-a'] }],
      enrollments: [
        { id: 'e1', organizationUserId: 'a1', courseId: 'course-1' },
        { id: 'e2', organizationUserId: 'a1', courseId: 'course-draft' },
        { id: 'e3', organizationUserId: 'a1', courseId: 'course-done', status: 'completed' },
      ],
      publishedCourseIds: ['course-1', 'course-done'],
    });

    const result = await getGlobalDashboardData();

    expect(result.trainingVelocity.ongoingCourses.value).toBe(1);
    expect(result.trainingVelocity.activeLearners.value).toBe(1);
  });
});

describe('getGlobalDashboardData — trend chips', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(baseSession({ role: 'owner' }));
    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A, FACILITY_B]);
  });

  it('computes a trend only for Total Facilities and Total Staff', async () => {
    mockFacilityCount.mockResolvedValue(1);
    mockOrgUserCount.mockResolvedValue(4);
    wireSnapshot({
      members: [1, 2, 3, 4, 5].map((n) => ({ id: `m${n}`, facilityIds: ['fac-a'] })),
    });

    const result = await getGlobalDashboardData();

    expect(result.enterpriseFootprint.totalFacilities).toEqual({ value: 2, trendPercent: 100 });
    expect(result.enterpriseFootprint.totalStaff).toEqual({ value: 5, trendPercent: 25 });
    for (const metric of [
      ...Object.values(result.trainingVelocity),
      ...Object.values(result.riskCompliance),
    ]) {
      expect(metric.trendPercent).toBeNull();
    }
  });

  it('reconstructs the previous staff population from joinedAt / deactivatedAt a window ago', async () => {
    await getGlobalDashboardData();

    const where = mockOrgUserCount.mock.calls[0][0].where;
    expect(where.joinedAt).toEqual({ lt: new Date('2026-05-16T12:00:00.000Z') });
    expect(where.AND[0]).toEqual({
      OR: [{ active: true }, { deactivatedAt: { gte: new Date('2026-05-16T12:00:00.000Z') } }],
    });
  });

  it('returns null trendPercent (not 0 or Infinity) when the previous baseline was zero', async () => {
    mockFacilityCount.mockResolvedValue(0);

    const result = await getGlobalDashboardData();

    expect(result.enterpriseFootprint.totalFacilities.trendPercent).toBeNull();
  });
});

describe('getGlobalDashboardData — comparison', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(baseSession({ role: 'owner' }));
    mockListAccessibleFacilities.mockResolvedValue([
      FACILITY_A,
      FACILITY_B,
      { id: 'fac-c', name: 'Gamma', type: 'clinic', city: 'Houston' },
    ]);
  });

  it('counts the compared headline from data — a member on both facilities counts ONCE', async () => {
    wireSnapshot({
      members: [
        { id: 'both', facilityIds: ['fac-a', 'fac-b'] },
        { id: 'a-only', facilityIds: ['fac-a'] },
        { id: 'c-only', facilityIds: ['fac-c'] },
      ],
      enrollments: [
        { id: 'e1', organizationUserId: 'both' },
        { id: 'e2', organizationUserId: 'a-only' },
      ],
    });

    const result = await getGlobalDashboardData({ compareFacilityIds: ['fac-a', 'fac-b'] });

    // Summing the rows would read 2 + 1 = 3 staff and 2 + 1 = 3 learners.
    expect(result.comparison?.facilityIds).toEqual(['fac-a', 'fac-b']);
    expect(result.comparison?.enterpriseFootprint.totalFacilities).toEqual({
      value: 2,
      trendPercent: null,
    });
    expect(result.comparison?.enterpriseFootprint.totalStaff).toEqual({
      value: 2,
      trendPercent: null,
    });
    expect(result.comparison?.trainingVelocity.activeLearners.value).toBe(2);
    // The unfiltered headline is unaffected.
    expect(result.enterpriseFootprint.totalStaff.value).toBe(3);
  });

  it('drops inaccessible ids and returns no comparison below two survivors', async () => {
    const result = await getGlobalDashboardData({
      compareFacilityIds: ['fac-a', 'other-tenant'],
    });

    expect(result.comparison).toBeNull();
  });

  it('returns no comparison when none is requested', async () => {
    const result = await getGlobalDashboardData();

    expect(result.comparison).toBeNull();
  });
});
