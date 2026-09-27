/**
 * Cross-view parity between `getDashboardData` (course.ts, the single-facility
 * view), `getGlobalDashboardData` (dashboard-facility.ts, the Global View) and
 * `getStatusTrackerSummaryForOrg` (the Status Tracker). See
 * `src/lib/dashboard/scope.ts` for the shared population and
 * `src/lib/dashboard/definitions.ts` for the shared metric definitions.
 *
 * The bug class this suite makes structurally impossible: the same organisation
 * reporting different figures on different screens. It has recurred as a
 * creator-scoped course predicate, as different staff populations (BUG-34),
 * different completion maths (BUG-33), different due-soon windows (BUG-35) and
 * facility attribution by the write-time `Enrollment.facilityId` stamp on one
 * screen and by current roster on another (BUG-36).
 *
 * Tier 1 (predicate parity) inspects EVERY captured enrolment-derived Prisma
 * call, so a newly added read that forgets the shared scope fails here.
 *
 * Tier 2 (numeric parity) runs one fixture — a transferred member (stamp A,
 * roster B), a two-facility member, admins with and without training, a
 * no-facility worker and a deactivated worker — through all three readers and
 * asserts each facility's own dashboard equals its Global row, and the Global
 * Overdue tile equals the Status Tracker, for every scope.
 *
 * Tier 3 (role parity): one organisation reports one set of aggregates to every
 * role that can ask. Facility scope may narrow; the viewer's ROLE may not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockWorkerAuth,
  mockAuth,
  mockListAccessibleFacilities,
  mockCourseFindMany,
  mockEnrollmentFindMany,
  mockOrgUserFindMany,
  mockOrgUserCount,
  mockFacilityCount,
  mockQuizFindMany,
  mockQuizAttemptFindMany,
  mockCertificateFindMany,
  mockOrgCourseOfferingFindMany,
} = vi.hoisted(() => ({
  mockWorkerAuth: vi.fn(),
  mockAuth: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
  mockCourseFindMany: vi.fn(),
  mockEnrollmentFindMany: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
  mockOrgUserCount: vi.fn(),
  mockFacilityCount: vi.fn(),
  mockQuizFindMany: vi.fn(),
  mockQuizAttemptFindMany: vi.fn(),
  mockCertificateFindMany: vi.fn(),
  mockOrgCourseOfferingFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findMany: mockCourseFindMany },
    enrollment: { findMany: mockEnrollmentFindMany },
    organizationUser: { findMany: mockOrgUserFindMany, count: mockOrgUserCount },
    facility: { count: mockFacilityCount },
    quiz: { findMany: mockQuizFindMany },
    quizAttempt: { findMany: mockQuizAttemptFindMany },
    certificate: { findMany: mockCertificateFindMany },
    // resolveDashboardScope -> listAdoptedCourseIds; empty means "nothing adopted".
    orgCourseOffering: { findMany: mockOrgCourseOfferingFindMany },
  };
  return { prisma, default: prisma };
});
// getDashboardData resolves its session admin-then-worker; getGlobalDashboardData
// uses '@/auth' directly — both import the SAME '@/auth', so one mock drives both.
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// `isOrgWideFacilityRole` stays real — only the roster-backed lookup is stubbed.
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { getDashboardData } from './course';
import { getGlobalDashboardData } from './dashboard-facility';
import { getStatusTrackerSummaryForOrg } from '@/lib/reminders/status-tracker';
import { ADMIN_ROLES, WORKER_ROLES } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';

const ORG_ID = 'org-parity-1';
const FACILITY_A = { id: 'fac-a', name: 'Alpha', type: 'clinic', city: 'Austin' };
const FACILITY_B = { id: 'fac-b', name: 'Beta', type: 'clinic', city: 'Dallas' };

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW - n * DAY);

function sessionFor(role: Role, organizationUserId = `ou-viewer-${role}`) {
  return { user: { id: `user-${role}`, role, organizationId: ORG_ID, organizationUserId } };
}

// ── Fixture ──────────────────────────────────────────────────────────────────

interface FixtureMember {
  id: string;
  role: Role;
  active: boolean;
  facilityIds: string[];
}

interface FixtureEnrollment {
  id: string;
  organizationUserId: string;
  courseId: string;
  status: string;
  dueAt: Date | null;
  /** The write-time stamp. Present to prove NOTHING reads it. */
  facilityId: string | null;
}

const MEMBERS: FixtureMember[] = [
  // Transferred: every enrolment stamped at A, rostered at B today.
  { id: 'w-moved', role: 'nurse', active: true, facilityIds: ['fac-b'] },
  { id: 'w-two', role: 'therapist_clinician', active: true, facilityIds: ['fac-a', 'fac-b'] },
  { id: 'w-a', role: 'case_manager', active: true, facilityIds: ['fac-a'] },
  { id: 'w-none', role: 'nurse', active: true, facilityIds: [] },
  { id: 'adm-trained', role: 'hr', active: true, facilityIds: ['fac-a'] },
  // An admin with no training is not staff (BUG-34).
  { id: 'adm-idle', role: 'owner', active: true, facilityIds: ['fac-a'] },
  // Departed: retained records (founder Q23) must not count.
  { id: 'w-gone', role: 'nurse', active: false, facilityIds: ['fac-a'] },
];

const ENROLLMENTS: FixtureEnrollment[] = [
  {
    id: 'e-moved',
    organizationUserId: 'w-moved',
    courseId: 'course-x',
    status: 'in_progress',
    dueAt: daysAgo(3),
    facilityId: 'fac-a',
  },
  {
    id: 'e-two-x',
    organizationUserId: 'w-two',
    courseId: 'course-x',
    status: 'attested',
    dueAt: null,
    facilityId: 'fac-a',
  },
  {
    id: 'e-two-y',
    organizationUserId: 'w-two',
    courseId: 'course-y',
    status: 'assigned',
    dueAt: daysAgo(1),
    facilityId: 'fac-a',
  },
  {
    id: 'e-a',
    organizationUserId: 'w-a',
    courseId: 'course-y',
    status: 'locked',
    dueAt: null,
    facilityId: 'fac-a',
  },
  {
    id: 'e-none',
    organizationUserId: 'w-none',
    courseId: 'course-x',
    status: 'in_progress',
    dueAt: daysAgo(2),
    facilityId: null,
  },
  {
    id: 'e-adm',
    organizationUserId: 'adm-trained',
    courseId: 'course-draft',
    status: 'in_progress',
    dueAt: null,
    facilityId: 'fac-a',
  },
  {
    id: 'e-gone',
    organizationUserId: 'w-gone',
    courseId: 'course-x',
    status: 'in_progress',
    dueAt: daysAgo(5),
    facilityId: 'fac-a',
  },
];

const ATTEMPTS = [
  // Highest wins: 60 then 88 -> 88.
  { enrollmentId: 'e-two-x', quizId: 'q-x', score: 60, completedAt: daysAgo(10) },
  { enrollmentId: 'e-two-x', quizId: 'q-x', score: 88, completedAt: daysAgo(9) },
  { enrollmentId: 'e-a', quizId: 'q-y', score: 50, completedAt: daysAgo(4) },
  { enrollmentId: 'e-moved', quizId: 'q-x', score: 72, completedAt: daysAgo(2) },
];

const CATALOG = [
  { id: 'course-x', title: 'Course X', status: 'published' },
  { id: 'course-y', title: 'Course Y', status: 'published' },
  { id: 'course-draft', title: 'Draft Course', status: 'draft' },
].map((c) => ({
  ...c,
  description: null,
  thumbnailStorageUri: null,
  previewPosterStorageUri: null,
  type: 'document',
  duration: 10,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  lessons: [],
}));

// ── A predicate-aware fake over the fixture ──────────────────────────────────
// Evaluates only the constructs the shared scope emits (member org/active pin,
// roster narrowing, the population role clause, due/status filters), so the
// numbers below come from the SAME predicates production sends to Postgres.

type Where = Record<string, unknown>;

function rosterIds(where: Where | undefined): string[] | null {
  const facilities = where?.facilities as { some: { facilityId: { in: string[] } } } | undefined;
  return facilities ? facilities.some.facilityId.in : null;
}

function memberMatches(member: FixtureMember, where: Where): boolean {
  if (where.organizationId !== ORG_ID || where.active !== member.active) return false;
  const ids = rosterIds(where);
  if (ids && !member.facilityIds.some((id) => ids.includes(id))) return false;
  if (where.OR) {
    const holdsTraining = ENROLLMENTS.some((e) => e.organizationUserId === member.id);
    return (
      WORKER_ROLES.includes(member.role) || (ADMIN_ROLES.includes(member.role) && holdsTraining)
    );
  }
  return true;
}

function enrollmentMatches(e: FixtureEnrollment, where: Where): boolean {
  const member = MEMBERS.find((m) => m.id === e.organizationUserId);
  if (!member || !memberMatches(member, where.organizationUser as Where)) return false;
  const dueAt = where.dueAt as { lt?: Date; gte?: Date; lte?: Date } | undefined;
  if (dueAt) {
    if (!e.dueAt) return false;
    if (dueAt.lt && !(e.dueAt < dueAt.lt)) return false;
    if (dueAt.gte && !(e.dueAt >= dueAt.gte)) return false;
    if (dueAt.lte && !(e.dueAt <= dueAt.lte)) return false;
  }
  const status = where.status as { notIn?: string[] } | undefined;
  if (status?.notIn?.includes(e.status)) return false;
  return true;
}

function trackerRow(e: FixtureEnrollment) {
  const member = MEMBERS.find((m) => m.id === e.organizationUserId)!;
  return {
    id: e.id,
    organizationUserId: e.organizationUserId,
    courseId: e.courseId,
    dueAt: e.dueAt,
    status: e.status,
    assignment: null,
    course: { title: e.courseId },
    organizationUser: {
      user: { email: `${member.id}@test.com`, fullName: member.id },
      manager: null,
      facilities: member.facilityIds.map((facilityId) => ({
        facilityId,
        facility: { name: facilityId, timezone: 'America/New_York' },
      })),
    },
  };
}

function wireFixture() {
  mockCourseFindMany.mockImplementation((args: { where: { status?: string } }) =>
    Promise.resolve(
      args.where.status === 'published'
        ? CATALOG.filter((c) => c.status === 'published').map((c) => ({ id: c.id }))
        : CATALOG,
    ),
  );
  mockOrgUserFindMany.mockImplementation((args: { where: Where }) =>
    Promise.resolve(
      MEMBERS.filter((m) => memberMatches(m, args.where)).map((m) => ({
        id: m.id,
        role: m.role,
        joinedAt: daysAgo(100),
        lastLoginAt: daysAgo(1),
        facilities: m.facilityIds.map((facilityId) => ({ facilityId })),
      })),
    ),
  );
  mockEnrollmentFindMany.mockImplementation(
    (args: { where: Where; select: { assignment?: unknown } }) => {
      const rows = ENROLLMENTS.filter((e) => enrollmentMatches(e, args.where));
      // The Status Tracker selects the display row; the snapshot the narrow one.
      if (args.select.assignment) return Promise.resolve(rows.map(trackerRow));
      return Promise.resolve(
        rows.map((e) => ({
          id: e.id,
          organizationUserId: e.organizationUserId,
          courseId: e.courseId,
          status: e.status,
          dueAt: e.dueAt,
          startedAt: daysAgo(20),
          accessAt: null,
          lastActivityAt: daysAgo(1),
          completedAt: e.status === 'attested' ? daysAgo(8) : null,
          retakeOf: null,
        })),
      );
    },
  );
  mockQuizAttemptFindMany.mockImplementation((args: { where: { enrollment: Where } }) => {
    const ids = new Set(
      ENROLLMENTS.filter((e) => enrollmentMatches(e, args.where.enrollment)).map((e) => e.id),
    );
    return Promise.resolve(ATTEMPTS.filter((a) => ids.has(a.enrollmentId)));
  });
  mockCertificateFindMany.mockResolvedValue([]);
  mockQuizFindMany.mockResolvedValue([
    { id: 'q-x', passingScore: 70, courseId: 'course-x', lesson: null },
    { id: 'q-y', passingScore: 80, courseId: 'course-y', lesson: null },
  ]);
  mockOrgUserCount.mockResolvedValue(0);
  mockFacilityCount.mockResolvedValue(0);
  mockOrgCourseOfferingFindMany.mockResolvedValue([]);
}

function signIn(session: ReturnType<typeof sessionFor>) {
  mockAuth.mockResolvedValue(session);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkerAuth.mockResolvedValue(null);
  mockListAccessibleFacilities.mockResolvedValue([FACILITY_A, FACILITY_B]);
  wireFixture();
});

/** Every enrolment-shaped predicate the readers sent, wherever it was nested. */
function capturedEnrollmentWheres(): Where[] {
  return [
    ...mockEnrollmentFindMany.mock.calls.map((call) => call[0].where),
    ...mockQuizAttemptFindMany.mock.calls.map((call) => call[0].where.enrollment),
    ...mockCertificateFindMany.mock.calls.map((call) => call[0].where.enrollment),
  ];
}

/** True if `key` appears anywhere in `value`, at any depth (arrays included). */
function containsKeyDeep(value: unknown, key: string): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => containsKeyDeep(entry, key));
  const record = value as Record<string, unknown>;
  if (key in record) return true;
  return Object.values(record).some((entry) => containsKeyDeep(entry, key));
}

describe('dashboard-parity — Tier 1: predicate parity', () => {
  it('pins org + active on every enrolment predicate, never the facilityId stamp, for an ORG-WIDE manager', async () => {
    signIn(sessionFor('owner'));

    await getDashboardData(null);
    await getGlobalDashboardData();
    await getStatusTrackerSummaryForOrg({ organizationId: ORG_ID, dataFacilityIds: null });

    const wheres = capturedEnrollmentWheres();
    // Sanity: an empty list would make every assertion below vacuous.
    expect(wheres.length).toBeGreaterThan(5);

    for (const where of wheres) {
      // The org pin on the MEMBER — a course predicate alone counts another
      // tenant's learners on an adopted course.
      expect(where.organizationUser).toMatchObject({ organizationId: ORG_ID, active: true });
      // Org-wide: no roster narrowing at all.
      expect(where.organizationUser).not.toHaveProperty('facilities');
      // BUG-36: the stamp is never read.
      expect(where).not.toHaveProperty('facilityId');
      // The archive predicate: the extension cannot reach a nested `course:`.
      expect(where.course).toMatchObject({ organizationId: ORG_ID, archivedAt: null });
    }

    const courseWheres = mockCourseFindMany.mock.calls.map((call) => call[0].where);
    for (const where of [...wheres, ...courseWheres]) {
      expect(containsKeyDeep(where, 'createdByOrgUserId')).toBe(false);
    }
  });

  it('narrows every enrolment predicate by the SAME current roster for a FACILITY-BOUND manager', async () => {
    signIn(sessionFor('supervisor'));

    await getDashboardData(null);
    await getGlobalDashboardData();
    await getStatusTrackerSummaryForOrg({
      organizationId: ORG_ID,
      dataFacilityIds: ['fac-a', 'fac-b'],
    });

    const roster = { some: { facilityId: { in: ['fac-a', 'fac-b'] }, active: true } };
    const wheres = capturedEnrollmentWheres();
    expect(wheres.length).toBeGreaterThan(5);
    for (const where of wheres) {
      expect(where.organizationUser).toMatchObject({
        organizationId: ORG_ID,
        active: true,
        facilities: roster,
      });
      expect(where).not.toHaveProperty('facilityId');
    }
    for (const [args] of mockOrgUserFindMany.mock.calls) {
      expect(args.where).toMatchObject({
        organizationId: ORG_ID,
        active: true,
        facilities: roster,
      });
    }
  });
});

describe('dashboard-parity — Tier 2: numeric parity', () => {
  beforeEach(() => signIn(sessionFor('owner')));

  it.each([FACILITY_A.id, FACILITY_B.id])(
    "facility %s's own dashboard equals its Global row",
    async (facilityId) => {
      const global = await getGlobalDashboardData();
      const row = global.facilitiesOverview.find((r) => r.facilityId === facilityId)!;
      const risk = global.priorityRisks.find((r) => r.facilityId === facilityId)!;
      const { stats } = await getDashboardData([facilityId]);

      expect(stats.totalAssignedLearners).toBe(row.activeLearners);
      expect(stats.totalAssignedLearners).toBe(risk.activeLearners);
      expect(stats.totalActiveCourses).toBe(row.activeCourses);
      expect(stats.averageGrade).toBe(row.averageGrade);
    },
  );

  it('counts the transferred member at their CURRENT facility (B) only', async () => {
    const atA = await getDashboardData(['fac-a']);
    const atB = await getDashboardData(['fac-b']);

    // A: w-two, w-a, adm-trained. B: w-moved, w-two.
    expect(atA.stats.totalAssignedLearners).toBe(3);
    expect(atB.stats.totalAssignedLearners).toBe(2);
    // e-moved's 72 lands at B; A's grades are e-two-x (88) and e-a (50).
    expect(atA.stats.averageGrade).toBe(69);
    expect(atB.stats.averageGrade).toBe(80);
  });

  it("per-course completion is per assignment, over the facility's roster", async () => {
    const atB = await getDashboardData(['fac-b']);
    const courseX = atB.courses.find((c) => c.id === 'course-x')!;

    // B's course-x assignments: e-moved (in progress), e-two-x (attested).
    expect(courseX.enrollmentsCount).toBe(2);
    expect(courseX.completionRate).toBe(50);
  });

  it('Global Ongoing Courses equals the organisation-wide Total Active Courses', async () => {
    const global = await getGlobalDashboardData();
    const org = await getDashboardData(null);

    // course-x and course-y; the draft course has an unfinished enrolment but
    // is not published.
    expect(global.trainingVelocity.ongoingCourses.value).toBe(2);
    expect(org.stats.totalActiveCourses).toBe(2);
    expect(global.trainingVelocity.activeLearners.value).toBe(org.stats.totalAssignedLearners);
  });

  it('counts the staff population: workers + trained admins, active only, including no-facility members', async () => {
    const global = await getGlobalDashboardData();

    // w-moved, w-two, w-a, w-none, adm-trained — not adm-idle, not w-gone.
    expect(global.enterpriseFootprint.totalStaff.value).toBe(5);
    const staff = Object.fromEntries(
      global.facilitiesOverview.map((r) => [r.facilityId, r.staffCount]),
    );
    expect(staff).toEqual({ 'fac-a': 3, 'fac-b': 2 });
  });

  it('Global Overdue equals the Status Tracker overdue count for every scope', async () => {
    const global = await getGlobalDashboardData();
    const orgTracker = await getStatusTrackerSummaryForOrg({
      organizationId: ORG_ID,
      dataFacilityIds: null,
    });

    // e-moved, e-two-y, e-none — not e-gone (departed member).
    expect(global.riskCompliance.overdueTrainings.value).toBe(3);
    expect(orgTracker.overdueCount).toBe(3);

    for (const facility of [FACILITY_A, FACILITY_B]) {
      const tracker = await getStatusTrackerSummaryForOrg({
        organizationId: ORG_ID,
        dataFacilityIds: [facility.id],
      });
      const row = global.priorityRisks.find((r) => r.facilityId === facility.id)!;
      expect(tracker.overdueCount).toBe(row.overdueTrainings);
    }
  });

  it("names the transferred member's CURRENT facility on their Status Tracker row", async () => {
    const tracker = await getStatusTrackerSummaryForOrg({
      organizationId: ORG_ID,
      dataFacilityIds: null,
    });

    expect(tracker.rows.find((r) => r.enrollmentId === 'e-moved')?.facilityName).toBe('fac-b');
  });
});

describe('dashboard-parity — Tier 3: role parity', () => {
  async function tilesFor(role: Role) {
    signIn(sessionFor(role));
    const facility = await getDashboardData(null);
    const global = await getGlobalDashboardData();
    return { facility, global };
  }

  it('reports the same aggregates to Finance and HR as to Owner — role narrows nothing', async () => {
    const owner = await tilesFor('owner');

    for (const role of ['hr', 'finance', 'clinical_director'] as const) {
      const other = await tilesFor(role);
      expect(other.facility.stats.totalActiveCourses).toBe(owner.facility.stats.totalActiveCourses);
      expect(other.facility.stats.totalAssignedLearners).toBe(
        owner.facility.stats.totalAssignedLearners,
      );
      expect(other.facility.stats.averageGrade).toBe(owner.facility.stats.averageGrade);
      expect(other.facility.stats.trainingCoverage).toEqual(owner.facility.stats.trainingCoverage);
      expect(other.global.enterpriseFootprint).toEqual(owner.global.enterpriseFootprint);
      expect(other.global.trainingVelocity).toEqual(owner.global.trainingVelocity);
      expect(other.global.riskCompliance).toEqual(owner.global.riskCompliance);
    }
  });

  // Q-01 (2026-09-23): Finance may see the aggregates precisely because they
  // carry no employee-level detail. What it is handed stays narrower.
  it('still withholds the course rows and the per-course chart from Finance', async () => {
    const owner = await tilesFor('owner');
    const finance = await tilesFor('finance');

    expect(owner.facility.courses).toHaveLength(3);
    expect(owner.facility.stats.coursePerformance).toHaveLength(3);
    expect(finance.facility.courses).toEqual([]);
    expect(finance.facility.stats.coursePerformance).toEqual([]);
  });
});
