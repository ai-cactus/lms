/**
 * Q24 archive visibility, per SURFACE.
 *
 * Archiving retires a course for new assignment; it does not erase what someone
 * already did. That splits the course reads in two, and both halves need
 * proving:
 *
 *   • every catalogue/admin LIST — the courses page (and the search box that
 *     filters it client-side), the assign picker, the prebuilt video catalogue —
 *     must stop showing an archived course;
 *   • the learner's own entry point, `/worker/courses/[id]` → `getCourseById`,
 *     must keep showing it, because they hold an enrollment in it.
 *
 * The filter itself is a query extension on the shared client (`db/index.ts`),
 * which a unit test cannot observe through a plain `vi.fn()`. So the mocked
 * `@/lib/prisma` here runs the REAL `liveRowsOnly` over an in-memory table,
 * while the mocked `@/db/index` serves the same table UNFILTERED. Any read that
 * moves from one client to the other therefore changes this file's results —
 * which is the whole point: `getCourseById` is deliberately on the unfiltered
 * client and every list is deliberately not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockOfferingFindMany,
  mockOrgFindUnique,
  mockOrgUserCount,
  mockResolveDataFacilityIds,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockOfferingFindMany: vi.fn(),
  mockOrgFindUnique: vi.fn(),
  mockOrgUserCount: vi.fn(),
  mockResolveDataFacilityIds: vi.fn(),
}));

interface TableRow {
  id: string;
  archivedAt: Date | null;
  [key: string]: unknown;
}

/**
 * An enrollment row shaped for BOTH the dashboard's narrow projections and the
 * status tracker's nested select. Its archive state is resolved by joining
 * `courseTable` on `courseId`, exactly as the database would — so an enrollment
 * predicate that omits `course: { archivedAt: null }` sees the archived row.
 */
interface EnrollmentTableRow {
  id: string;
  courseId: string;
  organizationUserId: string;
  status: string;
  score: number | null;
  completedAt: Date | null;
  dueAt: Date | null;
  assignment: null;
  course: { title: string };
  facility: null;
  organizationUser: {
    user: { email: string; fullName: string };
    manager: null;
    facilities: never[];
  };
}

/** The operators these actions actually pass — deliberately not a general engine. */
interface EnrollmentWhereShape {
  course?: { archivedAt?: Date | null };
  score?: { not?: number | null };
  status?: { notIn?: readonly string[] };
  dueAt?: { not?: Date | null; lt?: Date; gte?: Date; lte?: Date };
}

const courseTable: TableRow[] = [];
const enrollmentTable: EnrollmentTableRow[] = [];
const filteredFindManyCalls: unknown[] = [];

/**
 * Only the predicates that decide the archive question (plus the deadline and
 * status clauses the status tracker needs to separate overdue from at-risk) are
 * simulated. The tenancy, facility and roster predicates these actions also pass
 * are proven by their own suites; re-implementing them here would test the mock.
 */
function matchesEnrollment(where: EnrollmentWhereShape | undefined, row: EnrollmentTableRow) {
  if (where?.course && 'archivedAt' in where.course) {
    const course = courseTable.find((c) => c.id === row.courseId);
    if ((course?.archivedAt ?? null) !== (where.course.archivedAt ?? null)) return false;
  }
  if (where?.score?.not === null && row.score === null) return false;
  if (where?.status?.notIn?.includes(row.status)) return false;
  const due = where?.dueAt;
  if (due) {
    if (row.dueAt === null) return false;
    if (due.lt && !(row.dueAt < due.lt)) return false;
    if (due.gte && !(row.dueAt >= due.gte)) return false;
    if (due.lte && !(row.dueAt <= due.lte)) return false;
  }
  return true;
}

vi.mock('@/lib/prisma', async () => {
  const { liveRowsOnly } =
    await vi.importActual<typeof import('@/db/archive-filter')>('@/db/archive-filter');
  const prisma = {
    organization: { findUnique: (...a: unknown[]) => mockOrgFindUnique(...a) },
    course: {
      findMany: (args: object) => {
        filteredFindManyCalls.push(args);
        const where = (liveRowsOnly(args) as { where: { archivedAt: null } }).where;
        // Only the archive predicate is simulated — the tenancy/catalogue
        // predicates these actions also pass are proven by their own suites,
        // and re-implementing them here would test the mock, not the filter.
        return Promise.resolve(courseTable.filter((row) => row.archivedAt === where.archivedAt));
      },
      // Present so a read that wrongly moves onto the filtered client is a
      // failed assertion rather than a TypeError.
      findUnique: vi.fn(),
    },
    orgCourseOffering: { findMany: (...a: unknown[]) => mockOfferingFindMany(...a) },
    organizationUser: { count: (...a: unknown[]) => mockOrgUserCount(...a) },
    enrollment: {
      findMany: ({ where }: { where?: EnrollmentWhereShape }) =>
        Promise.resolve(enrollmentTable.filter((row) => matchesEnrollment(where, row))),
      groupBy: ({
        by,
        where,
      }: {
        by: (keyof EnrollmentTableRow)[];
        where?: EnrollmentWhereShape;
      }) => {
        const buckets = new Map<string, Record<string, unknown>>();
        for (const row of enrollmentTable) {
          if (!matchesEnrollment(where, row)) continue;
          const key = JSON.stringify(by.map((field) => row[field]));
          const bucket = buckets.get(key) ?? {
            ...Object.fromEntries(by.map((field) => [field, row[field]])),
            _count: { _all: 0 },
          };
          (bucket._count as { _all: number })._all += 1;
          buckets.set(key, bucket);
        }
        return Promise.resolve([...buckets.values()]);
      },
    },
  };
  return { prisma, default: prisma };
});

vi.mock('@/db/index', () => ({
  rawPrisma: {
    course: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(courseTable.find((row) => row.id === where.id) ?? null),
      // Unfiltered on purpose: a LIST that wrongly moves onto this client then
      // returns the archived row, and the surface assertions below fail on what
      // the user would actually see rather than on a missing mock.
      findMany: () => Promise.resolve([...courseTable]),
    },
  },
}));

vi.mock('@/lib/facility/staff-where', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/staff-where')>()),
  resolveDataFacilityIds: mockResolveDataFacilityIds,
}));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('@/lib/notifications/create', () => ({ notifyOrganizationAdmins: vi.fn() }));

import { getCourses, getCourseById, getDashboardData } from './course';
import { getAssignableCourses, listGlobalVideoCatalogCourses } from './offering';
import { getStatusTrackerSummaryForOrg } from '@/lib/reminders/status-tracker';

const ORG_ID = 'org-1';
const CREATOR_USER_ID = 'user-creator';
const CREATOR_ORG_USER_ID = 'ou-creator';
const LEARNER_USER_ID = 'user-learner';

/** A course row shaped for BOTH list selects and the detail select. */
function makeCourseRow(
  id: string,
  title: string,
  archivedAt: Date | null,
  overrides: Record<string, unknown> = {},
): TableRow {
  return {
    id,
    title,
    archivedAt,
    description: null,
    thumbnail: null,
    status: 'published',
    type: 'video',
    duration: 30,
    category: null,
    previewPosterStorageUri: null,
    previewVideoStorageUri: null,
    isGlobal: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    createdByOrgUserId: CREATOR_ORG_USER_ID,
    overview: null,
    objectives: null,
    skillLevel: null,
    reviewRequired: false,
    modules: [],
    quiz: null,
    versions: [],
    approvedBy: null,
    _count: { lessons: 1 },
    lessons: [{ videoDurationSeconds: 600, quiz: { _count: { questions: 5 } } }],
    enrollments: [],
    creator: {
      userId: CREATOR_USER_ID,
      organizationId: ORG_ID,
      role: 'owner',
      user: { email: 'creator@example.com', fullName: 'Course Creator' },
    },
    ...overrides,
  };
}

function ownEnrollment() {
  return {
    id: 'enr-1',
    organizationUserId: `ou-${LEARNER_USER_ID}`,
    status: 'in_progress',
    score: null,
    progress: 80,
    organizationUser: {
      userId: LEARNER_USER_ID,
      role: 'nurse',
      user: { email: 'learner@example.com', fullName: 'Learner One' },
    },
    certificate: null,
  };
}

function setAdminSession(userId: string, role: string, organizationUserId = `ou-${userId}`) {
  mockAdminAuth.mockResolvedValue({
    user: { id: userId, role, organizationId: ORG_ID, organizationUserId },
  });
  mockWorkerAuth.mockResolvedValue(null);
}

function setWorkerSession(userId: string) {
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue({
    user: {
      id: userId,
      role: 'nurse',
      organizationId: ORG_ID,
      organizationUserId: `ou-${userId}`,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  courseTable.length = 0;
  enrollmentTable.length = 0;
  filteredFindManyCalls.length = 0;
  mockOrgFindUnique.mockResolvedValue({ subscription: { status: 'active', pausedAt: null } });
  mockResolveDataFacilityIds.mockResolvedValue(null);
  mockOfferingFindMany.mockResolvedValue([]);
  mockOrgUserCount.mockResolvedValue(0);
});

describe('an archived course disappears from every catalogue and admin surface', () => {
  beforeEach(() => {
    courseTable.push(
      makeCourseRow('live-1', 'Live Course', null),
      makeCourseRow('archived-1', 'Archived Course', new Date('2026-09-17')),
    );
    setAdminSession('user-owner', 'owner');
  });

  it('the admin courses list omits it (and with it the search box, which filters this list client-side)', async () => {
    const titles = (await getCourses()).map((course) => course.title);

    expect(titles).toContain('Live Course');
    expect(titles).not.toContain('Archived Course');
  });

  it('the assign picker omits it — it unions the same authored list with the catalogue', async () => {
    const ids = (await getAssignableCourses()).map((course) => course.id);

    expect(ids).toContain('live-1');
    expect(ids).not.toContain('archived-1');
  });

  it('the prebuilt video catalogue omits it', async () => {
    const ids = (await listGlobalVideoCatalogCourses()).map((course) => course.id);

    expect(ids).toContain('live-1');
    expect(ids).not.toContain('archived-1');
  });

  it('an offering cannot smuggle it back in: the adopted-courses join carries the archive predicate itself', async () => {
    // The extension is a query extension on Course's OWN reads and cannot reach
    // a nested traversal, so the offering read has to state the predicate.
    await getCourses();

    expect(mockOfferingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
          course: { archivedAt: null },
        }),
      }),
    );
  });

  it('every list read goes through the ARCHIVE-FILTERING client, never the raw one', async () => {
    await getCourses();

    expect(filteredFindManyCalls.length).toBeGreaterThan(0);
  });
});

describe('ISSUE-2: "View Source Document" after the source document is archived', () => {
  function withSource(archivedAt: Date | null) {
    return {
      versions: [{ documentVersion: { documentId: 'doc-1', document: { archivedAt } } }],
    };
  }

  beforeEach(() => {
    setAdminSession('user-owner', 'owner');
  });

  it('reports NO source document once that document is archived — the menu item disables itself', async () => {
    // The lineage row survives archiving by design, but the document viewer is
    // an ordinary read and 404s on an archived document. Null is the state the
    // list already renders as a disabled item.
    courseTable.push(makeCourseRow('live-1', 'Live Course', null, withSource(new Date())));

    const [course] = await getCourses();

    expect(course.sourceDocumentId).toBeNull();
  });

  it('CONTROL: a live source document still resolves, so the item stays clickable', async () => {
    courseTable.push(makeCourseRow('live-1', 'Live Course', null, withSource(null)));

    const [course] = await getCourses();

    expect(course.sourceDocumentId).toBe('doc-1');
  });
});

describe("getCourseById — the learner's entry point to an archived course", () => {
  it('ISSUE-3: an enrolled worker still opens a course that was archived under them', async () => {
    courseTable.push(
      makeCourseRow('archived-1', 'Archived Course', new Date('2026-09-17'), {
        enrollments: [ownEnrollment()],
      }),
    );
    setWorkerSession(LEARNER_USER_ID);

    await expect(getCourseById('archived-1')).resolves.toMatchObject({ id: 'archived-1' });
  });

  it('a same-org manager who is NOT enrolled is refused — archiving retires it from their surfaces', async () => {
    courseTable.push(makeCourseRow('archived-1', 'Archived Course', new Date('2026-09-17')));
    setAdminSession('user-owner', 'owner');

    await expect(getCourseById('archived-1')).rejects.toThrow('Course not found');
  });

  it('authorship buys nothing either: the creator is refused unless they are enrolled', async () => {
    courseTable.push(makeCourseRow('archived-1', 'Archived Course', new Date('2026-09-17')));
    setAdminSession(CREATOR_USER_ID, 'owner', CREATOR_ORG_USER_ID);

    await expect(getCourseById('archived-1')).rejects.toThrow('Course not found');
  });

  it('CONTROL: the same manager opens the same course while it is live', async () => {
    courseTable.push(makeCourseRow('live-1', 'Live Course', null));
    setAdminSession('user-owner', 'owner');

    await expect(getCourseById('live-1')).resolves.toMatchObject({ id: 'live-1' });
  });
});

/** An enrollment row shaped for BOTH dashboard projections and the tracker select. */
function makeEnrollmentRow(
  id: string,
  courseId: string,
  courseTitle: string,
  organizationUserId: string,
  overrides: Partial<EnrollmentTableRow> = {},
): EnrollmentTableRow {
  return {
    id,
    courseId,
    organizationUserId,
    status: 'in_progress',
    score: null,
    completedAt: null,
    dueAt: null,
    assignment: null,
    course: { title: courseTitle },
    facility: null,
    organizationUser: {
      user: {
        email: `${organizationUserId}@example.com`,
        fullName: `Worker ${organizationUserId}`,
      },
      manager: null,
      facilities: [],
    },
    ...overrides,
  };
}

/**
 * The property here is INTERNAL to one action, not cross-branch.
 * `dashboard-parity.test.ts` asserts the two dashboard actions agree with each
 * other — which they did, both being wrong in the same way: "Total Courses" is a
 * top-level Course read the query extension filters, while every
 * enrolment-derived figure reaches Course through a nested relation the
 * extension cannot touch. Archiving a course with live enrolments therefore
 * split one screen across two populations, and parity could never see it.
 */
describe('an archived course leaves the dashboard aggregates as well as the catalogue', () => {
  beforeEach(() => {
    courseTable.push(
      makeCourseRow('live-1', 'Live Course', null),
      makeCourseRow('archived-1', 'Archived Course', new Date('2026-09-17')),
    );
    enrollmentTable.push(
      makeEnrollmentRow('enr-live-1', 'live-1', 'Live Course', 'ou-w1', { score: 90 }),
      makeEnrollmentRow('enr-live-2', 'live-1', 'Live Course', 'ou-w2', { score: 90 }),
      makeEnrollmentRow('enr-arch-1', 'archived-1', 'Archived Course', 'ou-w3', { score: 10 }),
      makeEnrollmentRow('enr-arch-2', 'archived-1', 'Archived Course', 'ou-w4', { score: 10 }),
    );
    setAdminSession('user-owner', 'owner');
  });

  it('counts Total Courses and Total Staff Assigned over the SAME population', async () => {
    const { stats } = await getDashboardData(null);

    // One live course, enrolled by exactly two of the four staff. Before the fix
    // this read 1 course / 4 staff — a course-derived figure and an
    // enrolment-derived one describing different catalogues on one screen.
    expect(stats.totalCourses).toBe(1);
    expect(stats.totalStaffAssigned).toBe(2);
    expect(stats.trainingCoverage.totalStaff).toBe(2);
  });

  it('averages the grade over live courses only', async () => {
    const { stats } = await getDashboardData(null);

    // Live scores are 90, archived 10 — an unfiltered average is 50.
    expect(stats.averageGrade).toBe(90);
  });

  it('lists per-course performance for the live course only', async () => {
    const { stats } = await getDashboardData(null);

    expect(stats.coursePerformance.map((entry) => entry.name)).toEqual(['Live Course']);
  });

  it('reports the live course card with only its own enrolments', async () => {
    const { courses } = await getDashboardData(null);

    expect(courses.map((course) => course.title)).toEqual(['Live Course']);
    expect(courses[0].enrollmentsCount).toBe(2);
  });
});

describe('the Status Tracker stops naming a course the Courses page says does not exist', () => {
  const NOW = new Date('2026-09-17T12:00:00.000Z');

  beforeEach(() => {
    courseTable.push(
      makeCourseRow('live-1', 'Live Course', null),
      makeCourseRow('archived-1', 'Archived Course', new Date('2026-09-01')),
    );
    enrollmentTable.push(
      makeEnrollmentRow('enr-live-overdue', 'live-1', 'Live Course', 'ou-w1', {
        dueAt: new Date('2026-09-10T12:00:00.000Z'),
      }),
      makeEnrollmentRow('enr-arch-overdue', 'archived-1', 'Archived Course', 'ou-w2', {
        dueAt: new Date('2026-09-10T12:00:00.000Z'),
      }),
      makeEnrollmentRow('enr-live-soon', 'live-1', 'Live Course', 'ou-w3', {
        dueAt: new Date('2026-09-20T12:00:00.000Z'),
      }),
      makeEnrollmentRow('enr-arch-soon', 'archived-1', 'Archived Course', 'ou-w4', {
        dueAt: new Date('2026-09-20T12:00:00.000Z'),
      }),
    );
  });

  it('omits the archived course from the overdue rows and their count', async () => {
    const summary = await getStatusTrackerSummaryForOrg(ORG_ID, NOW);

    expect(summary.rows.map((row) => row.courseTitle)).toEqual(['Live Course']);
    expect(summary.overdueCount).toBe(1);
  });

  it('omits it from the at-risk rows too', async () => {
    const summary = await getStatusTrackerSummaryForOrg(ORG_ID, NOW);

    expect(summary.nearDeadline.rows.map((row) => row.courseTitle)).toEqual(['Live Course']);
    expect(summary.nearDeadline.count).toBe(1);
  });
});
