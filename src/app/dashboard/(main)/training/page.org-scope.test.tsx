/**
 * TrainingPage is the SECOND consumer of `getDashboardData`
 * (`page.test.tsx` in this same directory fully mocks that action and only
 * pins the page's wiring — that `requirePermissionWithFacilityScope`'s
 * `dataFacilityIds` reaches it unchanged). This file instead runs the REAL
 * `getDashboardData` against a mocked Prisma layer, the same way
 * `course.test.ts`'s "population scoping" suite does, to prove this second
 * surface gets the org-scoped fix too rather than trusting the wiring test
 * alone — see the plan's Verification section ("`/dashboard/training` is a
 * second consumer... its numbers change too").
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockRequirePermissionWithFacilityScope,
  mockAdminAuth,
  mockWorkerAuth,
  mockCourseFindMany,
  mockEnrollmentFindMany,
  mockOrgUserFindMany,
  mockOrgCourseOfferingFindMany,
  mockQuizAttemptFindMany,
  mockCertificateFindMany,
  mockQuizFindMany,
} = vi.hoisted(() => ({
  mockRequirePermissionWithFacilityScope: vi.fn(),
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindMany: vi.fn(),
  mockEnrollmentFindMany: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
  mockOrgCourseOfferingFindMany: vi.fn(),
  mockQuizAttemptFindMany: vi.fn(),
  mockCertificateFindMany: vi.fn(),
  mockQuizFindMany: vi.fn(),
}));

vi.mock('@/lib/rbac/require-permission', () => ({
  requirePermissionWithFacilityScope: mockRequirePermissionWithFacilityScope,
}));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findMany: mockCourseFindMany },
    enrollment: { findMany: mockEnrollmentFindMany },
    organizationUser: { findMany: mockOrgUserFindMany },
    orgCourseOffering: { findMany: mockOrgCourseOfferingFindMany },
    quizAttempt: { findMany: mockQuizAttemptFindMany },
    certificate: { findMany: mockCertificateFindMany },
    quiz: { findMany: mockQuizFindMany },
  };
  return { prisma, default: prisma };
});
vi.mock('./TrainingClient', () => ({
  default: ({ stats }: { stats: { catalogCourseCount: number } }) => (
    <div data-testid="training-client">{stats.catalogCourseCount}</div>
  ),
}));

import TrainingPage from './page';

const ORG_ID = 'org-1';
const ADMIN_ORG_USER_ID = 'ou-admin-1';

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermissionWithFacilityScope.mockResolvedValue({ dataFacilityIds: null });
  mockAdminAuth.mockResolvedValue({
    user: {
      id: 'admin-1',
      role: 'admin',
      organizationId: ORG_ID,
      organizationUserId: ADMIN_ORG_USER_ID,
    },
  });
  mockWorkerAuth.mockResolvedValue(null);
  mockEnrollmentFindMany.mockResolvedValue([]);
  mockOrgUserFindMany.mockResolvedValue([]);
  mockOrgCourseOfferingFindMany.mockResolvedValue([]);
  mockQuizAttemptFindMany.mockResolvedValue([]);
  mockCertificateFindMany.mockResolvedValue([]);
  mockQuizFindMany.mockResolvedValue([]);
});

describe('TrainingPage — org-scoped population (real getDashboardData)', () => {
  it('counts a colleague-authored course, not just the viewer’s own', async () => {
    mockCourseFindMany.mockResolvedValue([
      {
        id: 'hr-authored-course',
        title: "HR's course",
        description: null,
        thumbnail: null,
        status: 'published',
        type: 'document',
        duration: 10,
        createdAt: new Date(2026, 0, 1),
        updatedAt: new Date(2026, 0, 1),
        lessons: [],
      },
    ]);

    const element = await TrainingPage();
    render(element);

    expect(screen.getByTestId('training-client')).toHaveTextContent('1');
    expect(mockCourseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG_ID } }),
    );
  });
});
