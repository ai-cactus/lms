import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockWorkerAuth,
  mockCourseFindMany,
  mockOfferingFindMany,
  mockEnrollmentGroupBy,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindMany: vi.fn(),
  mockOfferingFindMany: vi.fn(),
  mockEnrollmentGroupBy: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findMany: mockCourseFindMany },
    orgCourseOffering: { findMany: mockOfferingFindMany },
    enrollment: { groupBy: mockEnrollmentGroupBy },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));

import { getCourses } from './course';

beforeEach(() => {
  vi.clearAllMocks();
  // Post User/OrganizationUser split: the session itself carries the active
  // membership id and org id directly — there is no separate `prisma.user`
  // lookup to enrich the session with org context.
  mockAuth.mockResolvedValue({
    user: { id: 'admin-1', organizationUserId: 'ou-admin-1', organizationId: 'org-1' },
  });
  mockWorkerAuth.mockResolvedValue(null);
  mockEnrollmentGroupBy.mockResolvedValue([]);
});

describe('getCourses', () => {
  it('includes adopted offered video courses alongside own courses', async () => {
    mockCourseFindMany.mockResolvedValue([
      {
        id: 'own-1',
        title: 'Own Course',
        description: null,
        thumbnail: null,
        status: 'published',
        type: 'document',
        duration: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { lessons: 0 },
      },
    ]);
    mockOfferingFindMany.mockResolvedValue([
      {
        course: {
          id: 'global-1',
          title: 'Adopted Video',
          description: null,
          thumbnail: null,
          status: 'published',
          type: 'video',
          duration: 30,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { lessons: 1 },
          versions: [],
          // Cross-tenant publisher: lineage must resolve to null for this org.
          creator: { organizationId: 'other-org' },
        },
      },
    ]);
    // Own course has no enrollments; the adopted course has one completed one.
    mockEnrollmentGroupBy.mockImplementation(({ where }) =>
      Promise.resolve(
        'courseId' in where
          ? [{ courseId: 'global-1', status: 'completed', _count: { _all: 1 } }]
          : [],
      ),
    );

    const result = await getCourses();
    const ids = result.map((c) => c.id);
    expect(ids).toContain('own-1');
    expect(ids).toContain('global-1');

    const adopted = result.find((c) => c.id === 'global-1');
    expect(adopted?.enrollmentsCount).toBe(1);
    expect(adopted?.completionRate).toBe(100);
    expect(adopted?.lessonsCount).toBe(1);
  });
});

/**
 * Team QA #15 / C1 — "Any course created is global, so should be viewable by
 * any manager + supervisor with access to courses."
 *
 * getCourses was creator-scoped, so an HR-authored course was invisible to the
 * Owner. getCourseById had already been fixed for exactly this (COU-002/COU-004);
 * the list never received the matching change.
 *
 * Asserted on the Prisma `where` the action builds, because the scope decision
 * lives in the query.
 */
describe('getCourses — org-manager visibility (#15)', () => {
  const sessionFor = (role?: string) => ({
    user: {
      id: 'u-1',
      role,
      organizationUserId: 'ou-1',
      organizationId: 'org-1',
    },
  });

  beforeEach(() => {
    mockCourseFindMany.mockResolvedValue([]);
    mockOfferingFindMany.mockResolvedValue([]);
    mockEnrollmentGroupBy.mockResolvedValue([]);
    mockWorkerAuth.mockResolvedValue(null);
  });

  it.each(['owner', 'admin', 'hr', 'clinical_director', 'supervisor'])(
    '%s sees every course authored in the organisation, not just their own',
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));

      await getCourses();

      expect(mockCourseFindMany.mock.calls[0][0].where).toEqual({
        creator: { organizationId: 'org-1' },
      });
    },
  );

  it('supervisor in particular — authors nothing, so creator scoping left them empty', async () => {
    mockAuth.mockResolvedValue(sessionFor('supervisor'));

    await getCourses();

    const where = mockCourseFindMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('createdByOrgUserId');
  });

  it('finance is NOT widened — it lost course.read (#9)', async () => {
    mockAuth.mockResolvedValue(sessionFor('finance'));

    await getCourses();

    expect(mockCourseFindMany.mock.calls[0][0].where).toEqual({
      createdByOrgUserId: 'ou-1',
    });
  });

  it('a worker is NOT widened — worker roles hold course.read for their OWN enrolled courses', async () => {
    mockAuth.mockResolvedValue(sessionFor('nurse'));

    await getCourses();

    expect(mockCourseFindMany.mock.calls[0][0].where).toEqual({
      createdByOrgUserId: 'ou-1',
    });
  });

  it('the enrollment tally follows the same scope, or org courses show a permanent 0', async () => {
    mockAuth.mockResolvedValue(sessionFor('hr'));

    await getCourses();

    expect(mockEnrollmentGroupBy.mock.calls[0][0].where).toEqual({
      course: { creator: { organizationId: 'org-1' } },
    });
  });
});
