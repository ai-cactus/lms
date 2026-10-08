/**
 * Adversarial tenant-isolation regression tests for Tier 3 5.2 (PR-5):
 * getCourseAssignmentSettings and getRoleHolderCounts in enrollment.ts read
 * organizationId/role straight off the DB-revalidated session instead of
 * re-querying prisma.user.findUnique.
 * Neither had a pre-existing dedicated test (enrollment.test.ts
 * only covers enrollUsers) — this closes that gap and specifically probes
 * cross-tenant leakage and the admin-only role gates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Post multi-org split: the role-holder tally counts per-organization
// memberships, so it reads OrganizationUser, not User.
const {
  mockAdminAuth,
  mockWorkerAuth,
  mockOrgUserGroupBy,
  mockCourseAssignmentFindFirst,
  mockFacilityFindMany,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockOrgUserGroupBy: vi.fn(),
  mockCourseAssignmentFindFirst: vi.fn(),
  mockFacilityFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    organizationUser: { groupBy: mockOrgUserGroupBy },
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

import * as enrollmentActions from './enrollment';
import { getCourseAssignmentSettings, getRoleHolderCounts } from './enrollment';

beforeEach(() => {
  vi.clearAllMocks();
});

// TOOL-31: the roster picker action had no caller but tests, yet as a
// `'use server'` export it stayed a live HTTP endpoint returning staff emails.
describe('retired endpoints', () => {
  it('no longer exports getAvailableUsers', () => {
    expect(Object.keys(enrollmentActions)).not.toContain('getAvailableUsers');
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
