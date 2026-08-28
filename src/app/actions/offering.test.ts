import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports so vi.mock factories
// can close over them (Vitest hoists vi.mock() calls above import statements).
// ---------------------------------------------------------------------------
const {
  mockAdminAuth,
  mockWorkerAuth,
  mockRevalidate,
  mockOrgCourseOfferingFindUnique,
  mockOrgCourseOfferingUpsert,
  mockOrgCourseOfferingUpdate,
  mockOrgCourseOfferingDelete,
  mockOrgCourseOfferingFindMany,
  mockCourseFindMany,
  mockCourseFindFirst,
} = vi.hoisted(() => {
  const mockAdminAuth = vi.fn();
  const mockWorkerAuth = vi.fn();
  const mockRevalidate = vi.fn();
  const mockOrgCourseOfferingFindUnique = vi.fn();
  const mockOrgCourseOfferingUpsert = vi.fn();
  const mockOrgCourseOfferingUpdate = vi.fn();
  const mockOrgCourseOfferingDelete = vi.fn();
  const mockOrgCourseOfferingFindMany = vi.fn();
  const mockCourseFindMany = vi.fn();
  const mockCourseFindFirst = vi.fn();

  return {
    mockAdminAuth,
    mockWorkerAuth,
    mockRevalidate,
    mockOrgCourseOfferingFindUnique,
    mockOrgCourseOfferingUpsert,
    mockOrgCourseOfferingUpdate,
    mockOrgCourseOfferingDelete,
    mockOrgCourseOfferingFindMany,
    mockCourseFindMany,
    mockCourseFindFirst,
  };
});

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findMany: mockCourseFindMany, findFirst: mockCourseFindFirst },
    orgCourseOffering: {
      findUnique: mockOrgCourseOfferingFindUnique,
      upsert: mockOrgCourseOfferingUpsert,
      update: mockOrgCourseOfferingUpdate,
      delete: mockOrgCourseOfferingDelete,
      findMany: mockOrgCourseOfferingFindMany,
    },
  };
  return { prisma, default: prisma };
});

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
// unstable_cache is a passthrough so a cached fetcher re-runs against the
// current mock on every call rather than hitting Next's real cache store.
// Nothing in this file exercises getGlobalVideoCatalog any more: the tests
// that pinned its query shape/mapping went with listAvailableVideoCourses,
// and its surviving caller (listGlobalVideoCatalogCourses) has no unit test
// here — the Courses page test mocks it out wholesale.
vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidate,
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

import { offerCourseToOrg, updateOffering, withdrawOffering } from './offering';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = 'user-admin-1';
const ORG_ID = 'org-1';

function setupAdminSession() {
  // resolveOrg() reads organizationId/role directly off the session — no DB
  // lookup — so the JWT session itself must carry them (post multi-org split,
  // these are resolved into the session at login from the active OrganizationUser).
  mockAdminAuth.mockResolvedValue({
    user: {
      id: ADMIN_USER_ID,
      organizationId: ORG_ID,
      organizationUserId: 'ou-admin-1',
      role: 'owner',
    },
  });
  mockWorkerAuth.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue(null);
  mockOrgCourseOfferingFindMany.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// offerCourseToOrg
// ---------------------------------------------------------------------------

describe('offerCourseToOrg', () => {
  it('calls orgCourseOffering.upsert with correct where and create args', async () => {
    setupAdminSession();
    mockCourseFindFirst.mockResolvedValue({ id: 'c1' });
    const fakeOffering = {
      id: 'off-new',
      organizationId: ORG_ID,
      courseId: 'c1',
      addedByAdminId: ADMIN_USER_ID,
    };
    mockOrgCourseOfferingUpsert.mockResolvedValue(fakeOffering);

    const result = await offerCourseToOrg('c1');

    expect(mockOrgCourseOfferingUpsert).toHaveBeenCalledOnce();
    const arg = mockOrgCourseOfferingUpsert.mock.calls[0][0];

    expect(arg.where.organizationId_courseId).toEqual({
      organizationId: ORG_ID,
      courseId: 'c1',
    });
    expect(arg.create).toMatchObject({
      organizationId: ORG_ID,
      courseId: 'c1',
      addedByAdminId: ADMIN_USER_ID,
    });
    expect(result).toEqual(fakeOffering);
  });

  it('merges overrides into create and update args', async () => {
    setupAdminSession();
    mockCourseFindFirst.mockResolvedValue({ id: 'c2' });
    mockOrgCourseOfferingUpsert.mockResolvedValue({ id: 'off-2' });

    await offerCourseToOrg('c2', {
      customTitle: 'Custom',
      customDescription: 'Desc',
      customIntro: 'Intro',
    });

    const arg = mockOrgCourseOfferingUpsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({
      customTitle: 'Custom',
      customDescription: 'Desc',
      customIntro: 'Intro',
    });
    expect(arg.update).toMatchObject({
      customTitle: 'Custom',
      customDescription: 'Desc',
      customIntro: 'Intro',
    });
  });

  it('calls revalidatePath for dashboard routes', async () => {
    setupAdminSession();
    mockCourseFindFirst.mockResolvedValue({ id: 'c3' });
    mockOrgCourseOfferingUpsert.mockResolvedValue({ id: 'off-3' });

    await offerCourseToOrg('c3');

    expect(mockRevalidate).toHaveBeenCalledWith('/dashboard/courses');
    expect(mockRevalidate).toHaveBeenCalledWith('/dashboard');
  });

  it('throws Forbidden when caller has worker role', async () => {
    mockAdminAuth.mockResolvedValue({
      user: {
        id: ADMIN_USER_ID,
        organizationId: ORG_ID,
        organizationUserId: 'ou-worker-1',
        role: 'nurse',
      },
    });
    mockWorkerAuth.mockResolvedValue(null);

    await expect(offerCourseToOrg('c1')).rejects.toThrow('Forbidden');
    expect(mockOrgCourseOfferingUpsert).not.toHaveBeenCalled();
  });

  it('throws Course not found when courseId is not a global published video course', async () => {
    setupAdminSession();
    mockCourseFindFirst.mockResolvedValue(null);

    await expect(offerCourseToOrg('bad-course-id')).rejects.toThrow('Course not found');
    expect(mockOrgCourseOfferingUpsert).not.toHaveBeenCalled();
  });

  it('throws Unauthorized when no session', async () => {
    await expect(offerCourseToOrg('c1')).rejects.toThrow('Unauthorized');
  });
});

// ---------------------------------------------------------------------------
// updateOffering
// ---------------------------------------------------------------------------

describe('updateOffering', () => {
  it('updates the offering when it belongs to the caller org', async () => {
    setupAdminSession();
    const existing = { id: 'off-1', organizationId: ORG_ID };
    mockOrgCourseOfferingFindUnique.mockResolvedValue(existing);
    mockOrgCourseOfferingUpdate.mockResolvedValue({ ...existing, customTitle: 'New' });

    const result = await updateOffering('off-1', { customTitle: 'New' });

    expect(mockOrgCourseOfferingUpdate).toHaveBeenCalledOnce();
    const arg = mockOrgCourseOfferingUpdate.mock.calls[0][0];
    expect(arg.where.id).toBe('off-1');
    expect(arg.data).toMatchObject({ customTitle: 'New' });
    expect(result).toMatchObject({ customTitle: 'New' });
  });

  it('throws Forbidden when offering belongs to a different org', async () => {
    setupAdminSession();
    mockOrgCourseOfferingFindUnique.mockResolvedValue({
      id: 'off-other',
      organizationId: 'org-different',
    });

    await expect(updateOffering('off-other', { customTitle: 'x' })).rejects.toThrow('Forbidden');
    expect(mockOrgCourseOfferingUpdate).not.toHaveBeenCalled();
  });

  it('throws Unauthorized when no session', async () => {
    await expect(updateOffering('off-1', {})).rejects.toThrow('Unauthorized');
  });
});

// ---------------------------------------------------------------------------
// withdrawOffering
// ---------------------------------------------------------------------------

describe('withdrawOffering', () => {
  it('deletes the offering when it belongs to the caller org', async () => {
    setupAdminSession();
    mockOrgCourseOfferingFindUnique.mockResolvedValue({
      id: 'o1',
      organizationId: ORG_ID,
    });
    mockOrgCourseOfferingDelete.mockResolvedValue({ id: 'o1' });

    await withdrawOffering('o1');

    expect(mockOrgCourseOfferingDelete).toHaveBeenCalledOnce();
    expect(mockOrgCourseOfferingDelete.mock.calls[0][0].where.id).toBe('o1');
  });

  it('throws Forbidden when offering belongs to a different org', async () => {
    setupAdminSession();
    mockOrgCourseOfferingFindUnique.mockResolvedValue({
      id: 'o1',
      organizationId: 'org-evil',
    });

    await expect(withdrawOffering('o1')).rejects.toThrow('Forbidden');
    expect(mockOrgCourseOfferingDelete).not.toHaveBeenCalled();
  });

  it('throws Forbidden when caller has worker role', async () => {
    mockAdminAuth.mockResolvedValue({
      user: {
        id: ADMIN_USER_ID,
        organizationId: ORG_ID,
        organizationUserId: 'ou-worker-1',
        role: 'nurse',
      },
    });
    mockWorkerAuth.mockResolvedValue(null);

    await expect(withdrawOffering('o1')).rejects.toThrow('Forbidden');
    expect(mockOrgCourseOfferingDelete).not.toHaveBeenCalled();
  });

  it('throws Unauthorized when no session', async () => {
    await expect(withdrawOffering('o1')).rejects.toThrow('Unauthorized');
  });

  it('calls revalidatePath after deleting', async () => {
    setupAdminSession();
    mockOrgCourseOfferingFindUnique.mockResolvedValue({ id: 'o2', organizationId: ORG_ID });
    mockOrgCourseOfferingDelete.mockResolvedValue({ id: 'o2' });

    await withdrawOffering('o2');

    expect(mockRevalidate).toHaveBeenCalledWith('/dashboard/courses');
    expect(mockRevalidate).toHaveBeenCalledWith('/dashboard');
  });
});
