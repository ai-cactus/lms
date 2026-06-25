import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockWorkerAuth, mockCourseFindMany, mockOfferingFindMany, mockUserFindUnique } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockCourseFindMany: vi.fn(),
    mockOfferingFindMany: vi.fn(),
    mockUserFindUnique: vi.fn(),
  }));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findMany: mockCourseFindMany },
    orgCourseOffering: { findMany: mockOfferingFindMany },
    user: { findUnique: mockUserFindUnique },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));

import { getCourses } from './course';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } });
  mockWorkerAuth.mockResolvedValue(null);
  mockUserFindUnique.mockResolvedValue({ organizationId: 'org-1' });
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
        duration: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
        lessons: [],
        enrollments: [],
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
          duration: 30,
          createdAt: new Date(),
          updatedAt: new Date(),
          lessons: [{ id: 'l1' }],
          enrollments: [{ status: 'completed' }],
        },
      },
    ]);

    const result = await getCourses();
    const ids = result.map((c) => c.id);
    expect(ids).toContain('own-1');
    expect(ids).toContain('global-1');
  });
});
