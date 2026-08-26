/**
 * Adversarial tenant-isolation regression tests for Tier 3 5.2 (PR-5):
 * getStaffUsers and searchStaffUsers in user.ts now read organizationId
 * straight off the DB-revalidated session instead of re-querying
 * prisma.user.findUnique. Post multi-org split they enumerate
 * OrganizationUser memberships rather than raw users. Neither had a pre-existing test (user.test.ts only
 * covers updateProfile) — this closes that gap and specifically probes
 * cross-tenant leakage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Post multi-org split: the roster is a list of OrganizationUser memberships,
// so the org-scoped query is organizationUser.findMany, not user.findMany.
const { mockAdminAuth, mockWorkerAuth, mockHeaders, mockOrgUserFindMany, mockInviteFindMany } =
  vi.hoisted(() => ({
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockHeaders: vi.fn(),
    mockOrgUserFindMany: vi.fn(),
    mockInviteFindMany: vi.fn(),
  }));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    organizationUser: { findMany: mockOrgUserFindMany },
    invite: { findMany: mockInviteFindMany },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/headers', () => ({ headers: mockHeaders }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn() }, hash: vi.fn() }));

import { getStaffUsers, searchStaffUsers } from './user';

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockResolvedValue({ get: () => null }); // non-worker referer → resolveSession uses adminAuth
  mockOrgUserFindMany.mockResolvedValue([]);
  mockInviteFindMany.mockResolvedValue([]);
});

describe('getStaffUsers — org-scoping sourced from the session', () => {
  it('scopes both the user and invite lookups to the caller org (org-A)', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-1', role: 'owner', organizationId: 'org-A' },
    });
    mockWorkerAuth.mockResolvedValue(null);

    await getStaffUsers();

    expect(mockOrgUserFindMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-A' }) }),
    );
    expect(mockInviteFindMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-A' }) }),
    );
  });

  it('a different admin session (org-B) issues org-B-scoped queries, never org-A', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-2', role: 'owner', organizationId: 'org-B' },
    });
    mockWorkerAuth.mockResolvedValue(null);

    await getStaffUsers();

    expect(mockOrgUserFindMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-B' }) }),
    );
    expect(mockOrgUserFindMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-A' }) }),
    );
  });

  it('returns an empty roster and never touches the DB for an org-less session (an org: null filter would otherwise match every removed staffer across every tenant)', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-1', role: 'owner', organizationId: null },
    });
    mockWorkerAuth.mockResolvedValue(null);

    const result = await getStaffUsers();

    expect(result).toEqual([]);
    expect(mockOrgUserFindMany).not.toHaveBeenCalled();
    expect(mockInviteFindMany).not.toHaveBeenCalled();
  });

  it('throws Unauthorized with no session', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getStaffUsers()).rejects.toThrow('Unauthorized');
  });
});

describe('searchStaffUsers — org-scoping sourced from the session', () => {
  it('scopes the search query to the caller org', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-1', role: 'owner', organizationId: 'org-A' },
    });
    mockWorkerAuth.mockResolvedValue(null);

    await searchStaffUsers('jane');

    expect(mockOrgUserFindMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-A' }) }),
    );
  });

  it('a different org session (org-B) never triggers an org-A-scoped search', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-2', role: 'owner', organizationId: 'org-B' },
    });
    mockWorkerAuth.mockResolvedValue(null);

    await searchStaffUsers('jane');

    expect(mockOrgUserFindMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-A' }) }),
    );
  });

  it('returns [] without querying the DB for an org-less session, regardless of query length', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'admin-1', role: 'owner', organizationId: null },
    });
    mockWorkerAuth.mockResolvedValue(null);

    const result = await searchStaffUsers('jane');

    expect(result).toEqual([]);
    expect(mockOrgUserFindMany).not.toHaveBeenCalled();
  });

  it('returns [] for no session at all, without throwing', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    const result = await searchStaffUsers('jane');

    expect(result).toEqual([]);
  });
});
