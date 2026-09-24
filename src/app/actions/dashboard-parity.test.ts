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
 *
 * Tier 3 (role parity) is the same property across the other axis, added for
 * BUG-01: one organisation must report one set of aggregates to every role that
 * can ask. Facility scope may still narrow the enrolment-derived figures — that
 * is what a facility-bound viewer is asking about — but the viewer's ROLE may
 * not narrow anything.
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

function hrSession() {
  return {
    user: { id: 'hr-1', role: 'hr', organizationId: ORG_ID, organizationUserId: 'ou-hr-1' },
  };
}

/** Finance: the one manager role that holds no `course.read`. */
function financeSession() {
  return {
    user: {
      id: 'fin-1',
      role: 'finance',
      organizationId: ORG_ID,
      organizationUserId: 'ou-finance-1',
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

/**
 * BUG-01, reproduced: for one organisation at one moment, Finance's tiles read
 * 2 Total Courses / 2 Total Staff Assigned where Owner's and HR's read 4 and 4.
 *
 * Finance is the only manager role without `course.read` (verified against the
 * registry, not assumed), so it was the only caller whose course population
 * collapsed to "courses I authored myself" — which, for a role that cannot
 * author any, left nothing but the organisation's adopted courses. Hence 2 of 4.
 *
 * Unlike Tier 2, these Prisma mocks EVALUATE the predicate they are handed
 * against a fixture catalogue, because the divergence is entirely in the `where`
 * — mocks that answer the same rows whatever they are asked would report parity
 * for a scope bug of any size.
 */
describe('dashboard-parity — Tier 3: role parity', () => {
  const ORG_AUTHOR = 'ou-owner-1';

  /**
   * Four courses: two written in-house, two adopted from another tenant's
   * catalogue. The split matters — the adopted pair is what Finance could still
   * see, which is why the bug showed up as a wrong number rather than a zero.
   */
  const CATALOGUE = [
    { id: 'c1', organizationId: ORG_ID, createdByOrgUserId: ORG_AUTHOR, archivedAt: null },
    { id: 'c2', organizationId: ORG_ID, createdByOrgUserId: ORG_AUTHOR, archivedAt: null },
    { id: 'c3', organizationId: 'org-other', createdByOrgUserId: 'ou-other', archivedAt: null },
    { id: 'c4', organizationId: 'org-other', createdByOrgUserId: 'ou-other', archivedAt: null },
  ];
  const ADOPTED = [{ courseId: 'c3' }, { courseId: 'c4' }];

  /** One learner and one score per course, so both tiles move together. */
  const ENROLLMENTS = [
    { courseId: 'c1', organizationUserId: 'u1', score: 80 },
    { courseId: 'c2', organizationUserId: 'u2', score: 90 },
    { courseId: 'c3', organizationUserId: 'u3', score: 60 },
    { courseId: 'c4', organizationUserId: 'u4', score: 70 },
  ];

  type CourseRow = (typeof CATALOGUE)[number];

  /**
   * Evaluates the shapes `resolveDashboardScope` can produce. An unrecognised
   * key throws rather than being ignored, so a future predicate cannot make this
   * suite quietly vacuous.
   */
  function matchesCourse(course: CourseRow, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      switch (key) {
        case 'OR':
          return (value as Record<string, unknown>[]).some((branch) =>
            matchesCourse(course, branch),
          );
        case 'organizationId':
          return course.organizationId === value;
        case 'createdByOrgUserId':
          return course.createdByOrgUserId === value;
        case 'id':
          return ((value as { in: string[] }).in ?? []).includes(course.id);
        case 'archivedAt':
          return value === null && course.archivedAt === null;
        default:
          throw new Error(`matchesCourse: unsupported course predicate key "${key}"`);
      }
    });
  }

  function visibleCourses(where: Record<string, unknown> | undefined): CourseRow[] {
    if (!where) throw new Error('a course read reached the fixture with no predicate at all');
    return CATALOGUE.filter((course) => matchesCourse(course, where));
  }

  function visibleEnrollments(where: { course?: Record<string, unknown> }) {
    const visibleIds = new Set(visibleCourses(where.course).map((course) => course.id));
    return ENROLLMENTS.filter((enrollment) => visibleIds.has(enrollment.courseId));
  }

  function courseCardRow(course: CourseRow) {
    return {
      id: course.id,
      title: `Course ${course.id}`,
      description: null,
      thumbnail: null,
      status: 'published',
      type: 'document',
      duration: 30,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      quiz: null,
      lessons: [{ quiz: null }],
    };
  }

  function wirePredicateAwarePrisma() {
    mockOrgCourseOfferingFindMany.mockResolvedValue(ADOPTED);

    mockCourseFindMany.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve(visibleCourses(args.where).map(courseCardRow)),
    );
    mockCourseCount.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve(visibleCourses(args.where).length),
    );

    mockEnrollmentGroupBy.mockImplementation(
      (args: { by: string[]; where: { course?: Record<string, unknown> } }) => {
        // The two staff-assigned tallies: `['organizationUserId', 'status']` on
        // the legacy dashboard, `['organizationUserId']` on the Global view.
        if (args.by[0] === 'organizationUserId') {
          return Promise.resolve(
            visibleEnrollments(args.where).map((enrollment) => ({
              organizationUserId: enrollment.organizationUserId,
              status: 'completed',
              _count: { _all: 1 },
            })),
          );
        }
        // Every per-facility grouping in the Global view is irrelevant to the
        // organisation totals under test.
        return Promise.resolve([]);
      },
    );

    mockEnrollmentFindMany.mockImplementation(
      (args: { where: { course?: Record<string, unknown> } }) =>
        Promise.resolve(
          visibleEnrollments(args.where).map((enrollment) => ({
            courseId: enrollment.courseId,
            score: enrollment.score,
            completedAt: new Date('2026-03-01'),
          })),
        ),
    );
    mockEnrollmentAggregate.mockImplementation(
      (args: { where: { course?: Record<string, unknown> } }) => {
        const scores = visibleEnrollments(args.where).map((enrollment) => enrollment.score);
        return Promise.resolve({
          _avg: {
            score:
              scores.length > 0
                ? scores.reduce((sum, score) => sum + score, 0) / scores.length
                : null,
          },
        });
      },
    );

    mockOrgUserCount.mockResolvedValue(ENROLLMENTS.length);
  }

  async function tilesFor(session: ReturnType<typeof ownerSession>) {
    mockAdminAuth.mockResolvedValue(session);
    mockAuth.mockResolvedValue(session);
    const legacy = await getDashboardData(null);
    const global = await getGlobalDashboardData();
    return { legacy, global };
  }

  beforeEach(() => {
    wirePredicateAwarePrisma();
    mockListAccessibleFacilities.mockResolvedValue([FACILITY_A]);
  });

  it('reports the same org aggregates to Finance as to Owner and HR — the reported 2-vs-4', async () => {
    const owner = await tilesFor(ownerSession());
    const hr = await tilesFor(hrSession());
    const finance = await tilesFor(financeSession());

    const expected = { totalCourses: 4, totalStaffAssigned: 4, averageGrade: 75 };

    expect(owner.legacy.stats).toMatchObject(expected);
    expect(hr.legacy.stats).toMatchObject(expected);
    // Pre-fix this read { totalCourses: 2, totalStaffAssigned: 2, averageGrade: 65 }
    // — the two adopted courses and their learners, everything authored in-house
    // having dropped out of Finance own population.
    expect(finance.legacy.stats).toMatchObject(expected);
  });

  it('agrees across roles on the Global view organisation totals too', async () => {
    const owner = await tilesFor(ownerSession());
    const finance = await tilesFor(financeSession());

    const expected = { totalCourses: 4, staffAssigned: 4, averageGrade: 75 };

    expect(owner.global.organisationTotals).toEqual(expected);
    expect(finance.global.organisationTotals).toEqual(expected);
  });

  it('issues no creator-scoped course predicate for ANY role that reaches the dashboard', async () => {
    for (const session of [ownerSession(), hrSession(), supervisorSession(), financeSession()]) {
      mockCourseFindMany.mockClear();
      mockCourseCount.mockClear();
      mockEnrollmentGroupBy.mockClear();
      mockEnrollmentFindMany.mockClear();

      await tilesFor(session);

      const wheres = [
        ...mockCourseFindMany.mock.calls.map((call) => call[0].where),
        ...mockCourseCount.mock.calls.map((call) => call[0].where),
        ...mockEnrollmentGroupBy.mock.calls.map((call) => call[0].where),
        ...mockEnrollmentFindMany.mock.calls.map((call) => call[0].where),
      ];
      expect(wheres.length).toBeGreaterThan(0);
      for (const where of wheres) {
        expect(containsKeyDeep(where, 'createdByOrgUserId')).toBe(false);
      }
    }
  });

  // Q-01 (2026-09-23): Finance may see the aggregates precisely because they
  // carry no employee-level detail. Widening the POPULATION must not widen what
  // Finance is handed — the course rows and the per-course chart stay withheld,
  // and that withholding is the caller decision, not a smaller tile.
  it('still withholds the course rows and the per-course chart from Finance', async () => {
    const owner = await tilesFor(ownerSession());
    const finance = await tilesFor(financeSession());

    expect(owner.legacy.courses).toHaveLength(4);
    expect(owner.legacy.stats.coursePerformance).toHaveLength(4);
    expect(finance.legacy.courses).toEqual([]);
    expect(finance.legacy.stats.coursePerformance).toEqual([]);
  });
});
