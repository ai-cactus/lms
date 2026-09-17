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
  mockGroupBy,
  mockOrgFindUnique,
  mockResolveDataFacilityIds,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockOfferingFindMany: vi.fn(),
  mockGroupBy: vi.fn(),
  mockOrgFindUnique: vi.fn(),
  mockResolveDataFacilityIds: vi.fn(),
}));

interface TableRow {
  id: string;
  archivedAt: Date | null;
  [key: string]: unknown;
}

const courseTable: TableRow[] = [];
const filteredFindManyCalls: unknown[] = [];

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
    enrollment: { groupBy: (...a: unknown[]) => mockGroupBy(...a) },
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
vi.mock('./notifications', () => ({ notifyOrganizationAdmins: vi.fn() }));

import { getCourses, getCourseById } from './course';
import { getAssignableCourses, listGlobalVideoCatalogCourses } from './offering';

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
  filteredFindManyCalls.length = 0;
  mockOrgFindUnique.mockResolvedValue({ subscription: { status: 'active', pausedAt: null } });
  mockResolveDataFacilityIds.mockResolvedValue(null);
  mockOfferingFindMany.mockResolvedValue([]);
  mockGroupBy.mockResolvedValue([]);
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
