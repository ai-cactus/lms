/**
 * Cross-branch parity between `getDashboardData` (course.ts, the legacy
 * single-facility dashboard) and `getGlobalDashboardData` (dashboard-facility.ts,
 * the multi-facility dashboard). See `src/lib/dashboard/scope.ts` for the shared
 * seam both actions read their population from.
 *
 * The bug this suite exists to make structurally impossible: an org with one
 * facility saw `getDashboardData` counting only the VIEWER's own authored
 * courses, while an org with two or more facilities saw `getGlobalDashboardData`
 * counting the organisation. Same org, different numbers, purely as a function
 * of how many facilities it had. Third recurrence of this bug class
 * (`getCourses` and `enrollUsers` were each widened for it and this pair was
 * missed both times) — see `.claude/agent-memory/code-ninja/gotcha_dashboard_two_actions_one_population.md`.
 *
 * Tier 1 (predicate parity) is the property that makes a fourth recurrence
 * impossible: it inspects EVERY captured Prisma call, not a hand-picked subset,
 * so a newly added aggregate that forgets to spread the shared scope fails this
 * suite automatically rather than needing its own bespoke assertion.
 *
 * Tier 2 (numeric parity) is the user-visible form of the bug, reproduced
 * without a DB: one fixture dataset, run through both actions at one facility
 * and at two, asserting all four results agree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockAuth,
  mockListAccessibleFacilities,
  mockCourseFindMany,
  mockCourseCount,
  mockEnrollmentGroupBy,
  mockEnrollmentFindMany,
  mockEnrollmentCount,
  mockEnrollmentAggregate,
  mockOrgUserCount,
  mockOrgUserFacilityGroupBy,
  mockFacilityCount,
  mockQuizFindMany,
  mockOrgCourseOfferingFindMany,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockAuth: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
  mockCourseFindMany: vi.fn(),
  mockCourseCount: vi.fn(),
  mockEnrollmentGroupBy: vi.fn(),
  mockEnrollmentFindMany: vi.fn(),
  mockEnrollmentCount: vi.fn(),
  mockEnrollmentAggregate: vi.fn(),
  mockOrgUserCount: vi.fn(),
  mockOrgUserFacilityGroupBy: vi.fn(),
  mockFacilityCount: vi.fn(),
  mockQuizFindMany: vi.fn(),
  mockOrgCourseOfferingFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findMany: mockCourseFindMany, count: mockCourseCount },
    enrollment: {
      groupBy: mockEnrollmentGroupBy,
      findMany: mockEnrollmentFindMany,
      count: mockEnrollmentCount,
      aggregate: mockEnrollmentAggregate,
      fields: { dueAt: 'dueAt' },
    },
    organizationUser: { count: mockOrgUserCount },
    organizationUserFacility: { groupBy: mockOrgUserFacilityGroupBy },
    facility: { count: mockFacilityCount },
    quiz: { findMany: mockQuizFindMany },
    // resolveDashboardScope -> listAdoptedCourseIds; empty means "nothing
    // adopted", exercised on its own in dashboard/scope.test.ts.
    orgCourseOffering: { findMany: mockOrgCourseOfferingFindMany },
  };
  return { prisma, default: prisma };
});
// getDashboardData resolves its session via resolveSession() (admin-then-worker
// auth). getGlobalDashboardData uses '@/auth' directly — both modules import the
// SAME '@/auth', so one mock drives both under one session.
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// `isOrgWideFacilityRole` is kept real (pure role-list lookup) — only
// `listAccessibleFacilities` is stubbed, so the org-wide/facility-bound split
// driving the parity assertions is the genuine one.
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { getDashboardData } from './course';
import { getGlobalDashboardData } from './dashboard-facility';

const ORG_ID = 'org-parity-1';
const ORG_USER_ID = 'ou-parity-1';

const FACILITY_A = { id: 'fac-a', name: 'Alpha', type: 'clinic', city: 'Austin' };
const FACILITY_B = { id: 'fac-b', name: 'Beta', type: 'clinic', city: 'Dallas' };

function ownerSession() {
  return {
    user: { id: 'owner-1', role: 'owner', organizationId: ORG_ID, organizationUserId: ORG_USER_ID },
  };
}

function supervisorSession() {
  return {
    user: {
      id: 'sup-1',
      role: 'supervisor',
      organizationId: ORG_ID,
      organizationUserId: ORG_USER_ID,
    },
  };
}

/** Resolves every `enrollment.groupBy`/`findMany`/`aggregate`/`count` call empty. */
function wireEmptyPrisma() {
  mockCourseFindMany.mockResolvedValue([]);
  mockCourseCount.mockResolvedValue(0);
  mockEnrollmentGroupBy.mockResolvedValue([]);
  mockEnrollmentFindMany.mockResolvedValue([]);
  mockEnrollmentCount.mockResolvedValue(0);
  mockEnrollmentAggregate.mockResolvedValue({ _avg: { score: null } });
  mockOrgUserCount.mockResolvedValue(0);
  mockOrgUserFacilityGroupBy.mockResolvedValue([]);
  mockFacilityCount.mockResolvedValue(0);
  mockQuizFindMany.mockResolvedValue([]);
  mockOrgCourseOfferingFindMany.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkerAuth.mockResolvedValue(null);
  mockOrgCourseOfferingFindMany.mockResolvedValue([]);
  wireEmptyPrisma();
});

/** True if `key` appears anywhere in `value`, at any depth (arrays included). */
function containsKeyDeep(value: unknown, key: string): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => containsKeyDeep(entry, key));
  const record = value as Record<string, unknown>;
  if (key in record) return true;
  return Object.values(record).some((entry) => containsKeyDeep(entry, key));
}

describe('dashboard-parity — Tier 1: predicate parity', () => {
  it('pins the identical org + facility scope on every captured enrollment predicate, and no creator-scoped course predicate, for an ORG-WIDE manager', async () => {
    const session = ownerSession();
    mockAdminAuth.mockResolvedValue(session);
    mockAuth.mockResolvedValue(session);
    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A]);

    await getDashboardData(null);
    await getGlobalDashboardData();

    const enrollmentWheres = [
      ...mockEnrollmentGroupBy.mock.calls.map((call) => call[0].where),
      ...mockEnrollmentFindMany.mock.calls.map((call) => call[0].where),
      ...mockEnrollmentCount.mock.calls.map((call) => call[0].where),
      ...mockEnrollmentAggregate.mock.calls.map((call) => call[0].where),
    ];
    // Sanity: both actions actually issued enrollment queries under this
    // fixture — an empty list here would make every assertion below vacuous.
    expect(enrollmentWheres.length).toBeGreaterThan(0);

    for (const where of enrollmentWheres) {
      // The org pin — invariant A. `OrgCourseOffering` links a course to ANY
      // organisation, so a course-only predicate would count another tenant's
      // learners on an adopted course; this pin is what prevents that.
      expect(where.organizationUser?.organizationId).toBe(ORG_ID);
      // The facility clause — org-wide role, so every call must OMIT
      // `facilityId` (the `null` branch of the `string[] | null` contract),
      // never widen-by-omission on one side and narrow on the other.
      expect(where).not.toHaveProperty('facilityId');
      // The archive predicate — invariant C. The query extension filters Course's
      // OWN reads, so `course.count` drops an archived course while a nested
      // `course:` traversal keeps it. `scope.enrollmentWhere` carries this, but a
      // call site that restates `course:` SHADOWS it — which is exactly how
      // "Total Courses" and "Total Staff Assigned" came to describe different
      // catalogues. Asserting it on every captured predicate catches both.
      expect(where.course).toMatchObject({ archivedAt: null });
    }

    const allWheres = [
      ...enrollmentWheres,
      ...mockCourseFindMany.mock.calls.map((call) => call[0].where),
      ...mockCourseCount.mock.calls.map((call) => call[0].where),
    ];
    for (const where of allWheres) {
      // Invariant: a manager (owner holds course.read) never gets a
      // creator-scoped course predicate anywhere — that literal IS the bug.
      expect(containsKeyDeep(where, 'createdByOrgUserId')).toBe(false);
    }
  });

  it('pins the identical facility narrowing on every captured enrollment predicate for a FACILITY-BOUND manager', async () => {
    const session = supervisorSession();
    mockAdminAuth.mockResolvedValue(session);
    mockAuth.mockResolvedValue(session);
    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A, FACILITY_B]);

    await getDashboardData(null);
    await getGlobalDashboardData();

    const enrollmentWheres = [
      ...mockEnrollmentGroupBy.mock.calls.map((call) => call[0].where),
      ...mockEnrollmentFindMany.mock.calls.map((call) => call[0].where),
      ...mockEnrollmentCount.mock.calls.map((call) => call[0].where),
      ...mockEnrollmentAggregate.mock.calls.map((call) => call[0].where),
    ];
    expect(enrollmentWheres.length).toBeGreaterThan(0);

    for (const where of enrollmentWheres) {
      expect(where.organizationUser?.organizationId).toBe(ORG_ID);
      // Facility-bound with two accessible facilities: every call must narrow
      // to that IDENTICAL id set, never fall back to `{}` (the D-01 fail-open
      // `staff-where.ts`'s header exists to prevent) on either side.
      expect(where.facilityId).toEqual({ in: ['fac-a', 'fac-b'] });
      expect(where.course).toMatchObject({ archivedAt: null });
    }
  });

  // Sabotage proof (run manually, not part of the committed suite): temporarily
  // add a new Prisma call to either action that reads `enrollment` without
  // spreading `scope.enrollmentWhere` (e.g. `prisma.enrollment.count({ where: {
  // score: { not: null } } })` with no org pin) and confirm the first test in
  // this file goes red on `where.organizationUser?.organizationId`, then revert.
  // This is the property that makes a fourth recurrence of the bug impossible:
  // a forgotten scope spread fails this suite rather than shipping unnoticed.
});

describe('dashboard-parity — Tier 2: numeric parity', () => {
  const COURSE_X = {
    id: 'course-x',
    title: 'Course X',
    description: null,
    thumbnail: null,
    status: 'published',
    type: 'document',
    duration: 30,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    quiz: { passingScore: 70 },
    lessons: [{ quiz: null }],
  };
  const COURSE_Y = {
    id: 'course-y',
    title: 'Course Y',
    description: null,
    thumbnail: null,
    status: 'published',
    type: 'document',
    duration: 15,
    createdAt: new Date('2026-01-02'),
    updatedAt: new Date('2026-01-02'),
    quiz: null,
    lessons: [{ quiz: null }],
  };

  // Two scored enrollments whose average sits exactly on a .5 boundary (85.5),
  // to probe the two independent rounding paths per the plan's Compat note:
  // `getDashboardData` does `Math.round(sum/n)` in JS over fetched rows, while
  // `getGlobalDashboardData` rounds a Postgres `AVG`. A mocked unit test can't
  // reproduce Postgres's own floating-point/numeric division — it can only prove
  // that, GIVEN the identical average, `Math.round` behaves identically on both
  // sides. Real divergence risk (if any) is in the arithmetic backend, not the
  // rounding call, and stays unverified without hitting a real Postgres AVG.
  const SCORE_A = 85;
  const SCORE_B = 86;
  const AVERAGE = (SCORE_A + SCORE_B) / 2; // 85.5

  function wireSharedFixture() {
    // course.ts / getDashboardData — creator-scoped courses + row-level
    // aggregates it computes itself.
    mockCourseFindMany.mockResolvedValue([COURSE_X, COURSE_Y]);
    mockEnrollmentGroupBy.mockImplementation((args: { by: string[] }) => {
      if (args.by.includes('courseId') && args.by.includes('status')) {
        return Promise.resolve([
          { courseId: 'course-x', status: 'completed', _count: { _all: 2 } },
        ]);
      }
      if (args.by.includes('organizationUserId') && args.by.includes('status')) {
        return Promise.resolve([
          { organizationUserId: 'u1', status: 'completed', _count: { _all: 1 } },
          { organizationUserId: 'u2', status: 'completed', _count: { _all: 1 } },
        ]);
      }
      // dashboard-facility.ts / getGlobalDashboardData — every other groupBy in
      // this suite (per-facility risk/coverage breakdowns) is irrelevant to the
      // three totals under test; only the ungrouped staff-assigned tally below
      // feeds them, everything else stays empty.
      if (args.by.length === 1 && args.by[0] === 'organizationUserId') {
        return Promise.resolve([
          { organizationUserId: 'u1', _count: { _all: 1 } },
          { organizationUserId: 'u2', _count: { _all: 1 } },
        ]);
      }
      return Promise.resolve([]);
    });
    mockEnrollmentFindMany.mockResolvedValue([
      { courseId: 'course-x', score: SCORE_A, completedAt: new Date('2026-03-01') },
      { courseId: 'course-x', score: SCORE_B, completedAt: new Date('2026-03-02') },
    ]);
    mockOrgUserCount.mockResolvedValue(5);

    // dashboard-facility.ts / getGlobalDashboardData — the SAME population,
    // expressed as the aggregates `organisationTotals` reads.
    mockCourseCount.mockResolvedValue(2);
    mockEnrollmentAggregate.mockResolvedValue({ _avg: { score: AVERAGE } });
  }

  async function runBoth(session: ReturnType<typeof ownerSession>) {
    mockAdminAuth.mockResolvedValue(session);
    mockAuth.mockResolvedValue(session);
    const legacy = await getDashboardData(null);
    const global = await getGlobalDashboardData();
    return { legacy, global };
  }

  it('one facility and two facilities agree with each other, and with the Global dashboard, for an ORG-WIDE role', async () => {
    wireSharedFixture();
    const session = ownerSession();

    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A]);
    const oneFacility = await runBoth(session);

    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A, FACILITY_B]);
    const twoFacilities = await runBoth(session);

    const expectedStats = { totalCourses: 2, totalStaffAssigned: 2, averageGrade: 86 };
    const expectedOrgTotals = { totalCourses: 2, staffAssigned: 2, averageGrade: 86 };

    // This is the user's bug, made checkable: the SAME organisation must report
    // the SAME figures whether it has one facility or two.
    expect(oneFacility.legacy.stats).toMatchObject(expectedStats);
    expect(twoFacilities.legacy.stats).toMatchObject(expectedStats);
    expect(oneFacility.global.organisationTotals).toEqual(expectedOrgTotals);
    expect(twoFacilities.global.organisationTotals).toEqual(expectedOrgTotals);

    // Cross-action parity in each configuration.
    expect(oneFacility.legacy.stats.totalCourses).toBe(
      oneFacility.global.organisationTotals.totalCourses,
    );
    expect(oneFacility.legacy.stats.totalStaffAssigned).toBe(
      oneFacility.global.organisationTotals.staffAssigned,
    );
    expect(oneFacility.legacy.stats.averageGrade).toBe(
      oneFacility.global.organisationTotals.averageGrade,
    );

    expect(twoFacilities.legacy.stats.totalCourses).toBe(
      twoFacilities.global.organisationTotals.totalCourses,
    );
    expect(twoFacilities.legacy.stats.totalStaffAssigned).toBe(
      twoFacilities.global.organisationTotals.staffAssigned,
    );
    expect(twoFacilities.legacy.stats.averageGrade).toBe(
      twoFacilities.global.organisationTotals.averageGrade,
    );
  });
});
