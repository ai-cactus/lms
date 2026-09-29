import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockCourseFindMany,
  mockCourseFindFirst,
  mockCourseFindUnique,
  mockEnrollmentFindMany,
  mockListAccessibleFacilities,
  mockOrgUserFindMany,
  mockOrgCourseOfferingFindMany,
  mockRawCourseFindUnique,
  mockQuizAttemptFindMany,
  mockCertificateFindMany,
  mockQuizFindMany,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindMany: vi.fn(),
  mockCourseFindFirst: vi.fn(),
  mockCourseFindUnique: vi.fn(),
  mockEnrollmentFindMany: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
  mockOrgCourseOfferingFindMany: vi.fn(),
  mockRawCourseFindUnique: vi.fn(),
  mockQuizAttemptFindMany: vi.fn(),
  mockCertificateFindMany: vi.fn(),
  mockQuizFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: {
      findMany: mockCourseFindMany,
      findFirst: mockCourseFindFirst,
      findUnique: mockCourseFindUnique,
    },
    enrollment: { findMany: mockEnrollmentFindMany },
    // The dashboard snapshot's population read, and getCourseForOrgView's
    // roster narrowing.
    organizationUser: { findMany: mockOrgUserFindMany },
    quizAttempt: { findMany: mockQuizAttemptFindMany },
    certificate: { findMany: mockCertificateFindMany },
    quiz: { findMany: mockQuizFindMany },
    // resolveDashboardScope -> listAdoptedCourseIds; empty means "nothing
    // adopted", exercised on its own in dashboard/scope.test.ts.
    orgCourseOffering: { findMany: mockOrgCourseOfferingFindMany },
  };
  return { prisma, default: prisma };
});
// `getCourseById` reads the course row off the UN-extended client so the access
// gate — not the archive filter — decides whether an archived course is visible
// (an enrolled learner keeps theirs). The two clients get DIFFERENT spies, so a
// regression that swaps them fails loudly instead of looking equivalent.
vi.mock('@/db/index', () => ({
  rawPrisma: { course: { findUnique: (...a: unknown[]) => mockRawCourseFindUnique(...a) } },
}));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
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

import { getDashboardData, getCourseById, getCourseForOrgView } from './course';
import { ADMIN_ROLES, WORKER_ROLES, dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import type { Role } from '@/types/next-auth';
import { isOrgWideFacilityRole } from '@/lib/facility/scope';

const ORG_USER_ID = 'ou-admin-1';
const ORG_ID = 'org-1';

interface CatalogRow {
  id: string;
  title: string;
  status?: string;
  type?: string;
}

/** The catalogue row shape `getDashboardData` selects. */
function catalogCourse({ id, title, status = 'published', type = 'document' }: CatalogRow) {
  return {
    id,
    title,
    description: null,
    thumbnailStorageUri: null,
    previewPosterStorageUri: null,
    status,
    type,
    duration: 10,
    createdAt: new Date(2026, 0, 1),
    updatedAt: new Date(2026, 0, 1),
    lessons: [],
  };
}

interface SnapshotFixture {
  catalog?: ReturnType<typeof catalogCourse>[];
  members?: {
    id: string;
    role?: string;
    joinedAt?: Date;
    lastLoginAt?: Date | null;
    facilities?: { facilityId: string }[];
  }[];
  enrollments?: {
    id: string;
    organizationUserId: string;
    courseId: string;
    status: string;
    startedAt?: Date;
    accessAt?: Date | null;
    lastActivityAt?: Date | null;
    dueAt?: Date | null;
    completedAt?: Date | null;
    retakeOf?: string | null;
  }[];
  attempts?: { enrollmentId: string; quizId: string; score: number; completedAt?: Date }[];
  quizzes?: { id: string; passingScore: number; courseId: string | null }[];
}

/**
 * Wires every read the snapshot loader and the catalogue query issue. The two
 * `course.findMany` calls are told apart by the published-course filter rather
 * than call order.
 */
function wireSnapshot(fixture: SnapshotFixture = {}) {
  const catalog = fixture.catalog ?? [];
  mockCourseFindMany.mockImplementation((args: { where: { status?: string } }) =>
    Promise.resolve(
      args.where.status === 'published'
        ? catalog.filter((c) => c.status === 'published').map((c) => ({ id: c.id }))
        : catalog,
    ),
  );
  mockOrgUserFindMany.mockResolvedValue(
    (fixture.members ?? []).map((m) => ({
      role: 'nurse',
      joinedAt: new Date(2026, 0, 1),
      lastLoginAt: new Date(),
      facilities: [],
      ...m,
    })),
  );
  mockEnrollmentFindMany.mockResolvedValue(
    (fixture.enrollments ?? []).map((e) => ({
      startedAt: new Date(),
      accessAt: null,
      lastActivityAt: null,
      dueAt: null,
      completedAt: null,
      retakeOf: null,
      ...e,
    })),
  );
  mockQuizAttemptFindMany.mockResolvedValue(
    (fixture.attempts ?? []).map((a) => ({ completedAt: new Date(2026, 0, 5), ...a })),
  );
  mockCertificateFindMany.mockResolvedValue([]);
  mockQuizFindMany.mockResolvedValue((fixture.quizzes ?? []).map((q) => ({ ...q, lesson: null })));
}

describe('getDashboardData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockOrgCourseOfferingFindMany.mockResolvedValue([]);
    wireSnapshot();
  });

  it('throws Unauthorized when there is no admin or worker session', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getDashboardData()).rejects.toThrow('Unauthorized');
  });

  it('computes the founder tiles, per-course figures and per-assignment coverage from a realistic fixture', async () => {
    wireSnapshot({
      catalog: [
        catalogCourse({ id: 'course-a', title: 'Course A' }),
        catalogCourse({ id: 'course-b', title: 'Course B' }),
        catalogCourse({ id: 'course-c', title: 'Course C (draft)', status: 'draft' }),
        catalogCourse({ id: 'course-d', title: 'Course D (all finished)' }),
      ],
      members: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }, { id: 'u4' }],
      enrollments: [
        { id: 'a1', organizationUserId: 'u1', courseId: 'course-a', status: 'attested' },
        { id: 'a2', organizationUserId: 'u2', courseId: 'course-a', status: 'in_progress' },
        { id: 'a3', organizationUserId: 'u3', courseId: 'course-a', status: 'locked' },
        { id: 'b1', organizationUserId: 'u1', courseId: 'course-b', status: 'assigned' },
        { id: 'c1', organizationUserId: 'u4', courseId: 'course-c', status: 'enrolled' },
        { id: 'd1', organizationUserId: 'u4', courseId: 'course-d', status: 'completed' },
      ],
      attempts: [
        // a1: two submitted attempts on one quiz — the BEST (88) is its grade.
        { enrollmentId: 'a1', quizId: 'quiz-a', score: 60 },
        { enrollmentId: 'a1', quizId: 'quiz-a', score: 88 },
        { enrollmentId: 'a3', quizId: 'quiz-a', score: 40 },
        { enrollmentId: 'd1', quizId: 'quiz-d', score: 95 },
      ],
      quizzes: [
        { id: 'quiz-a', passingScore: 70, courseId: 'course-a' },
        { id: 'quiz-d', passingScore: 90, courseId: 'course-d' },
      ],
    });

    const result = await getDashboardData();

    // Published courses with an unfinished enrolment: A (a2, a3) and B (b1).
    // C is a draft; D is fully finished.
    expect(result.stats.totalActiveCourses).toBe(2);
    // Staff with an unfinished enrolment: u1 (b1), u2, u3, u4 (c1).
    expect(result.stats.totalAssignedLearners).toBe(4);
    // Grades: a1 = 88, a3 = 40, d1 = 95 -> round(223 / 3) = 74.
    expect(result.stats.averageGrade).toBe(74);
    expect(result.stats.catalogCourseCount).toBe(4);

    // Per ASSIGNMENT (BUG-33): a1, d1 finished; a2, a3 (locked still owes the
    // training) in progress; b1, c1 not started. 2/2/2 -> largest remainder.
    expect(result.stats.trainingCoverage).toEqual({
      completed: 34,
      inProgress: 33,
      notStarted: 33,
      totalAssignments: 6,
    });

    const byId = Object.fromEntries(result.courses.map((c) => [c.id, c]));
    expect(byId['course-a']).toMatchObject({ enrollmentsCount: 3, completionRate: 33 });
    expect(byId['course-b']).toMatchObject({ enrollmentsCount: 1, completionRate: 0 });
    expect(byId['course-d']).toMatchObject({ enrollmentsCount: 1, completionRate: 100 });

    const perf = Object.fromEntries(result.stats.coursePerformance.map((p) => [p.name, p]));
    expect(perf['Course A']).toMatchObject({
      passingScore: 70,
      passCount: 1,
      failCount: 1,
      score: 64,
    });
    expect(perf['Course B']).toMatchObject({
      passingScore: 70, // no quiz -> default bar
      passCount: 0,
      failCount: 0,
      score: 0,
    });
    expect(perf['Course D (all finished)']).toMatchObject({
      passingScore: 90,
      passCount: 1,
      failCount: 0,
    });
    expect(result.stats).not.toHaveProperty('monthlyPerformance');
  });

  it('returns all zeros with no divide-by-zero, and issues no read, when there is no organisation', async () => {
    // `role` is load-bearing: an org-less session must still get past the gate.
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-1', role: 'admin', organizationUserId: null, organizationId: null },
    });

    const result = await getDashboardData();

    expect(result.courses).toEqual([]);
    expect(result.stats).toEqual({
      totalActiveCourses: 0,
      totalAssignedLearners: 0,
      averageGrade: 0,
      catalogCourseCount: 0,
      coursePerformance: [],
      trainingCoverage: { completed: 0, inProgress: 0, notStarted: 0, totalAssignments: 0 },
    });
    expect(mockEnrollmentFindMany).not.toHaveBeenCalled();
    expect(mockOrgUserFindMany).not.toHaveBeenCalled();
  });

  // BUG-17: the dashboard and Training tables draw a video course from
  // `thumbnail` — the access-checked route URL off the FIRST lesson by order.
  it('returns the thumbnail route URL for a video course and null otherwise', async () => {
    const updatedAt = new Date('2026-09-01T00:00:00.000Z');
    const lessonUpdatedAt = new Date('2026-09-10T00:00:00.000Z');
    const row = (id: string, type: string, poster: string | null) => ({
      ...catalogCourse({ id, title: id, type }),
      updatedAt,
      lessons: [{ videoPosterStorageUri: poster, updatedAt: lessonUpdatedAt }],
    });
    mockCourseFindMany.mockResolvedValue([
      row('video-1', 'video', 'gcs://lms/system/videos/posters/1.jpg'),
      row('video-2', 'video', null),
      row('reading-1', 'text', 'gcs://lms/system/videos/posters/2.jpg'),
    ]);

    const result = await getDashboardData();

    expect(Object.fromEntries(result.courses.map((c) => [c.id, c.thumbnail]))).toEqual({
      'video-1': `/api/courses/video-1/thumbnail?v=${lessonUpdatedAt.getTime()}`,
      'video-2': null,
      'reading-1': null,
    });
    const catalogCall = mockCourseFindMany.mock.calls.find((call) => !call[0].where.status);
    expect(catalogCall?.[0].select.lessons.orderBy).toEqual({ order: 'asc' });
  });

  it('reads narrow enrolment rows through the shared population predicate — never a materialised `enrollments: true`', async () => {
    await getDashboardData();

    const catalogCall = mockCourseFindMany.mock.calls.find((call) => !call[0].where.status);
    expect(catalogCall?.[0].include).toBeUndefined();
    expect(catalogCall?.[0].select?.enrollments).toBeUndefined();

    // Org-pinned, active members only (founder Q23), live org courses only —
    // and never the `Enrollment.facilityId` stamp (BUG-36).
    expect(mockEnrollmentFindMany).toHaveBeenCalledWith({
      where: {
        organizationUser: { organizationId: ORG_ID, active: true },
        course: { organizationId: ORG_ID, archivedAt: null },
      },
      select: {
        id: true,
        organizationUserId: true,
        courseId: true,
        status: true,
        startedAt: true,
        accessAt: true,
        lastActivityAt: true,
        dueAt: true,
        completedAt: true,
        retakeOf: true,
      },
    });
    // Submitted attempts only — a draft is working state, not an attempt.
    expect(mockQuizAttemptFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ timeTaken: { not: null } }) }),
    );
  });

  describe('facility scope (requestedFacilityIds) — current roster, never the stamp', () => {
    const ROSTER = (ids: string[]) => ({
      facilities: { some: { facilityId: { in: ids }, active: true } },
    });

    it('re-validates the requested ids against the accessible set rather than trusting them', async () => {
      mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);

      await getDashboardData(['fac-1']);

      expect(mockListAccessibleFacilities).toHaveBeenCalledWith(
        expect.objectContaining({ user: expect.objectContaining({ organizationId: ORG_ID }) }),
      );
    });

    it('narrows the population and every enrolment read by current roster', async () => {
      mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }, { id: 'fac-2' }]);

      await getDashboardData(['fac-1']);

      expect(mockOrgUserFindMany.mock.calls[0][0].where).toMatchObject(ROSTER(['fac-1']));
      const enrollmentWhere = mockEnrollmentFindMany.mock.calls[0][0].where;
      expect(enrollmentWhere).not.toHaveProperty('facilityId');
      expect(enrollmentWhere.organizationUser).toMatchObject(ROSTER(['fac-1']));
    });

    it('counts a transferred member at their CURRENT facility only', async () => {
      mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-a' }, { id: 'fac-b' }]);
      wireSnapshot({
        catalog: [catalogCourse({ id: 'course-a', title: 'Course A' })],
        // Stamped at fac-a when assigned; rostered at fac-b today.
        members: [{ id: 'moved', facilities: [{ facilityId: 'fac-b' }] }],
        enrollments: [
          { id: 'e1', organizationUserId: 'moved', courseId: 'course-a', status: 'in_progress' },
        ],
      });

      const atA = await getDashboardData(['fac-a']);
      const atB = await getDashboardData(['fac-b']);

      expect(atA.stats.totalAssignedLearners).toBe(0);
      expect(atB.stats.totalAssignedLearners).toBe(1);
      expect(atB.stats.totalActiveCourses).toBe(1);
    });

    // Rewritten 2026-08-27: an inaccessible id used to widen to the whole org.
    it('narrows to NOTHING when no requested id is accessible, never back to the whole org', async () => {
      mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);

      await getDashboardData(['foreign-or-unknown-id']);

      expect(mockOrgUserFindMany.mock.calls[0][0].where).toMatchObject(ROSTER([]));
      expect(mockEnrollmentFindMany.mock.calls[0][0].where.organizationUser).toMatchObject(
        ROSTER([]),
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

      expect(mockEnrollmentFindMany.mock.calls[0][0].where.organizationUser).toMatchObject(
        ROSTER([]),
      );
    });

    it('applies no roster narrowing for an org-wide role with no requested ids', async () => {
      await getDashboardData();

      expect(mockOrgUserFindMany.mock.calls[0][0].where).not.toHaveProperty('facilities');
      expect(mockEnrollmentFindMany.mock.calls[0][0].where.organizationUser).not.toHaveProperty(
        'facilities',
      );
    });
  });

  // Population scoping — see `src/lib/dashboard/scope.ts` and `orgCourseWhere`.
  describe('population scoping (one population per organisation, cross-tenant guard)', () => {
    it('a manager sees a colleague-authored course — the reported bug', async () => {
      wireSnapshot({
        catalog: [catalogCourse({ id: 'hr-authored-course', title: "HR's course" })],
      });

      const result = await getDashboardData();

      expect(result.courses.map((c) => c.id)).toContain('hr-authored-course');
      expect(mockCourseFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_ID } }),
      );
    });

    // SUPERSEDED 2026-09-24 (BUG-01): finance reads the SAME population; what it
    // may SEE of it is withheld in the payload, not by counting fewer things.
    it('a role without course.read (finance) reads the SAME organisation-wide population, and is still handed no course rows', async () => {
      mockAdminAuth.mockResolvedValue({
        user: {
          id: 'finance-1',
          role: 'finance',
          organizationUserId: ORG_USER_ID,
          organizationId: ORG_ID,
        },
      });
      wireSnapshot({
        catalog: [catalogCourse({ id: 'hr-authored-course', title: "HR's course" })],
      });

      const result = await getDashboardData();

      expect(mockCourseFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_ID } }),
      );
      expect(result.stats.catalogCourseCount).toBe(1);
      expect(result.courses).toEqual([]);
      expect(result.stats.coursePerformance).toEqual([]);
    });

    // CROSS-TENANT GUARD: a course may be adopted by another organisation, whose
    // members could be enrolled in the same course row. A course-only predicate
    // would count them; the member pin must be on every enrolment-derived read.
    it('never reads enrolments, attempts or certificates without the organisation-member pin', async () => {
      await getDashboardData();

      const wheres = [
        mockEnrollmentFindMany.mock.calls[0][0].where,
        mockQuizAttemptFindMany.mock.calls[0][0].where.enrollment,
        mockCertificateFindMany.mock.calls[0][0].where.enrollment,
      ];
      for (const where of wheres) {
        expect(where.organizationUser).toMatchObject({ organizationId: ORG_ID, active: true });
      }
      expect(mockOrgUserFindMany.mock.calls[0][0].where).toMatchObject({
        organizationId: ORG_ID,
        active: true,
      });
    });
  });

  /**
   * The trap this pins: `getDashboardData` resolves a WORKER session as well as
   * an admin one, and the page in front of it gates on `course.read`. Re-gating
   * the action on the page's verb — or on the `enrollment.read` that names the
   * data best — would be a no-op, because `workerPermissions` grants every
   * learner role BOTH. The roles below are denied precisely BECAUSE they hold
   * those verbs: a "simplification" back to either one must turn this red.
   */
  describe('permission gate', () => {
    const WORKER_ROLES_HOLDING_THE_TEMPTING_VERBS = WORKER_ROLES.filter(
      (role) =>
        can(dbRoleToRoleKey(role), 'course.read') && can(dbRoleToRoleKey(role), 'enrollment.read'),
    );

    it('every worker role holds course.read AND enrollment.read — the reason neither can be the gate', () => {
      expect(WORKER_ROLES_HOLDING_THE_TEMPTING_VERBS).toEqual([...WORKER_ROLES]);
      expect(WORKER_ROLES_HOLDING_THE_TEMPTING_VERBS.length).toBeGreaterThanOrEqual(3);
    });

    it.each(WORKER_ROLES_HOLDING_THE_TEMPTING_VERBS)(
      '%s is refused before any query runs — despite holding course.read and enrollment.read',
      async (role) => {
        mockAdminAuth.mockResolvedValue(null);
        mockWorkerAuth.mockResolvedValue({
          user: { id: 'w-1', role, organizationUserId: 'ou-worker-1', organizationId: ORG_ID },
        });

        await expect(getDashboardData()).rejects.toThrow('Forbidden');
        expect(mockCourseFindMany).not.toHaveBeenCalled();
        expect(mockEnrollmentFindMany).not.toHaveBeenCalled();
      },
    );

    it.each([...ADMIN_ROLES])(
      '%s keeps access — the gate must not narrow the admin tier',
      async (role) => {
        mockAdminAuth.mockResolvedValue({
          user: { id: 'a-1', role, organizationUserId: ORG_USER_ID, organizationId: ORG_ID },
        });

        await expect(getDashboardData()).resolves.toBeDefined();
      },
    );
  });

  /**
   * Finance passes the action's gate on `billing.read` for the aggregates, but
   * holds nothing on Courses. The course list and the per-course chart name
   * individual courses, so they must not leave the server for it — while the
   * aggregate tiles stay identical to what a course-viewing role gets.
   */
  describe('course-identifying fields', () => {
    beforeEach(() => {
      wireSnapshot({
        catalog: [catalogCourse({ id: 'course-a', title: 'Course A' })],
        members: [{ id: 'u1' }],
        enrollments: [
          { id: 'e1', organizationUserId: 'u1', courseId: 'course-a', status: 'in_progress' },
        ],
        attempts: [{ enrollmentId: 'e1', quizId: 'quiz-a', score: 90 }],
        quizzes: [{ id: 'quiz-a', passingScore: 70, courseId: 'course-a' }],
      });
    });

    it('withholds the course list and per-course chart from Finance, keeping its aggregates', async () => {
      mockAdminAuth.mockResolvedValue({
        user: { id: 'f-1', role: 'finance', organizationUserId: 'ou-f', organizationId: ORG_ID },
      });

      const result = await getDashboardData();

      expect(result.courses).toEqual([]);
      expect(result.stats.coursePerformance).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('Course A');
      expect(result.stats.totalActiveCourses).toBe(1);
      expect(result.stats.totalAssignedLearners).toBe(1);
      expect(result.stats.averageGrade).toBe(90);
    });

    // Positive controls: a strip that fires for everyone must not pass.
    it.each(['owner', 'admin', 'hr', 'clinical_director', 'supervisor'])(
      'returns the course list and per-course chart to %s',
      async (role) => {
        mockAdminAuth.mockResolvedValue({
          user: { id: 'a-1', role, organizationUserId: ORG_USER_ID, organizationId: ORG_ID },
        });

        const result = await getDashboardData();

        expect(result.courses.map((course) => course.title)).toEqual(['Course A']);
        expect(result.stats.coursePerformance.map((row) => row.name)).toEqual(['Course A']);
      },
    );
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

  type FacilityRef = { id: string; name: string };

  function makeEnrollment(
    userId: string,
    index: number,
    facilities: { current?: FacilityRef[]; assigned?: FacilityRef | null } = {},
  ) {
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
        facilities: (facilities.current ?? []).map((facility) => ({ facility })),
      },
      facility: facilities.assigned ?? null,
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
      mockRawCourseFindUnique.mockResolvedValue(makeCourse([otherA, self, otherB]));
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
    mockRawCourseFindUnique.mockResolvedValue(makeCourse([...others, self]));
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
      mockRawCourseFindUnique.mockResolvedValue(makeCourse([otherA, self]));
      setAdminSession(selfId, role);

      const result = await getCourseById('course-1');

      expect(result.enrollments).toHaveLength(1);
      expect(result.enrollments[0].organizationUser.userId).toBe(selfId);
    },
  );

  it('a worker-category course creator (nurse) with no accessible facilities now fails closed to a SELF-ONLY roster — authorship alone no longer grants it', async () => {
    // `isCreator` still makes them "privileged" (routes into
    // narrowRosterToFacilityScope rather than the plain worker filter), but the
    // `isCreator ? course : narrow(...)` exemption removed in this fix means
    // that privilege no longer skips the facility narrowing. `nurse` is not
    // org-wide, and `mockListAccessibleFacilities` defaults to `[]` in
    // `beforeEach`, so the fail-closed branch (`dataFacilityIds.length === 0`)
    // is what now decides this case — same rule an ordinary supervisor gets.
    const otherA = makeEnrollment('staff-a', 1);
    const otherB = makeEnrollment('staff-b', 2);
    const creatorEnrollment = makeEnrollment(CREATOR_USER_ID, 3);
    mockRawCourseFindUnique.mockResolvedValue(makeCourse([otherA, creatorEnrollment, otherB]));
    setWorkerSession(CREATOR_USER_ID, 'nurse');

    const result = await getCourseById('course-1');

    expect(result.enrollments).toHaveLength(1);
    expect(result.enrollments[0].organizationUser.userId).toBe(CREATOR_USER_ID);
    const emails = result.enrollments.map((e) => e.organizationUser.user.email);
    expect(emails).not.toContain('staff-a@example.com');
    expect(emails).not.toContain('staff-b@example.com');
  });

  it.each(ROSTER_PRIVILEGED_ORG_WIDE_ROLES)(
    'an ORG-WIDE manager holding user.read (%s) who is NOT the creator still receives the full roster',
    async (role) => {
      const adminId = 'admin-viewer';
      const otherA = makeEnrollment('staff-a', 1);
      const otherB = makeEnrollment('staff-b', 2);
      const adminEnrollment = makeEnrollment(adminId, 3);
      mockRawCourseFindUnique.mockResolvedValue(makeCourse([otherA, adminEnrollment, otherB]));
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
      mockRawCourseFindUnique.mockResolvedValue(makeCourse([sameFacility, own, otherFacility]));
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

  describe('roster facility — current roster primary, assignment stamp secondary (BUG-37)', () => {
    const facA = { id: 'fac-a', name: 'Facility A' };
    const facB = { id: 'fac-b', name: 'Facility B' };
    const facC = { id: 'fac-c', name: 'Facility C' };

    it('selects the member’s ACTIVE facilities in the enrolment stamp’s pick order, beside the stamp', async () => {
      mockRawCourseFindUnique.mockResolvedValue(makeCourse([]));
      setAdminSession('owner-viewer', 'owner');

      await getCourseById('course-1');

      const { select } = mockRawCourseFindUnique.mock.calls[0][0];
      expect(select.enrollments.select.organizationUser.select.facilities).toEqual({
        where: { active: true },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        select: { facility: { select: { id: true, name: true } } },
      });
      expect(select.enrollments.select.facility).toEqual({ select: { id: true, name: true } });
    });

    it('an org-wide viewer receives a transferred member’s current AND assigned facility untouched', async () => {
      const transferred = makeEnrollment('staff-t', 1, { current: [facB], assigned: facA });
      mockRawCourseFindUnique.mockResolvedValue(makeCourse([transferred]));
      setAdminSession('owner-viewer', 'owner');

      const [row] = (await getCourseById('course-1')).enrollments;

      expect(row.organizationUser.facilities).toEqual([{ facility: facB }]);
      expect(row.facility).toEqual(facA);
    });

    it('the NEW facility’s supervisor sees the transferred member, their current facility and where they were assigned', async () => {
      const transferred = makeEnrollment('staff-t', 1, { current: [facB], assigned: facA });
      mockRawCourseFindUnique.mockResolvedValue(makeCourse([transferred]));
      mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-b' }]);
      mockOrgUserFindMany.mockResolvedValue([{ id: 'ou-staff-t' }]);
      setAdminSession('supervisor-viewer', 'supervisor');

      const [row] = (await getCourseById('course-1')).enrollments;

      expect(row.organizationUser.facilities).toEqual([{ facility: facB }]);
      expect(row.facility).toEqual(facA);
    });

    it('hides a kept member’s current facilities outside the supervisor’s scope', async () => {
      const multi = makeEnrollment('staff-m', 1, { current: [facC, facB], assigned: facC });
      mockRawCourseFindUnique.mockResolvedValue(makeCourse([multi]));
      mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-b' }]);
      mockOrgUserFindMany.mockResolvedValue([{ id: 'ou-staff-m' }]);
      setAdminSession('supervisor-viewer', 'supervisor');

      const [row] = (await getCourseById('course-1')).enrollments;

      expect(row.organizationUser.facilities).toEqual([{ facility: facB }]);
    });

    it('a member with no current facility and no stamp comes through without error', async () => {
      const unplaced = makeEnrollment('staff-u', 1);
      mockRawCourseFindUnique.mockResolvedValue(makeCourse([unplaced]));
      mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-b' }]);
      mockOrgUserFindMany.mockResolvedValue([{ id: 'ou-staff-u' }]);
      setAdminSession('supervisor-viewer', 'supervisor');

      const [row] = (await getCourseById('course-1')).enrollments;

      expect(row.organizationUser.facilities).toEqual([]);
      expect(row.facility).toBeNull();
    });
  });

  // Still correct post-fix, unlike the nurse-creator case above: `owner` is
  // org-wide, so `resolveDataFacilityIds` short-circuits to `null` before
  // `listAccessibleFacilities` is even consulted, and `narrowRosterToFacilityScope`
  // returns the roster unchanged for a `null` scope. Nothing here depended on
  // the removed `isCreator` exemption — the org-wide role alone was always
  // going to get the full roster, so removing that exemption changes nothing
  // for this case.
  it('the course creator who is also an org admin receives the full roster (org-wide role, not the removed creator exemption)', async () => {
    const otherA = makeEnrollment('staff-a', 1);
    mockRawCourseFindUnique.mockResolvedValue(makeCourse([otherA]));
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
      mockRawCourseFindUnique.mockResolvedValue(makeCourse([otherA]));
      setAdminSession('manager-viewer', role);

      const result = await getCourseById('course-1');

      expect(result.id).toBe('course-1');
    },
  );

  it('finance — a same-org manager WITHOUT course.read — is denied (team QA #9)', async () => {
    const otherA = makeEnrollment('staff-a', 1);
    mockRawCourseFindUnique.mockResolvedValue(makeCourse([otherA]));
    setAdminSession('manager-viewer', 'finance' as Role);

    await expect(getCourseById('course-1')).rejects.toThrow('Course not found');
  });

  it('a same-org WORKER who is neither creator nor enrolled is still denied (enrollment-gated)', async () => {
    const otherA = makeEnrollment('staff-a', 1);
    mockRawCourseFindUnique.mockResolvedValue(makeCourse([otherA]));
    setWorkerSession('worker-browsing', 'nurse');

    await expect(getCourseById('course-1')).rejects.toThrow('Course not found');
  });

  it('a user who is neither creator, admin, nor enrolled still gets "Course not found" (access gate unchanged)', async () => {
    const otherA = makeEnrollment('staff-a', 1);
    const otherB = makeEnrollment('staff-b', 2);
    mockRawCourseFindUnique.mockResolvedValue(makeCourse([otherA, otherB]));
    setWorkerSession('outsider-1', 'nurse');

    await expect(getCourseById('course-1')).rejects.toThrow('Course not found');
  });

  it('an admin from another org who is neither creator nor enrolled still gets "Course not found" (privilege does not widen the access gate)', async () => {
    const otherA = makeEnrollment('staff-a', 1);
    mockRawCourseFindUnique.mockResolvedValue(makeCourse([otherA]));
    setAdminSession('admin-outsider', 'owner', 'org-2');

    await expect(getCourseById('course-1')).rejects.toThrow('Course not found');
  });

  it('throws Unauthorized when there is no session at all', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getCourseById('course-1')).rejects.toThrow('Unauthorized');
  });

  it('throws "Course not found" when the course does not exist', async () => {
    mockRawCourseFindUnique.mockResolvedValue(null);
    setWorkerSession('worker-1', 'nurse');

    await expect(getCourseById('course-1')).rejects.toThrow('Course not found');
  });

  // CROSS-TENANT PII FIX: `mockRawCourseFindUnique` ignores `where`/`select` — every
  // test above proves in-memory roster narrowing, but not that the CROSS-TENANT
  // half of the fix (scoping the query itself, before another org's rows are
  // ever fetched) is actually wired up. These assert on the ARGUMENTS passed to
  // `prisma.course.findUnique`, which is the only way to prove that half exists.
  describe('cross-tenant roster query filter — argument assertions', () => {
    it("scopes enrollments.where to the caller's organizationId OR their own userId when the session has an organizationId", async () => {
      const selfId = 'worker-self-query';
      mockRawCourseFindUnique.mockResolvedValue(makeCourse([makeEnrollment(selfId, 1)]));
      setWorkerSession(selfId, 'nurse', ORG_ID);

      await getCourseById('course-1');

      expect(mockRawCourseFindUnique).toHaveBeenCalledTimes(1);
      const callArgs = mockRawCourseFindUnique.mock.calls[0][0];
      expect(callArgs.where).toEqual({ id: 'course-1' });
      expect(callArgs.select.enrollments.where).toEqual({
        organizationUser: { OR: [{ organizationId: ORG_ID, active: true }, { userId: selfId }] },
      });
    });

    it('fails closed to a self-only enrollments.where — never `organizationId: undefined`, which Prisma reads as no filter — when the session has no organizationId', async () => {
      const selfId = 'worker-no-org';
      mockRawCourseFindUnique.mockResolvedValue(makeCourse([makeEnrollment(selfId, 1)]));
      mockAdminAuth.mockResolvedValue(null);
      mockWorkerAuth.mockResolvedValue({
        user: {
          id: selfId,
          role: 'nurse',
          organizationId: undefined,
          organizationUserId: undefined,
        },
      });

      await getCourseById('course-1');

      const callArgs = mockRawCourseFindUnique.mock.calls[0][0];
      expect(callArgs.select.enrollments.where).toEqual({ organizationUser: { userId: selfId } });
      // The trap this guards against: `organizationId: undefined` is not "no
      // match", it is a key Prisma drops — silently reopening the leak.
      expect(callArgs.select.enrollments.where.organizationUser).not.toHaveProperty(
        'organizationId',
      );
    });

    it("the OR clause always carries the caller's own userId, which is what keeps `isEnrolled` true for a membership under a different org than the active session", async () => {
      const selfId = 'multi-org-worker';
      mockRawCourseFindUnique.mockResolvedValue(makeCourse([makeEnrollment(selfId, 1)]));
      // Active session org differs from wherever this user's enrollment record
      // actually hangs off — the own-userId clause (asserted above) is what a
      // real Prisma query would use to keep this row reachable regardless.
      setWorkerSession(selfId, 'nurse', 'org-active-different');

      const result = await getCourseById('course-1');

      const callArgs = mockRawCourseFindUnique.mock.calls[0][0];
      expect(callArgs.select.enrollments.where.organizationUser.OR).toContainEqual({
        userId: selfId,
      });
      // The mock ignores `where`, so this also proves the access-decision code
      // (`isEnrolled`) itself is unaffected: the caller still reaches their own
      // course and keeps their own row.
      expect(result.id).toBe('course-1');
      expect(result.enrollments).toHaveLength(1);
      expect(result.enrollments[0].organizationUser.userId).toBe(selfId);
    });

    it('a caller with no organizationId still reaches their own enrolled course — no `forbidden` throw was added by this fix', async () => {
      const selfId = 'no-org-worker';
      mockRawCourseFindUnique.mockResolvedValue(makeCourse([makeEnrollment(selfId, 1)]));
      mockAdminAuth.mockResolvedValue(null);
      mockWorkerAuth.mockResolvedValue({
        user: {
          id: selfId,
          role: 'nurse',
          organizationId: undefined,
          organizationUserId: undefined,
        },
      });

      const result = await getCourseById('course-1');

      expect(result.id).toBe('course-1');
      expect(result.enrollments).toHaveLength(1);
      expect(result.enrollments[0].organizationUser.userId).toBe(selfId);
    });
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
        facilities: [],
      },
      facility: null,
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

  // `mockCourseFindFirst` ignores `where`/`select` just like `mockCourseFindUnique`
  // does for getCourseById — this function's org scope was already correct
  // (`organizationUser: { organizationId }`), but nothing proved it at the
  // argument level. Filling the same blind spot flagged for getCourseById.
  it("scopes enrollments.where to the caller's organizationId in the query itself", async () => {
    mockCourseFindFirst.mockResolvedValue(makeGlobalCourse([]));
    setAdminSessionFor('manager-1', 'owner', ORG_ID);

    await getCourseForOrgView('course-1');

    expect(mockCourseFindFirst).toHaveBeenCalledTimes(1);
    const callArgs = mockCourseFindFirst.mock.calls[0][0];
    expect(callArgs.where).toEqual({
      id: 'course-1',
      type: 'video',
      isGlobal: true,
      status: 'published',
    });
    expect(callArgs.select.enrollments.where).toEqual({
      organizationUser: { organizationId: ORG_ID, active: true },
    });
  });
});
