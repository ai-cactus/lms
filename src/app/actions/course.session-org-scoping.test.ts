/**
 * Adversarial tenant-isolation regression tests for Tier 3 5.2 (PR-5):
 * course.ts actions now read organizationId/role straight off the
 * DB-revalidated session (see resolveSession() in course.ts) instead of
 * re-querying prisma.user.findUnique. These tests probe the highest-stakes
 * regression risk called out for this change: that org-scoping and role gates
 * stay byte-for-byte identical to the pre-change behavior, with no
 * cross-tenant leakage and no way for a session sourced from a different org
 * to see another organization's data.
 *
 * getCourses, getCourseForOrgView and assignRetake have no pre-existing
 * dedicated test file (only getDashboardData does, in course.test.ts) — this
 * closes that gap for the functions PR-5 touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockCourseFindMany,
  mockOrgCourseOfferingFindMany,
  mockCourseFindFirst,
  mockEnrollmentFindUnique,
  mockEnrollmentCreate,
  mockEnrollmentGroupBy,
  mockNotificationUpdateMany,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindMany: vi.fn(),
  mockOrgCourseOfferingFindMany: vi.fn(),
  mockCourseFindFirst: vi.fn(),
  mockEnrollmentFindUnique: vi.fn(),
  mockEnrollmentCreate: vi.fn(),
  mockEnrollmentGroupBy: vi.fn(),
  mockNotificationUpdateMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findMany: mockCourseFindMany, findFirst: mockCourseFindFirst },
    orgCourseOffering: { findMany: mockOrgCourseOfferingFindMany },
    enrollment: {
      findUnique: mockEnrollmentFindUnique,
      findFirst: vi.fn(),
      create: mockEnrollmentCreate,
      groupBy: mockEnrollmentGroupBy,
    },
    notification: { updateMany: mockNotificationUpdateMany },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./notifications', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  notifyOrganizationAdmins: vi.fn().mockResolvedValue(undefined),
}));

import { getCourses, getCourseForOrgView, assignRetake } from './course';

beforeEach(() => {
  vi.clearAllMocks();
  mockCourseFindMany.mockResolvedValue([]);
  mockOrgCourseOfferingFindMany.mockResolvedValue([]);
  mockEnrollmentGroupBy.mockResolvedValue([]);
});

describe('getCourses — org-scoping sourced from the session', () => {
  it('scopes the adopted-offerings query to org-A when the session carries org-A', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'admin-1', organizationId: 'org-A' } });
    mockWorkerAuth.mockResolvedValue(null);

    await getCourses();

    expect(mockOrgCourseOfferingFindMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: { organizationId: 'org-A' } }),
    );
  });

  it('scopes to org-B (never org-A) for a different admin whose session carries org-B — no cross-tenant bleed between calls', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'admin-2', organizationId: 'org-B' } });
    mockWorkerAuth.mockResolvedValue(null);

    await getCourses();

    expect(mockOrgCourseOfferingFindMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: { organizationId: 'org-B' } }),
    );
  });

  it('never queries adopted offerings at all for an org-less session (must not fall back to an unscoped/global query)', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'admin-1', organizationId: null } });
    mockWorkerAuth.mockResolvedValue(null);

    await getCourses();

    expect(mockOrgCourseOfferingFindMany).not.toHaveBeenCalled();
  });

  it('throws Unauthorized when neither session resolves', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getCourses()).rejects.toThrow('Unauthorized');
    expect(mockOrgCourseOfferingFindMany).not.toHaveBeenCalled();
  });
});

describe('getCourseForOrgView — org-scoped enrollment visibility sourced from the session', () => {
  const course = {
    id: 'course-1',
    modules: [],
    lessons: [],
    quiz: null,
    enrollments: [],
    creator: null,
  };

  it('scopes the enrolled-staff include to the caller org (org-A) — never another org', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'admin-1', organizationId: 'org-A' } });
    mockWorkerAuth.mockResolvedValue(null);
    mockCourseFindFirst.mockResolvedValue(course);

    await getCourseForOrgView('course-1');

    const callArgs = mockCourseFindFirst.mock.calls[0][0];
    // Tier 3 5.2: include -> select (courseDetailSelect), but the org `where`
    // value scoping enrolled staff to the caller's org is unchanged.
    expect(callArgs.select.enrollments.where).toEqual({ user: { organizationId: 'org-A' } });
  });

  it('rejects with "Course not found" (never leaking existence) for an org-less session, without ever calling the DB', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'admin-1', organizationId: null } });
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getCourseForOrgView('course-1')).rejects.toThrow('Course not found');
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
  });
});

describe('assignRetake — admin-only role gate sourced from the session', () => {
  const lockedEnrollment = {
    id: 'enr-1',
    status: 'locked',
    userId: 'worker-1',
    courseId: 'course-1',
    user: { profile: { fullName: 'Worker One' } },
    course: { id: 'course-1', title: 'Safety 101' },
  };

  beforeEach(() => {
    mockEnrollmentFindUnique.mockResolvedValue(lockedEnrollment);
    mockEnrollmentCreate.mockResolvedValue({ id: 'retake-1' });
    mockNotificationUpdateMany.mockResolvedValue({ count: 0 });
  });

  it('allows an admin-tier role sourced from the session', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-1', role: 'owner', organizationId: 'org-A' },
    });
    mockWorkerAuth.mockResolvedValue(null);

    const result = await assignRetake('enr-1');

    expect(result.success).toBe(true);
    expect(mockEnrollmentCreate).toHaveBeenCalledOnce();
  });

  it('rejects a worker-tier role sourced from the session with Insufficient permissions, never reaching the DB write', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'worker-1', role: 'nurse', organizationId: 'org-A' },
    });
    mockWorkerAuth.mockResolvedValue(null);

    await expect(assignRetake('enr-1')).rejects.toThrow('Insufficient permissions');
    expect(mockEnrollmentCreate).not.toHaveBeenCalled();
  });

  it('defense-in-depth: rejects the retired legacy "admin" role even if it somehow reaches the action (isAdminRole excludes it post-RBAC-migration)', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'legacy-1', role: 'admin', organizationId: 'org-A' },
    });
    mockWorkerAuth.mockResolvedValue(null);

    await expect(assignRetake('enr-1')).rejects.toThrow('Insufficient permissions');
    expect(mockEnrollmentCreate).not.toHaveBeenCalled();
  });
});
