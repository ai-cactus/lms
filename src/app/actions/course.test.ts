import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockCourseFindMany,
  mockCourseFindFirst,
  mockEnrollmentGroupBy,
  mockEnrollmentFindMany,
  mockOrgUserCount,
  mockForkCourse,
  mockResolveFacilityScope,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindMany: vi.fn(),
  mockCourseFindFirst: vi.fn(),
  mockEnrollmentGroupBy: vi.fn(),
  mockEnrollmentFindMany: vi.fn(),
  mockOrgUserCount: vi.fn(),
  mockForkCourse: vi.fn(),
  mockResolveFacilityScope: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findMany: mockCourseFindMany, findFirst: mockCourseFindFirst },
    enrollment: { groupBy: mockEnrollmentGroupBy, findMany: mockEnrollmentFindMany },
    // Post refactor: total org staff is counted on OrganizationUser (scoped to
    // WORKER_ROLES), not a raw `prisma.user.count`.
    organizationUser: { count: mockOrgUserCount },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/course/fork-course', () => ({ forkCourse: mockForkCourse }));
// getDashboardData re-validates `requestedFacilityId` through resolveFacilityScope;
// mocked here so facility-filter tests control the scope directly rather than
// exercising scope.ts's own DB query (covered by its own unit suite).
vi.mock('@/lib/facility/scope', () => ({ resolveFacilityScope: mockResolveFacilityScope }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getDashboardData,
  duplicateCourse,
  addPrebuiltCourseToOrg,
  getPrebuiltCourses,
} from './course';

const ORG_USER_ID = 'ou-admin-1';
const ORG_ID = 'org-1';

// getDashboardData fires two enrollment.groupBy calls in the same Promise.all
// (by [courseId,status] and by [organizationUserId,status]). Route each to its
// fixture by inspecting `by` rather than call order, so the test doesn't
// depend on the source's Promise.all array position.
function wireGroupBy(courseStatusRows: unknown[], userStatusRows: unknown[]) {
  mockEnrollmentGroupBy.mockImplementation((args: { by: string[] }) => {
    if (args.by.includes('courseId')) return Promise.resolve(courseStatusRows);
    if (args.by.includes('organizationUserId')) return Promise.resolve(userStatusRows);
    throw new Error(`Unexpected groupBy args: ${JSON.stringify(args)}`);
  });
}

describe('getDashboardData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Post User/OrganizationUser split: the session carries organizationUserId
    // and organizationId directly — no separate `prisma.user` lookup.
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-1', organizationUserId: ORG_USER_ID, organizationId: ORG_ID },
    });
    mockWorkerAuth.mockResolvedValue(null);
    // Unfiltered path default — individual facility-scope tests override this.
    mockResolveFacilityScope.mockResolvedValue({ mode: 'all' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws Unauthorized when there is no admin or worker session', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getDashboardData()).rejects.toThrow('Unauthorized');
  });

  it('computes per-course counts, completion rate, coverage, grade and pass/fail from a realistic fixture', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 15, 12, 0, 0)); // May 15 2026, local noon (avoids DST/midnight edge)

    mockCourseFindMany.mockResolvedValue([
      {
        id: 'course-a',
        title: 'Course A',
        description: null,
        thumbnail: null,
        status: 'published',
        type: 'document',
        duration: 30,
        createdAt: new Date(2026, 0, 1),
        updatedAt: new Date(2026, 0, 1),
        lessons: [{ quiz: { passingScore: 70 } }],
      },
      {
        id: 'course-b',
        title: 'Course B',
        description: null,
        thumbnail: null,
        status: 'published',
        type: 'document',
        duration: 20,
        createdAt: new Date(2026, 0, 2),
        updatedAt: new Date(2026, 0, 2),
        lessons: [{ quiz: null }], // no quiz -> pass/fail threshold falls back to default 70
      },
      {
        id: 'course-c',
        title: 'Course C (no enrollments)',
        description: null,
        thumbnail: null,
        status: 'draft',
        type: 'document',
        duration: 10,
        createdAt: new Date(2026, 0, 3),
        updatedAt: new Date(2026, 0, 3),
        lessons: [],
      },
      {
        id: 'course-d',
        title: 'Course D (enrolled, unscored)',
        description: null,
        thumbnail: null,
        status: 'published',
        type: 'document',
        duration: 15,
        createdAt: new Date(2026, 0, 4),
        updatedAt: new Date(2026, 0, 4),
        lessons: [{ quiz: { passingScore: 80 } }],
      },
    ]);

    // Per-course [courseId, status] tallies backing enrollmentsCount + completionRate.
    // course-a: 4 total, 2 completed -> 50%. course-b: 2 total, 1 completed -> 50%.
    // course-d: 1 total (in_progress), 0 completed -> 0%. course-c: no rows -> 0/0%.
    wireGroupBy(
      [
        { courseId: 'course-a', status: 'completed', _count: { _all: 2 } },
        { courseId: 'course-a', status: 'in_progress', _count: { _all: 1 } },
        { courseId: 'course-a', status: 'enrolled', _count: { _all: 1 } },
        { courseId: 'course-b', status: 'completed', _count: { _all: 1 } },
        { courseId: 'course-b', status: 'failed', _count: { _all: 1 } },
        { courseId: 'course-d', status: 'in_progress', _count: { _all: 1 } },
      ],
      // Per-membership [organizationUserId, status] tallies backing training
      // coverage + totalStaffAssigned.
      // 7 distinct staff: u1,u2,u5 completed; u3,u7 in_progress; u4 enrolled (not started);
      // u6 failed (also classified "not started" by the current status mapping).
      [
        { organizationUserId: 'u1', status: 'completed', _count: { _all: 1 } },
        { organizationUserId: 'u2', status: 'completed', _count: { _all: 1 } },
        { organizationUserId: 'u3', status: 'in_progress', _count: { _all: 1 } },
        { organizationUserId: 'u4', status: 'enrolled', _count: { _all: 1 } },
        { organizationUserId: 'u5', status: 'completed', _count: { _all: 1 } },
        { organizationUserId: 'u6', status: 'failed', _count: { _all: 1 } },
        { organizationUserId: 'u7', status: 'in_progress', _count: { _all: 1 } },
      ],
    );

    // Narrow scored-enrollment projection: only rows with a non-null score.
    mockEnrollmentFindMany.mockResolvedValue([
      { courseId: 'course-a', score: 85, completedAt: new Date(2026, 2, 15) },
      { courseId: 'course-a', score: 70, completedAt: new Date(2026, 3, 10) }, // == passingScore boundary
      { courseId: 'course-b', score: 90, completedAt: new Date(2026, 3, 20) },
      { courseId: 'course-b', score: 50, completedAt: new Date(2026, 4, 1) },
    ]);

    mockOrgUserCount.mockResolvedValue(10); // total workers in the org

    const result = await getDashboardData();

    // --- per-course counts + completion rate ---
    const byId = Object.fromEntries(result.courses.map((c) => [c.id, c]));
    expect(byId['course-a'].enrollmentsCount).toBe(4);
    expect(byId['course-a'].completionRate).toBe(50);
    expect(byId['course-b'].enrollmentsCount).toBe(2);
    expect(byId['course-b'].completionRate).toBe(50);
    expect(byId['course-c'].enrollmentsCount).toBe(0);
    expect(byId['course-c'].completionRate).toBe(0);
    expect(byId['course-d'].enrollmentsCount).toBe(1);
    expect(byId['course-d'].completionRate).toBe(0);

    expect(result.stats.totalCourses).toBe(4);

    // --- overall average grade: (85 + 70 + 90 + 50) / 4 = 73.75 -> 74 ---
    expect(result.stats.averageGrade).toBe(74);

    // --- training coverage (distinct staff classified by their worst outstanding status) ---
    expect(result.stats.totalStaffAssigned).toBe(7);
    expect(result.stats.trainingCoverage).toEqual({
      completed: 30, // 3 of 10 org staff (u1, u2, u5)
      inProgress: 20, // 2 of 10 (u3, u7)
      notStarted: 50, // 5 of 10 (u4, u6 + 3 staff with zero enrollments)
      totalStaff: 7, // distinct enrolled staff, not totalOrgStaff
    });

    // --- pass/fail per course, including the score === passingScore boundary ---
    const perfByName = Object.fromEntries(result.stats.coursePerformance.map((p) => [p.name, p]));
    expect(perfByName['Course A']).toMatchObject({
      passingScore: 70,
      passCount: 2, // 85 and the boundary score of 70 both count as passes
      failCount: 0,
      score: 78, // round((85 + 70) / 2)
    });
    expect(perfByName['Course B']).toMatchObject({
      passingScore: 70, // no quiz on this course -> falls back to the default 70
      passCount: 1,
      failCount: 1,
      score: 70, // round((90 + 50) / 2)
    });
    expect(perfByName['Course D (enrolled, unscored)']).toMatchObject({
      passingScore: 80,
      passCount: 0,
      failCount: 0,
      score: 0, // no scored enrollments for this course -> average falls back to 0
    });

    // --- monthly performance: only months with scored, completed enrollments are non-zero ---
    const marchLabel = new Date(2026, 2, 1).toLocaleString('default', { month: 'short' });
    const aprilLabel = new Date(2026, 3, 1).toLocaleString('default', { month: 'short' });
    const mayLabel = new Date(2026, 4, 1).toLocaleString('default', { month: 'short' });
    const monthlyByLabel = Object.fromEntries(
      result.stats.monthlyPerformance.map((m) => [m.month, m.value]),
    );
    expect(result.stats.monthlyPerformance).toHaveLength(12);
    expect(monthlyByLabel[marchLabel]).toBe(85);
    expect(monthlyByLabel[aprilLabel]).toBe(80); // round((70 + 90) / 2)
    expect(monthlyByLabel[mayLabel]).toBe(50);
    const otherMonths = result.stats.monthlyPerformance.filter(
      (m) => ![marchLabel, aprilLabel, mayLabel].includes(m.month),
    );
    expect(otherMonths.every((m) => m.value === 0)).toBe(true);
  });

  it('returns all zeros with no divide-by-zero when there are no courses or enrollments', async () => {
    mockCourseFindMany.mockResolvedValue([]);
    wireGroupBy([], []);
    mockEnrollmentFindMany.mockResolvedValue([]);
    // No org membership in session at all — courses/enrollments queries are
    // skipped (empty via the ternaries) and the staff-count query is skipped.
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-1', organizationUserId: null, organizationId: null },
    });

    const result = await getDashboardData();

    expect(result.courses).toEqual([]);
    expect(result.stats.totalCourses).toBe(0);
    expect(result.stats.totalStaffAssigned).toBe(0);
    expect(result.stats.averageGrade).toBe(0);
    expect(result.stats.coursePerformance).toEqual([]);
    expect(result.stats.trainingCoverage).toEqual({
      completed: 0,
      inProgress: 0,
      notStarted: 0,
      totalStaff: 0,
    });
    expect(result.stats.monthlyPerformance).toHaveLength(12);
    expect(result.stats.monthlyPerformance.every((m) => m.value === 0)).toBe(true);
    // No organizationId -> the org staff-count query must be skipped entirely.
    expect(mockOrgUserCount).not.toHaveBeenCalled();
  });

  it('does NOT materialize every enrollment row (guards the F-028 perf regression)', async () => {
    mockCourseFindMany.mockResolvedValue([]);
    wireGroupBy([], []);
    mockEnrollmentFindMany.mockResolvedValue([]);
    mockOrgUserCount.mockResolvedValue(0);

    await getDashboardData();

    // Counts must be computed via two groupBy aggregations, never a full
    // `enrollments: true` materialization pulled through course.findMany.
    expect(mockEnrollmentGroupBy).toHaveBeenCalledTimes(2);
    const groupByArgs = mockEnrollmentGroupBy.mock.calls.map((call) => call[0]);
    expect(
      groupByArgs.some((args) => args.by.includes('courseId') && args.by.includes('status')),
    ).toBe(true);
    expect(
      groupByArgs.some(
        (args) => args.by.includes('organizationUserId') && args.by.includes('status'),
      ),
    ).toBe(true);

    // The course query must select specific columns, never `include: { enrollments: true }`.
    const courseCallArgs = mockCourseFindMany.mock.calls[0][0];
    expect(courseCallArgs.include).toBeUndefined();
    expect(courseCallArgs.select?.enrollments).toBeUndefined();

    // The only row-level enrollment read must be the narrow scored projection.
    expect(mockEnrollmentFindMany).toHaveBeenCalledWith({
      where: { course: { createdByOrgUserId: ORG_USER_ID }, score: { not: null } },
      select: { courseId: true, score: true, completedAt: true },
    });
  });

  describe('facility scope (requestedFacilityId)', () => {
    beforeEach(() => {
      mockCourseFindMany.mockResolvedValue([]);
      wireGroupBy([], []);
      mockEnrollmentFindMany.mockResolvedValue([]);
      mockOrgUserCount.mockResolvedValue(0);
    });

    it('re-validates the requested facility id through resolveFacilityScope rather than trusting it directly', async () => {
      mockResolveFacilityScope.mockResolvedValue({ mode: 'all' });

      await getDashboardData('some-facility-id');

      expect(mockResolveFacilityScope).toHaveBeenCalledWith(
        expect.objectContaining({ user: expect.objectContaining({ organizationId: ORG_ID }) }),
        'some-facility-id',
      );
    });

    it('narrows every enrollment-derived query to facilityId when the scope resolves to a single facility', async () => {
      mockResolveFacilityScope.mockResolvedValue({
        mode: 'single',
        facility: { id: 'fac-1', name: 'Alpha', type: null, city: null },
      });

      await getDashboardData('fac-1');

      const groupByArgs = mockEnrollmentGroupBy.mock.calls.map((call) => call[0]);
      expect(groupByArgs.every((args) => args.where.facilityId === 'fac-1')).toBe(true);
      expect(mockEnrollmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ facilityId: 'fac-1' }) }),
      );
    });

    it('narrows the total-staff coverage base to members of that facility, not the whole org', async () => {
      mockResolveFacilityScope.mockResolvedValue({
        mode: 'single',
        facility: { id: 'fac-1', name: 'Alpha', type: null, city: null },
      });

      await getDashboardData('fac-1');

      expect(mockOrgUserCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            facilities: { some: { facilityId: 'fac-1', active: true } },
          }),
        }),
      );
    });

    it('leaves every query byte-identical to the unfiltered path when the scope falls back to "all" (e.g. a foreign/unknown facility id)', async () => {
      mockResolveFacilityScope.mockResolvedValue({ mode: 'all' });

      await getDashboardData('foreign-or-unknown-id');

      const groupByArgs = mockEnrollmentGroupBy.mock.calls.map((call) => call[0]);
      expect(groupByArgs.every((args) => !('facilityId' in args.where))).toBe(true);
      expect(mockOrgUserCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ facilities: expect.anything() }),
        }),
      );
    });
  });
});

// ── duplicateCourse ──────────────────────────────────────────────────────────

describe('duplicateCourse', () => {
  function makeSession(role: string, overrides: Record<string, unknown> = {}) {
    return {
      user: {
        id: 'user-1',
        organizationId: ORG_ID,
        organizationUserId: ORG_USER_ID,
        role,
        ...overrides,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminAuth.mockResolvedValue(makeSession('owner'));
    mockWorkerAuth.mockResolvedValue(null);
    mockCourseFindFirst.mockResolvedValue({ id: 'course-1' });
    mockForkCourse.mockResolvedValue({ id: 'course-fork', title: 'Course (copy)' });
  });

  it('throws Unauthorized when there is no session', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(duplicateCourse('course-1')).rejects.toThrow('Unauthorized');
  });

  it.each(['supervisor', 'finance'])('denies role=%s — lacks course.create', async (role) => {
    mockAdminAuth.mockResolvedValue(makeSession(role));

    await expect(duplicateCourse('course-1')).rejects.toThrow('Insufficient permissions');
    expect(mockForkCourse).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin', 'hr', 'clinical_director'])(
    'allows role=%s (holds course.create)',
    async (role) => {
      mockAdminAuth.mockResolvedValue(makeSession(role));

      const result = await duplicateCourse('course-1');

      expect(result).toEqual({ id: 'course-fork', title: 'Course (copy)' });
    },
  );

  it('reports "not found" (never leaking existence) for a course outside the caller\'s org', async () => {
    mockCourseFindFirst.mockResolvedValue(null);

    await expect(duplicateCourse('foreign-course')).rejects.toThrow('Course not found');
    expect(mockForkCourse).not.toHaveBeenCalled();
  });

  it("scopes the existence check to the caller's organization via the course creator", async () => {
    await duplicateCourse('course-1');

    expect(mockCourseFindFirst).toHaveBeenCalledWith({
      where: { id: 'course-1', creator: { organizationId: ORG_ID } },
      select: { id: true },
    });
  });

  it('forks with titleStrategy "duplicate" targeting the caller\'s own membership', async () => {
    await duplicateCourse('course-1');

    expect(mockForkCourse).toHaveBeenCalledWith({
      sourceCourseId: 'course-1',
      targetOrganizationUserId: ORG_USER_ID,
      titleStrategy: 'duplicate',
    });
  });
});

// ── addPrebuiltCourseToOrg ────────────────────────────────────────────────────

describe('addPrebuiltCourseToOrg', () => {
  function makeSession(role: string, overrides: Record<string, unknown> = {}) {
    return {
      user: {
        id: 'user-1',
        organizationId: ORG_ID,
        organizationUserId: ORG_USER_ID,
        role,
        ...overrides,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminAuth.mockResolvedValue(makeSession('owner'));
    mockWorkerAuth.mockResolvedValue(null);
    mockCourseFindFirst.mockResolvedValue({ id: 'prebuilt-1' });
    mockForkCourse.mockResolvedValue({ id: 'course-fork', title: 'Prebuilt Course' });
  });

  it('throws Unauthorized when there is no session', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(addPrebuiltCourseToOrg('prebuilt-1')).rejects.toThrow('Unauthorized');
  });

  it.each(['supervisor', 'finance'])('denies role=%s — lacks course.create', async (role) => {
    mockAdminAuth.mockResolvedValue(makeSession(role));

    await expect(addPrebuiltCourseToOrg('prebuilt-1')).rejects.toThrow('Insufficient permissions');
  });

  it("rejects a course that is not isGlobal — never a path to copy another tenant's private course", async () => {
    mockCourseFindFirst.mockResolvedValue(null);

    await expect(addPrebuiltCourseToOrg('someone-elses-course')).rejects.toThrow(
      'Course not found',
    );
    expect(mockForkCourse).not.toHaveBeenCalled();
  });

  it('queries with an isGlobal:true filter, not merely an id lookup', async () => {
    await addPrebuiltCourseToOrg('prebuilt-1');

    expect(mockCourseFindFirst).toHaveBeenCalledWith({
      where: { id: 'prebuilt-1', isGlobal: true },
      select: { id: true },
    });
  });

  it('forks with titleStrategy "catalog" (keeps the source title verbatim)', async () => {
    await addPrebuiltCourseToOrg('prebuilt-1');

    expect(mockForkCourse).toHaveBeenCalledWith({
      sourceCourseId: 'prebuilt-1',
      targetOrganizationUserId: ORG_USER_ID,
      titleStrategy: 'catalog',
    });
  });
});

// ── getPrebuiltCourses ────────────────────────────────────────────────────────

describe('getPrebuiltCourses', () => {
  function makeSession(role: string, overrides: Record<string, unknown> = {}) {
    return {
      user: {
        id: 'user-1',
        organizationId: ORG_ID,
        organizationUserId: ORG_USER_ID,
        role,
        ...overrides,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminAuth.mockResolvedValue(makeSession('owner'));
    mockWorkerAuth.mockResolvedValue(null);
    mockCourseFindMany.mockResolvedValue([
      { id: 'c1', title: 'Course 1', description: null, duration: 30 },
    ]);
  });

  it('throws Unauthorized when there is no session', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getPrebuiltCourses()).rejects.toThrow('Unauthorized');
  });

  it('denies a role without course.read (defensive — every role currently holds it)', async () => {
    mockAdminAuth.mockResolvedValue(makeSession('owner'));
    // Simulate a stale/unrecognized role string.
    mockAdminAuth.mockResolvedValue(makeSession('bogus-role'));

    await expect(getPrebuiltCourses()).rejects.toThrow('Insufficient permissions');
  });

  it('queries only published, global courses with a narrow projection, ordered by title', async () => {
    await getPrebuiltCourses();

    expect(mockCourseFindMany).toHaveBeenCalledWith({
      where: { isGlobal: true, status: 'published' },
      select: { id: true, title: true, description: true, duration: true },
      orderBy: { title: 'asc' },
    });
  });

  it('returns the catalog rows as-is', async () => {
    const result = await getPrebuiltCourses();

    expect(result).toEqual([{ id: 'c1', title: 'Course 1', description: null, duration: 30 }]);
  });
});
