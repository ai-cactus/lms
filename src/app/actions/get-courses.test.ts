import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockWorkerAuth,
  mockCourseFindMany,
  mockOfferingFindMany,
  mockUserFindUnique,
  mockEnrollmentGroupBy,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindMany: vi.fn(),
  mockOfferingFindMany: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockEnrollmentGroupBy: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findMany: mockCourseFindMany },
    orgCourseOffering: { findMany: mockOfferingFindMany },
    user: { findUnique: mockUserFindUnique },
    enrollment: { groupBy: mockEnrollmentGroupBy },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));

import { getCourses } from './course';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'admin-1', organizationId: 'org-1' } });
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
