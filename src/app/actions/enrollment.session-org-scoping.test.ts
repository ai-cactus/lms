/**
 * Adversarial tenant-isolation regression tests for Tier 3 5.2 (PR-5):
 * getAvailableUsers, getCourseAssignmentSettings and getRoleHolderCounts in
 * enrollment.ts now read organizationId/role straight off the
 * DB-revalidated session instead of re-querying prisma.user.findUnique.
 * None of the three had a pre-existing dedicated test (enrollment.test.ts
 * only covers enrollUsers) — this closes that gap and specifically probes
 * cross-tenant leakage and the admin-only role gates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Post multi-org split: both the assignable roster and the role-holder tally
// are per-organization memberships, so they read OrganizationUser, not User.
const {
  mockAdminAuth,
  mockWorkerAuth,
  mockOrgUserFindMany,
  mockOrgUserGroupBy,
  mockCourseAssignmentFindFirst,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
  mockOrgUserGroupBy: vi.fn(),
  mockCourseAssignmentFindFirst: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    organizationUser: { findMany: mockOrgUserFindMany, groupBy: mockOrgUserGroupBy },
    courseAssignment: { findFirst: mockCourseAssignmentFindFirst },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getAvailableUsers, getCourseAssignmentSettings, getRoleHolderCounts } from './enrollment';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAvailableUsers — org-scoping sourced from the session', () => {
  it('queries only users in the caller org (org-A), and only org-A', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'admin-1', organizationId: 'org-A' } });
    mockWorkerAuth.mockResolvedValue(null);
    mockOrgUserFindMany.mockResolvedValue([
      {
        id: 'ou1',
        role: 'nurse',
        user: { email: 'a@org-a.com', fullName: null, avatarUrl: null },
      },
    ]);

    const result = await getAvailableUsers();

    expect(mockOrgUserFindMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: { organizationId: 'org-A', active: true } }),
    );
    // `id` is the organizationUserId — the membership every org-scoped artifact
    // (enrollments included) is owned by, never the bare identity id.
    expect(result).toEqual([
      {
        id: 'ou1',
        email: 'a@org-a.com',
        fullName: 'a@org-a.com',
        role: 'nurse',
        avatarUrl: null,
      },
    ]);
  });

  it('a different org session (org-B) never sees org-A results and never issues an org-A-scoped query', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'admin-2', organizationId: 'org-B' } });
    mockWorkerAuth.mockResolvedValue(null);
    mockOrgUserFindMany.mockResolvedValue([]);

    await getAvailableUsers();

    expect(mockOrgUserFindMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: { organizationId: 'org-B', active: true } }),
    );
    expect(mockOrgUserFindMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-A' }) }),
    );
  });

  it('never issues the DB query for an org-less session — an org: null where-clause would match every removed/pending user across ALL orgs, a real cross-tenant leak if this guard regresses', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'admin-1', organizationId: null } });
    mockWorkerAuth.mockResolvedValue(null);

    const result = await getAvailableUsers();

    expect(result).toEqual([]);
    expect(mockOrgUserFindMany).not.toHaveBeenCalled();
  });

  it('throws Unauthorized with no session, never touching the DB', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getAvailableUsers()).rejects.toThrow('Unauthorized');
    expect(mockOrgUserFindMany).not.toHaveBeenCalled();
  });
});

describe('getCourseAssignmentSettings — admin-only + org-scoped, sourced from the session', () => {
  it('rejects a worker-tier session role with Forbidden, never touching the DB', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'w-1', role: 'nurse', organizationId: 'org-A' },
    });
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getCourseAssignmentSettings('course-1')).rejects.toThrow('Forbidden');
    expect(mockCourseAssignmentFindFirst).not.toHaveBeenCalled();
  });

  it('scopes the assignment lookup strictly to the caller org, even for a course id that exists in another org', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-1', role: 'owner', organizationId: 'org-A' },
    });
    mockWorkerAuth.mockResolvedValue(null);
    mockCourseAssignmentFindFirst.mockResolvedValue(null);

    const result = await getCourseAssignmentSettings('shared-global-course');

    expect(mockCourseAssignmentFindFirst).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        where: { organizationId: 'org-A', courseId: 'shared-global-course' },
      }),
    );
    expect(result).toBeNull();
  });

  it("returns null (not Forbidden, not another org's row) for an org-less admin-tier session", async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-1', role: 'owner', organizationId: null },
    });
    mockWorkerAuth.mockResolvedValue(null);

    const result = await getCourseAssignmentSettings('course-1');

    expect(result).toBeNull();
    expect(mockCourseAssignmentFindFirst).not.toHaveBeenCalled();
  });
});

describe('getRoleHolderCounts — admin-only + org-scoped, sourced from the session', () => {
  it('rejects a worker-tier session role with Forbidden, never touching the DB', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'w-1', role: 'therapist_clinician', organizationId: 'org-A' },
    });
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getRoleHolderCounts()).rejects.toThrow('Forbidden');
    expect(mockOrgUserGroupBy).not.toHaveBeenCalled();
  });

  it('groups strictly within the caller org — a session for org-B never triggers an org-A grouped count', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-2', role: 'hr', organizationId: 'org-B' },
    });
    mockWorkerAuth.mockResolvedValue(null);
    mockOrgUserGroupBy.mockResolvedValue([{ role: 'nurse', _count: { _all: 3 } }]);

    const result = await getRoleHolderCounts();

    expect(mockOrgUserGroupBy).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: { organizationId: 'org-B', active: true } }),
    );
    expect(result).toEqual({ nurse: 3 });
  });

  it('returns an empty object (no DB call) for an org-less admin-tier session', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-1', role: 'owner', organizationId: null },
    });
    mockWorkerAuth.mockResolvedValue(null);

    const result = await getRoleHolderCounts();

    expect(result).toEqual({});
    expect(mockOrgUserGroupBy).not.toHaveBeenCalled();
  });
});
