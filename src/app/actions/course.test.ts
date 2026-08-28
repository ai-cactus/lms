import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockCourseFindMany,
  mockCourseFindFirst,
  mockCourseFindUnique,
  mockEnrollmentGroupBy,
  mockEnrollmentFindMany,
  mockOrgUserCount,
  mockForkCourse,
  mockListAccessibleFacilities,
  mockOrgUserFindMany,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindMany: vi.fn(),
  mockCourseFindFirst: vi.fn(),
  mockCourseFindUnique: vi.fn(),
  mockEnrollmentGroupBy: vi.fn(),
  mockEnrollmentFindMany: vi.fn(),
  mockOrgUserCount: vi.fn(),
  mockForkCourse: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: {
      findMany: mockCourseFindMany,
      findFirst: mockCourseFindFirst,
      findUnique: mockCourseFindUnique,
    },
    enrollment: { groupBy: mockEnrollmentGroupBy, findMany: mockEnrollmentFindMany },
    // Post refactor: total org staff is counted on OrganizationUser (scoped to
    // WORKER_ROLES), not a raw `prisma.user.count`.
    organizationUser: { count: mockOrgUserCount, findMany: mockOrgUserFindMany },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/course/fork-course', () => ({ forkCourse: mockForkCourse }));
// getDashboardData re-validates its requested ids against `listAccessibleFacilities`;
// mocked here so facility-scope tests control the accessible set directly rather
// than exercising scope.ts's own DB query (covered by its own unit suite).
// `isOrgWideFacilityRole` is kept REAL (it is a pure role-list lookup): the
// roster-narrowing tests below turn on the genuine org-wide/facility-bound
// split, and a stubbed verdict would prove nothing about it.
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getDashboardData, getCourseById, getCourseForOrgView, duplicateCourse } from './course';
import { ADMIN_ROLES, WORKER_ROLES, dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import type { Role } from '@/types/next-auth';
import { isOrgWideFacilityRole } from '@/lib/facility/scope';

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
    // `role` is load-bearing: getDashboardData resolves its own facility scope
    // from the session, and only an org-wide role gets the unfiltered shape.
    mockAdminAuth.mockResolvedValue({
      user: {
        id: 'admin-1',
        role: 'admin',
        organizationUserId: ORG_USER_ID,
        organizationId: ORG_ID,
      },
    });
    mockWorkerAuth.mockResolvedValue(null);
    mockListAccessibleFacilities.mockResolvedValue([]);
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

  describe('facility scope (requestedFacilityIds)', () => {
    beforeEach(() => {
      mockCourseFindMany.mockResolvedValue([]);
      wireGroupBy([], []);
      mockEnrollmentFindMany.mockResolvedValue([]);
      mockOrgUserCount.mockResolvedValue(0);
    });

    it('re-validates the requested ids against the accessible set rather than trusting them', async () => {
      mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);

      await getDashboardData(['fac-1']);

      expect(mockListAccessibleFacilities).toHaveBeenCalledWith(
        expect.objectContaining({ user: expect.objectContaining({ organizationId: ORG_ID }) }),
      );
    });

    it('narrows every enrollment-derived query to the requested facilities', async () => {
      mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }, { id: 'fac-2' }]);

      await getDashboardData(['fac-1']);

      const groupByArgs = mockEnrollmentGroupBy.mock.calls.map((call) => call[0]);
      expect(groupByArgs.every((args) => args.where.facilityId?.in?.[0] === 'fac-1')).toBe(true);
      expect(mockEnrollmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ facilityId: { in: ['fac-1'] } }),
        }),
      );
    });

    it('narrows the total-staff coverage base to members of those facilities, not the whole org', async () => {
      mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);

      await getDashboardData(['fac-1']);

      expect(mockOrgUserCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            facilities: { some: { facilityId: { in: ['fac-1'] }, active: true } },
          }),
        }),
      );
    });

    // Rewritten 2026-08-27: this asserted the OPPOSITE — an inaccessible id fell
    // back to `{ mode: 'all' }` and every query widened to the organisation. That
    // is the fail-open the `string[] | null` contract exists to remove.
    it('narrows to NOTHING when no requested id is accessible, never back to the whole org', async () => {
      mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);

      await getDashboardData(['foreign-or-unknown-id']);

      const groupByArgs = mockEnrollmentGroupBy.mock.calls.map((call) => call[0]);
      expect(groupByArgs.every((args) => args.where.facilityId?.in?.length === 0)).toBe(true);
      expect(mockOrgUserCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            facilities: { some: { facilityId: { in: [] }, active: true } },
          }),
        }),
      );
    });

    it('narrows a facility-bound caller with no assignments to nothing when no ids are requested', async () => {
      mockAdminAuth.mockResolvedValue({
        user: {
          id: 'supervisor-1',
          role: 'supervisor',
          organizationUserId: ORG_USER_ID,
          organizationId: ORG_ID,
        },
      });
      mockListAccessibleFacilities.mockResolvedValue([]);

      await getDashboardData();

      const groupByArgs = mockEnrollmentGroupBy.mock.calls.map((call) => call[0]);
      expect(groupByArgs.every((args) => args.where.facilityId?.in?.length === 0)).toBe(true);
    });

    it('leaves every query byte-identical to the unfiltered path for an org-wide role with no requested ids', async () => {
      await getDashboardData();

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

// The roster gate is `user.read` (the Staff Management permission), which is the
// registry's own line between a manager who may see other people's records and a
// learner who may only see their own. Partitioned from the registry so a matrix
// change surfaces here rather than silently widening PII exposure.
const ROSTER_PRIVILEGED_ROLES = ADMIN_ROLES.filter((role) =>
  can(dbRoleToRoleKey(role), 'user.read'),
);
const ROSTER_UNPRIVILEGED_ADMIN_ROLES = ADMIN_ROLES.filter(
  (role) => !can(dbRoleToRoleKey(role), 'user.read'),
);
// Holding `user.read` is no longer enough to see the whole roster: a
// facility-bound holder (supervisor) sees only their own facilities' rows, so
// the two halves are asserted separately.
const ROSTER_PRIVILEGED_ORG_WIDE_ROLES = ROSTER_PRIVILEGED_ROLES.filter(isOrgWideFacilityRole);
const ROSTER_PRIVILEGED_FACILITY_BOUND_ROLES = ROSTER_PRIVILEGED_ROLES.filter(
  (role) => !isOrgWideFacilityRole(role),
);

describe('getCourseById', () => {
  const CREATOR_USER_ID = 'creator-user-1';
  const CREATOR_ORG_USER_ID = 'ou-creator-1';

  function makeEnrollment(userId: string, index: number) {
    return {
      id: `enrollment-${userId}`,
      organizationUserId: `ou-${userId}`,
      status: 'in_progress',
      score: null,
      progress: 40,
      organizationUser: {
        userId,
        role: 'nurse',
        user: { email: `${userId}@example.com`, fullName: `Staff Member ${index}` },
      },
      certificate: null,
    };
  }

  function makeCourse(
    enrollments: ReturnType<typeof makeEnrollment>[],
    overrides: Record<string, unknown> = {},
  ) {
    return {
      id: 'course-1',
      title: 'Infection Control',
      description: null,
      type: 'document',
      duration: 30,
      status: 'published',
      updatedAt: new Date(2026, 0, 1),
      overview: null,
      objectives: null,
      skillLevel: null,
      previewVideoStorageUri: null,
      createdByOrgUserId: CREATOR_ORG_USER_ID,
      modules: [],
      quiz: null,
      lessons: [],
      enrollments,
      creator: {
        userId: CREATOR_USER_ID,
        organizationId: ORG_ID,
        user: { email: 'creator@example.com', fullName: 'Course Creator' },
      },
      ...overrides,
    };
  }

  function setAdminSession(userId: string, role: Role, organizationId = ORG_ID) {
    mockAdminAuth.mockResolvedValue({
      user: { id: userId, role, organizationId, organizationUserId: `ou-${userId}` },
    });
    mockWorkerAuth.mockResolvedValue(null);
  }

  function setWorkerSession(userId: string, role: Role, organizationId = ORG_ID) {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({
      user: { id: userId, role, organizationId, organizationUserId: `ou-${userId}` },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Facility-bound viewers default to "no accessible facility" so any test
    // that does not opt in exercises the fail-closed path.
    mockListAccessibleFacilities.mockResolvedValue([]);
    mockOrgUserFindMany.mockResolvedValue([]);
  });

  it.each(WORKER_ROLES)(
    "SECURITY REGRESSION: an enrolled worker (%s) never receives another user's enrollment row",
    async (role) => {
      const selfId = 'worker-self';
      const otherA = makeEnrollment('worker-other-a', 1);
      const otherB = makeEnrollment('worker-other-b', 2);
      const self = makeEnrollment(selfId, 3);
      mockCourseFindUnique.mockResolvedValue(makeCourse([otherA, self, otherB]));
      setWorkerSession(selfId, role);

      const result = await getCourseById('course-1');

      expect(result.enrollments).toHaveLength(1);
      expect(result.enrollments[0].organizationUser.userId).toBe(selfId);
      const leakedEmails = result.enrollments
        .filter((e) => e.organizationUser.userId !== selfId)
        .map((e) => e.organizationUser.user.email);
      expect(leakedEmails).toEqual([]);
      const emails = result.enrollments.map((e) => e.organizationUser.user.email);
      expect(emails).not.toContain('worker-other-a@example.com');
      expect(emails).not.toContain('worker-other-b@example.com');
    },
  );

  it('an enrolled worker with a large roster (20 other enrollees) still gets exactly their own 1 row', async () => {
    const selfId = 'worker-self';
    const others = Array.from({ length: 20 }, (_, i) => makeEnrollment(`other-${i}`, i));
    const self = makeEnrollment(selfId, 99);
    mockCourseFindUnique.mockResolvedValue(makeCourse([...others, self]));
    setWorkerSession(selfId, 'therapist_clinician');

    const result = await getCourseById('course-1');

    expect(result.enrollments).toHaveLength(1);
    expect(result.enrollments[0].organizationUser.userId).toBe(selfId);
  });

  it.each(ROSTER_UNPRIVILEGED_ADMIN_ROLES)(
    'an enrolled manager without user.read (%s) also receives only their own row',
    async (role) => {
      const selfId = 'manager-self';
      const otherA = makeEnrollment('staff-a', 1);
      const self = makeEnrollment(selfId, 2);
      mockCourseFindUnique.mockResolvedValue(makeCourse([otherA, self]));
      setAdminSession(selfId, role);

      const result = await getCourseById('course-1');

      expect(result.enrollments).toHaveLength(1);
      expect(result.enrollments[0].organizationUser.userId).toBe(selfId);
    },
  );

  it('the course creator (a worker-category role) receives the full roster — creator wins over role', async () => {
    const otherA = makeEnrollment('staff-a', 1);
    const otherB = makeEnrollment('staff-b', 2);
    const creatorEnrollment = makeEnrollment(CREATOR_USER_ID, 3);
    mockCourseFindUnique.mockResolvedValue(makeCourse([otherA, creatorEnrollment, otherB]));
    // Creator authenticates via the worker auth instance with a non-privileged
    // role — proves isCreator, not the permission, is what grants the roster here.
    setWorkerSession(CREATOR_USER_ID, 'nurse');

    const result = await getCourseById('course-1');

    expect(result.enrollments).toHaveLength(3);
    expect(result.enrollments.map((e) => e.organizationUser.userId).sort()).toEqual(
      ['staff-a', 'staff-b', CREATOR_USER_ID].sort(),
    );
  });

  it.each(ROSTER_PRIVILEGED_ORG_WIDE_ROLES)(
    'an ORG-WIDE manager holding user.read (%s) who is NOT the creator still receives the full roster',
    async (role) => {
      const adminId = 'admin-viewer';
      const otherA = makeEnrollment('staff-a', 1);
      const otherB = makeEnrollment('staff-b', 2);
      const adminEnrollment = makeEnrollment(adminId, 3);
      mockCourseFindUnique.mockResolvedValue(makeCourse([otherA, adminEnrollment, otherB]));
      setAdminSession(adminId, role);

      const result = await getCourseById('course-1');

      expect(result.enrollments).toHaveLength(3);
      expect(result.enrollments.map((e) => e.organizationUser.userId).sort()).toEqual(
        ['staff-a', 'staff-b', adminId].sort(),
      );
      // Full roster must include the other staff's PII — same shape the
      // pre-fix code returned to every caller.
      const emails = result.enrollments.map((e) => e.organizationUser.user.email);
      expect(emails).toContain('staff-a@example.com');
      expect(emails).toContain('staff-b@example.com');
    },
  );

  it.each(ROSTER_PRIVILEGED_FACILITY_BOUND_ROLES)(
    "a FACILITY-BOUND manager holding user.read (%s) receives only their own facilities' rows",
    async (role) => {
      const supervisorId = 'supervisor-viewer';
      const sameFacility = makeEnrollment('staff-a', 1);
      const otherFacility = makeEnrollment('staff-b', 2);
      const own = makeEnrollment(supervisorId, 3);
      mockCourseFindUnique.mockResolvedValue(makeCourse([sameFacility, own, otherFacility]));
      mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);
      mockOrgUserFindMany.mockResolvedValue([{ id: 'ou-staff-a' }]);
      setAdminSession(supervisorId, role);

      const result = await getCourseById('course-1');

      expect(result.enrollments.map((e) => e.organizationUser.userId).sort()).toEqual(
        ['staff-a', supervisorId].sort(),
      );
      const emails = result.enrollments.map((e) => e.organizationUser.user.email);
      expect(emails).not.toContain('staff-b@example.com');
    },
  );

  it('the course creator who is also an org admin receives the full roster (both privilege paths agree)', async () => {
    const otherA = makeEnrollment('staff-a', 1);
    mockCourseFindUnique.mockResolvedValue(makeCourse([otherA]));
    setAdminSession(CREATOR_USER_ID, 'owner');

    const result = await getCourseById('course-1');

    expect(result.enrollments).toHaveLength(1);
    expect(result.enrollments[0].organizationUser.userId).toBe('staff-a');
  });

  // `finance` was dropped from this list 2026-08-25: the COU-002/COU-004
  // behaviour is unchanged, but its gate is `course.read`, which Finance no
  // longer holds per team QA #9. The rule under test — a same-org manager who
  // holds course.read may open a colleague's course — still stands for the rest.
  it.each(['owner', 'admin', 'hr', 'clinical_director', 'supervisor'] as Role[])(
    'a same-org manager (%s) who is neither creator nor enrolled can open the course (COU-002/COU-004)',
    async (role) => {
      const otherA = makeEnrollment('staff-a', 1);
      mockCourseFindUnique.mockResolvedValue(makeCourse([otherA]));
      setAdminSession('manager-viewer', role);

      const result = await getCourseById('course-1');

      expect(result.id).toBe('course-1');
    },
  );

  it('finance — a same-org manager WITHOUT course.read — is denied (team QA #9)', async () => {
    const otherA = makeEnrollment('staff-a', 1);
    mockCourseFindUnique.mockResolvedValue(makeCourse([otherA]));
    setAdminSession('manager-viewer', 'finance' as Role);

    await expect(getCourseById('course-1')).rejects.toThrow('Course not found');
  });

  it('a same-org WORKER who is neither creator nor enrolled is still denied (enrollment-gated)', async () => {
    const otherA = makeEnrollment('staff-a', 1);
    mockCourseFindUnique.mockResolvedValue(makeCourse([otherA]));
    setWorkerSession('worker-browsing', 'nurse');

    await expect(getCourseById('course-1')).rejects.toThrow('Course not found');
  });

  it('a user who is neither creator, admin, nor enrolled still gets "Course not found" (access gate unchanged)', async () => {
    const otherA = makeEnrollment('staff-a', 1);
    const otherB = makeEnrollment('staff-b', 2);
    mockCourseFindUnique.mockResolvedValue(makeCourse([otherA, otherB]));
    setWorkerSession('outsider-1', 'nurse');

    await expect(getCourseById('course-1')).rejects.toThrow('Course not found');
  });

  it('an admin from another org who is neither creator nor enrolled still gets "Course not found" (privilege does not widen the access gate)', async () => {
    const otherA = makeEnrollment('staff-a', 1);
    mockCourseFindUnique.mockResolvedValue(makeCourse([otherA]));
    setAdminSession('admin-outsider', 'owner', 'org-2');

    await expect(getCourseById('course-1')).rejects.toThrow('Course not found');
  });

  it('throws Unauthorized when there is no session at all', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getCourseById('course-1')).rejects.toThrow('Unauthorized');
  });

  it('throws "Course not found" when the course does not exist', async () => {
    mockCourseFindUnique.mockResolvedValue(null);
    setWorkerSession('worker-1', 'nurse');

    await expect(getCourseById('course-1')).rejects.toThrow('Course not found');
  });
});

// THE PII LEAK (item 10 of the facility-scope PR): getCourseForOrgView had NO
// role gate at all — any authenticated org member, worker included, could call
// it directly and read every enrollee's name, email, role and score. These
// tests assert on the ROSTER CONTENTS returned, not merely on whether the call
// throws — a test that only checks "didn't throw" would have passed against
// the leaky version too.
describe('getCourseForOrgView', () => {
  function orgEnrollment(userId: string, index: number) {
    return {
      id: `enrollment-${userId}`,
      organizationUserId: `ou-${userId}`,
      status: 'in_progress',
      score: null,
      progress: 40,
      organizationUser: {
        userId,
        organizationId: ORG_ID,
        role: 'nurse',
        user: { email: `${userId}@example.com`, fullName: `Staff Member ${index}` },
      },
      certificate: null,
    };
  }

  function makeGlobalCourse(enrollments: ReturnType<typeof orgEnrollment>[]) {
    return {
      id: 'course-1',
      title: 'Bloodborne Pathogens',
      type: 'video',
      isGlobal: true,
      status: 'published',
      modules: [],
      lessons: [],
      quiz: null,
      creator: null,
      enrollments,
    };
  }

  function setAdminSessionFor(userId: string, role: Role, organizationId = ORG_ID) {
    mockAdminAuth.mockResolvedValue({
      user: { id: userId, role, organizationId, organizationUserId: `ou-${userId}` },
    });
    mockWorkerAuth.mockResolvedValue(null);
  }

  function setWorkerSessionFor(userId: string, role: Role, organizationId = ORG_ID) {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({
      user: { id: userId, role, organizationId, organizationUserId: `ou-${userId}` },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockListAccessibleFacilities.mockResolvedValue([]);
    mockOrgUserFindMany.mockResolvedValue([]);
  });

  it.each(WORKER_ROLES)(
    'SECURITY FIX: a worker (%s) is refused before any course query runs — no roster PII reaches them',
    async (role) => {
      setWorkerSessionFor('worker-1', role);

      await expect(getCourseForOrgView('course-1')).rejects.toThrow('Course not found');
      expect(mockCourseFindFirst).not.toHaveBeenCalled();
    },
  );

  it('SECURITY FIX: finance (isAdminRole but no course.read post-2026-08-25) is refused before any query runs', async () => {
    setAdminSessionFor('finance-1', 'finance' as Role);

    await expect(getCourseForOrgView('course-1')).rejects.toThrow('Course not found');
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin', 'hr'] as Role[])(
    "an ORG-WIDE manager (%s) gets the full, unnarrowed roster — including every enrollee's PII",
    async (role) => {
      const staffA = orgEnrollment('staff-a', 1);
      const staffB = orgEnrollment('staff-b', 2);
      mockCourseFindFirst.mockResolvedValue(makeGlobalCourse([staffA, staffB]));
      setAdminSessionFor('manager-1', role);

      const result = await getCourseForOrgView('course-1');

      expect(result.enrollments.map((e) => e.organizationUser.userId).sort()).toEqual(
        ['staff-a', 'staff-b'].sort(),
      );
      const emails = result.enrollments.map((e) => e.organizationUser.user.email);
      expect(emails).toContain('staff-a@example.com');
      expect(emails).toContain('staff-b@example.com');
      // Org-wide roles never trigger the facility-narrowing query at all.
      expect(mockOrgUserFindMany).not.toHaveBeenCalled();
    },
  );

  it("a FACILITY-BOUND manager (supervisor) receives only their own facilities' roster rows — the roster is narrowed, not just the status", async () => {
    const supervisorId = 'supervisor-viewer';
    const sameFacility = orgEnrollment('staff-a', 1);
    const otherFacility = orgEnrollment('staff-b', 2);
    const own = orgEnrollment(supervisorId, 3);
    mockCourseFindFirst.mockResolvedValue(makeGlobalCourse([sameFacility, own, otherFacility]));
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);
    mockOrgUserFindMany.mockResolvedValue([{ id: 'ou-staff-a' }]);
    setAdminSessionFor(supervisorId, 'supervisor');

    const result = await getCourseForOrgView('course-1');

    expect(result.enrollments.map((e) => e.organizationUser.userId).sort()).toEqual(
      ['staff-a', supervisorId].sort(),
    );
    const emails = result.enrollments.map((e) => e.organizationUser.user.email);
    expect(emails).not.toContain('staff-b@example.com');
    expect(emails).toContain('staff-a@example.com');
  });

  it('KNOWN BEHAVIOUR CHANGE (pinned, not a bug): clinical director holds course.read but not user.read, so gets a self-only roster', async () => {
    const staffA = orgEnrollment('staff-a', 1);
    const selfId = 'cd-viewer';
    const own = orgEnrollment(selfId, 2);
    mockCourseFindFirst.mockResolvedValue(makeGlobalCourse([staffA, own]));
    setAdminSessionFor(selfId, 'clinical_director');

    const result = await getCourseForOrgView('course-1');

    expect(result.enrollments).toHaveLength(1);
    expect(result.enrollments[0].organizationUser.userId).toBe(selfId);
    const emails = result.enrollments.map((e) => e.organizationUser.user.email);
    expect(emails).not.toContain('staff-a@example.com');
  });

  it('FAIL-CLOSED: a facility-bound manager with NO accessible facilities gets an empty roster (own enrollment aside), never the full one', async () => {
    const staffA = orgEnrollment('staff-a', 1);
    mockCourseFindFirst.mockResolvedValue(makeGlobalCourse([staffA]));
    mockListAccessibleFacilities.mockResolvedValue([]);
    setAdminSessionFor('supervisor-empty', 'supervisor');

    const result = await getCourseForOrgView('course-1');

    expect(result.enrollments).toHaveLength(0);
  });

  it('throws Unauthorized before any query when there is no session at all', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getCourseForOrgView('course-1')).rejects.toThrow('Unauthorized');
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
  });

  it('throws "Course not found" (same message as forbidden) when the global course does not exist', async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    setAdminSessionFor('admin-1', 'owner');

    await expect(getCourseForOrgView('course-1')).rejects.toThrow('Course not found');
  });
});
