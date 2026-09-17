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
  mockFacilityFindMany,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
  mockOrgUserGroupBy: vi.fn(),
  mockCourseAssignmentFindFirst: vi.fn(),
  mockFacilityFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    organizationUser: { findMany: mockOrgUserFindMany, groupBy: mockOrgUserGroupBy },
    courseAssignment: { findFirst: mockCourseAssignmentFindFirst },
    // `resolveDataFacilityIds` reaches this for a facility-bound caller
    // (supervisor); an org-wide one short-circuits before it.
    facility: { findMany: mockFacilityFindMany },
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
import { ADMIN_ROLES, WORKER_ROLES, dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAvailableUsers — org-scoping sourced from the session', () => {
  it('queries only users in the caller org (org-A), and only org-A', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-1', role: 'owner', organizationId: 'org-A' },
    });
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
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-2', role: 'owner', organizationId: 'org-B' },
    });
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
    // `role` is now load-bearing on this fixture: the permission gate runs ahead
    // of the org check, so an org-less session must still carry a role that gets
    // past it for this test to prove what it says it proves.
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-1', role: 'owner', organizationId: null },
    });
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

  /**
   * The trap this pins: `getAvailableUsers` resolves a WORKER session as well as
   * an admin one and returns rows carrying staff EMAIL addresses. The obvious
   * verbs for an assignee picker — `enrollment.read`, `course.read` — are in
   * `workerPermissions`, so gating on either would leave this exactly as open as
   * it was with no gate at all. The roles below are denied precisely BECAUSE
   * they hold those verbs; a "simplification" to either must turn this red.
   */
  describe('permission gate', () => {
    const WORKER_ROLES_HOLDING_THE_TEMPTING_VERBS = WORKER_ROLES.filter(
      (role) =>
        can(dbRoleToRoleKey(role), 'enrollment.read') && can(dbRoleToRoleKey(role), 'course.read'),
    );

    it('every worker role holds enrollment.read AND course.read — the reason neither can be the gate', () => {
      expect(WORKER_ROLES_HOLDING_THE_TEMPTING_VERBS).toEqual([...WORKER_ROLES]);
      expect(WORKER_ROLES_HOLDING_THE_TEMPTING_VERBS.length).toBeGreaterThanOrEqual(3);
    });

    it.each(WORKER_ROLES_HOLDING_THE_TEMPTING_VERBS)(
      '%s is refused the roster, never touching the DB — despite holding enrollment.read and course.read',
      async (role) => {
        mockAdminAuth.mockResolvedValue(null);
        mockWorkerAuth.mockResolvedValue({
          user: { id: 'w-1', role, organizationUserId: 'ou-w-1', organizationId: 'org-A' },
        });

        await expect(getAvailableUsers()).rejects.toThrow('Forbidden');
        expect(mockOrgUserFindMany).not.toHaveBeenCalled();
      },
    );

    it.each(
      ADMIN_ROLES.filter(
        (role) =>
          can(dbRoleToRoleKey(role), 'user.read') ||
          can(dbRoleToRoleKey(role), 'assignment.create'),
      ),
    )('%s keeps the picker — it may assign training', async (role) => {
      mockAdminAuth.mockResolvedValue({
        user: { id: 'a-1', role, organizationUserId: 'ou-a-1', organizationId: 'org-A' },
      });
      mockWorkerAuth.mockResolvedValue(null);
      mockOrgUserFindMany.mockResolvedValue([]);
      mockFacilityFindMany.mockResolvedValue([{ id: 'fac-1' }]);

      await expect(getAvailableUsers()).resolves.toEqual([]);
    });

    it('finance is refused too — it holds neither verb and has no Staff Management access', async () => {
      mockAdminAuth.mockResolvedValue({
        user: { id: 'f-1', role: 'finance', organizationUserId: 'ou-f-1', organizationId: 'org-A' },
      });
      mockWorkerAuth.mockResolvedValue(null);

      await expect(getAvailableUsers()).rejects.toThrow('Forbidden');
      expect(mockOrgUserFindMany).not.toHaveBeenCalled();
    });
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
