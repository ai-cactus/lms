/**
 * The staff-profile assign modal showed an EMPTY Video Courses tab to any org
 * that had not already adopted a prebuilt course.
 *
 * `getCourses()` returns authored courses plus offerings the org has ALREADY
 * adopted. That is narrower than what the server accepts: `enrollUsers` assigns
 * a global published course straight from the catalogue and creates the
 * offering as part of the assignment, because video courses are owned by every
 * organisation from creation (the adoption step was removed as friction on
 * 2026-08-10). `/dashboard/courses` unioned the catalogue itself; the modal did
 * not — so a course visible on one screen could not be assigned from the other.
 * Both now share `getAssignableCourses`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockCourseFindMany,
  mockOfferingFindMany,
  mockGroupBy,
  mockOrgFindUnique,
  mockResolveSession,
  mockResolveDataFacilityIds,
} = vi.hoisted(() => ({
  mockCourseFindMany: vi.fn(),
  mockOfferingFindMany: vi.fn(),
  mockGroupBy: vi.fn(),
  mockOrgFindUnique: vi.fn(),
  mockResolveSession: vi.fn(),
  mockResolveDataFacilityIds: vi.fn(),
}));

// The real `getCourses` runs against this — an intra-module call cannot be
// spied, and exercising it for real is the truer test of the union anyway.
vi.mock('@/lib/prisma', () => {
  const prisma = {
    organization: { findUnique: mockOrgFindUnique },
    course: { findMany: mockCourseFindMany },
    orgCourseOffering: { findMany: mockOfferingFindMany },
    enrollment: { groupBy: mockGroupBy },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/facility/staff-where', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/staff-where')>()),
  resolveDataFacilityIds: mockResolveDataFacilityIds,
}));
vi.mock('@/auth', () => ({ auth: mockResolveSession }));
vi.mock('@/auth.worker', () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  // Run the cached body directly — caching is not what these assert.
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('./notifications', () => ({ notifyOrganizationAdmins: vi.fn() }));

import { getAssignableCourses } from './offering';

const ACTIVE_SUB = { subscription: { status: 'active', pausedAt: null } };

let authored: unknown[] = [];
let catalogue: unknown[] = [];
let catalogueFails = false;

/** The shape `getCourses`' own select produces, trimmed to what the union reads. */
function dbCourse(id: string, title: string) {
  return {
    id,
    title,
    description: null,
    thumbnail: null,
    status: 'published',
    type: 'video',
    createdAt: new Date('2026-01-01'),
    createdByOrgUserId: 'ou-1',
    isGlobal: false,
    versions: [],
    lessons: [],
    _count: { lessons: 0 },
  } as never;
}

/** The shape `getGlobalVideoCatalog`'s own select produces. Deliberately
 *  complete: a sparse row throws inside the mapper, and `getAssignableCourses`
 *  catches catalogue failures — so an under-built fixture would silently look
 *  like "no catalogue" instead of failing loudly. */
function catalogCourse(id: string, title: string) {
  return {
    id,
    title,
    description: null,
    category: null,
    previewPosterStorageUri: null,
    status: 'published',
    thumbnail: null,
    duration: 12,
    createdAt: new Date('2026-02-01'),
    updatedAt: new Date('2026-02-01'),
    _count: { lessons: 1 },
    lessons: [{ videoDurationSeconds: 600, quiz: { _count: { questions: 5 } } }],
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSession.mockResolvedValue({
    user: { id: 'u1', organizationId: 'org-1', organizationUserId: 'ou-1', role: 'owner' },
  });
  mockOrgFindUnique.mockResolvedValue(ACTIVE_SUB);
  mockResolveDataFacilityIds.mockResolvedValue(null);
  mockOfferingFindMany.mockResolvedValue([]);
  mockGroupBy.mockResolvedValue([]);
  authored = [dbCourse('own-1', 'Authored Course')];
  catalogue = [catalogCourse('cat-1', 'Prebuilt Video Course')];
  catalogueFails = false;

  // `prisma.course.findMany` serves both the authored list and the global
  // catalogue; they differ by predicate, which is how the real queries differ.
  mockCourseFindMany.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
    if (where?.isGlobal === true) {
      if (catalogueFails) return Promise.reject(new Error('catalog down'));
      return Promise.resolve(catalogue);
    }
    return Promise.resolve(authored);
  });
});

describe('getAssignableCourses', () => {
  it('includes global video catalogue courses the org has NOT adopted', async () => {
    const rows = await getAssignableCourses();

    expect(rows.map((c: { id: string }) => c.id)).toEqual(['own-1', 'cat-1']);
  });

  it('is the fix for the empty Video Courses tab: an org with nothing authored still gets the catalogue', async () => {
    authored = [];

    const rows = await getAssignableCourses();

    expect(rows.map((c: { id: string }) => c.id)).toEqual(['cat-1']);
  });

  it('de-dupes an adopted catalogue course, keeping the org row', async () => {
    // The org row carries this org's enrolment tallies; the catalogue row does not.
    authored = [dbCourse('cat-1', 'Adopted — org copy')];
    catalogue = [catalogCourse('cat-1', 'Catalogue copy')];

    const rows = await getAssignableCourses();

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Adopted — org copy');
  });

  it('withholds the catalogue without an active subscription, keeping authored courses', async () => {
    mockOrgFindUnique.mockResolvedValue({ subscription: { status: 'canceled', pausedAt: null } });

    const rows = await getAssignableCourses();

    expect(rows.map((c: { id: string }) => c.id)).toEqual(['own-1']);
    // The catalogue query is never issued at all for an unbilled org.
    expect(
      mockCourseFindMany.mock.calls.some(
        (args: unknown[]) =>
          (args[0] as { where?: Record<string, unknown> } | undefined)?.where?.isGlobal === true,
      ),
    ).toBe(false);
  });

  it('degrades to the org’s own courses when the catalogue lookup fails', async () => {
    // The modal must stay usable; a catalogue fault must not empty the list.
    catalogueFails = true;

    const rows = await getAssignableCourses();

    expect(rows.map((c: { id: string }) => c.id)).toEqual(['own-1']);
  });

  it('rejects an unauthenticated caller', async () => {
    mockResolveSession.mockResolvedValue(null);

    await expect(getAssignableCourses()).rejects.toThrow('Unauthorized');
  });
});
