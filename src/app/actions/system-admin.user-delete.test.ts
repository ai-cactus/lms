/**
 * Q-23 — the /system console's side of the soft delete.
 *
 *  - `deleteUserWithRelations` delegates to the shared `softDeleteUser` (the
 *    same function the ops scripts use, RISK-14) and turns its refusals into
 *    RETURNED errors: a thrown Server Action error is redacted in production.
 *  - `getUserDeletePreview` reports what is revoked and what is RETAINED;
 *    nothing is described as destroyed, and archived courses/documents are
 *    counted through the un-filtered client.
 *  - `getAllUsers` hides deleted identities by default, can list them, and
 *    shows a deleted identity's records through its deactivated memberships.
 *  - `getUserDetail` surfaces `deletedAt` so the page opens read-only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockPrisma,
  mockRawPrisma,
  mockSoftDelete,
  mockFindOwnershipBlocks,
  mockVerifyCookie,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    organizationUser: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    organization: { findMany: vi.fn() },
    enrollment: { count: vi.fn() },
    quizAttempt: { count: vi.fn() },
    certificate: { count: vi.fn() },
    invite: { count: vi.fn() },
  },
  mockRawPrisma: { course: { count: vi.fn() }, document: { count: vi.fn() } },
  mockSoftDelete: vi.fn(),
  mockFindOwnershipBlocks: vi.fn(),
  mockVerifyCookie: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma, default: mockPrisma }));
vi.mock('@/db/index', () => ({ rawPrisma: mockRawPrisma }));
vi.mock('@/lib/system/delete-user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/system/delete-user')>();
  return {
    softDeleteUser: mockSoftDelete,
    findOwnershipBlocks: mockFindOwnershipBlocks,
    describeOwnershipBlocks: actual.describeOwnershipBlocks,
  };
});
vi.mock('@/lib/system-auth', () => ({
  verifySystemAdminCookie: mockVerifyCookie,
  SYSTEM_ADMIN_COOKIE: 'system_admin_auth',
}));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('@/lib/audit', () => ({
  audit: vi.fn(),
  getClientContext: (h: Headers) => ({ ip: h.get('x-forwarded-for') ?? undefined }),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));

import {
  deleteUserWithRelations,
  getAllUsers,
  getUserDeletePreview,
  getUserDetail,
} from './system-admin';

const DELETED_AT = new Date('2026-09-28T10:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCookie.mockResolvedValue(true);
});

describe('deleteUserWithRelations — delegates to the shared soft delete', () => {
  it('refuses without a system-admin session', async () => {
    mockVerifyCookie.mockResolvedValueOnce(false);
    await expect(deleteUserWithRelations('u1')).rejects.toThrow('Unauthorized');
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it('soft-deletes with the system-admin audit context and reports memberships deactivated', async () => {
    mockSoftDelete.mockResolvedValueOnce({
      status: 'deleted',
      deletedAt: DELETED_AT,
      membershipsDeactivated: 2,
      invitesExpired: 0,
      verificationTokensRevoked: 0,
    });

    const result = await deleteUserWithRelations('u1');

    expect(result).toEqual({ success: true, membershipsDeactivated: 2 });
    expect(mockSoftDelete).toHaveBeenCalledWith('u1', {
      actorRole: 'system_admin',
      ip: '203.0.113.9',
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/system');
  });

  it('returns the Q-30 ownership refusal without revalidating', async () => {
    mockSoftDelete.mockResolvedValueOnce({
      status: 'blocked',
      blocks: [{ organizationId: 'org-a', organizationName: 'Acme', reason: 'sole_owner' }],
      message: 'Transfer ownership of Acme before deleting this user.',
    });

    await expect(deleteUserWithRelations('u1')).resolves.toEqual({
      success: false,
      error: 'Transfer ownership of Acme before deleting this user.',
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it('returns a clear "already deleted" refusal on a second delete', async () => {
    mockSoftDelete.mockResolvedValueOnce({ status: 'already_deleted', deletedAt: DELETED_AT });

    const result = await deleteUserWithRelations('u1');

    expect(result).toEqual({
      success: false,
      error: 'This user was already deleted on 2026-09-28.',
    });
  });

  it('returns (never throws) when the user does not exist or the delete fails', async () => {
    mockSoftDelete.mockResolvedValueOnce({ status: 'not_found' });
    await expect(deleteUserWithRelations('u1')).resolves.toEqual({
      success: false,
      error: 'User not found',
    });

    mockSoftDelete.mockRejectedValueOnce(new Error('connection reset'));
    await expect(deleteUserWithRelations('u1')).resolves.toEqual({
      success: false,
      error: 'Failed to delete user. Please try again.',
    });
  });
});

describe('getUserDeletePreview — nothing destroyed, records retained', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'dana@example.com',
      fullName: 'Dana Delete',
      deletedAt: null,
    });
    mockPrisma.organizationUser.findMany.mockResolvedValue([
      {
        id: 'm-a',
        role: 'hr',
        active: true,
        organizationId: 'org-a',
        organization: { name: 'Acme' },
      },
      {
        id: 'm-b',
        role: 'nurse',
        active: false,
        organizationId: 'org-b',
        organization: { name: 'Beta' },
      },
    ]);
    mockPrisma.enrollment.count.mockResolvedValue(5);
    mockPrisma.quizAttempt.count.mockResolvedValue(7);
    mockPrisma.certificate.count.mockResolvedValue(3);
    mockPrisma.organizationUser.count.mockResolvedValue(1);
    mockPrisma.invite.count.mockResolvedValue(1);
    mockRawPrisma.course.count.mockResolvedValue(2);
    mockRawPrisma.document.count.mockResolvedValue(4);
    mockFindOwnershipBlocks.mockResolvedValue([]);
  });

  it('carries the Q-30 refusal when the delete would orphan an organization', async () => {
    mockFindOwnershipBlocks.mockResolvedValueOnce([
      { organizationId: 'org-a', organizationName: 'Acme', reason: 'sole_owner' },
    ]);

    const preview = await getUserDeletePreview('u1');

    expect(preview?.blockedReason).toBe('Transfer ownership of Acme before deleting this user.');
    expect(mockFindOwnershipBlocks).toHaveBeenCalledWith(mockPrisma, 'u1');
  });

  it('reports revoked access and retained records', async () => {
    const preview = await getUserDeletePreview('u1');

    expect(preview).toEqual({
      user: { id: 'u1', email: 'dana@example.com', role: 'hr', name: 'Dana Delete' },
      deletedAt: null,
      blockedReason: null,
      revoked: { organizations: ['Acme'], pendingInvites: 1 },
      retained: {
        enrollments: 5,
        quizAttempts: 7,
        certificates: 3,
        courses: 2,
        documents: 4,
        directReports: 1,
      },
    });
  });

  it('counts authored courses and documents on the un-filtered client (archived are retained too)', async () => {
    await getUserDeletePreview('u1');

    expect(mockRawPrisma.course.count).toHaveBeenCalledWith({
      where: { createdByOrgUserId: { in: ['m-a', 'm-b'] } },
    });
    expect(mockRawPrisma.document.count).toHaveBeenCalledWith({
      where: { organizationUserId: { in: ['m-a', 'm-b'] } },
    });
  });

  it("counts only pending invites from the person's own organizations", async () => {
    await getUserDeletePreview('u1');

    expect(mockPrisma.invite.count).toHaveBeenCalledWith({
      where: {
        email: { equals: 'dana@example.com', mode: 'insensitive' },
        organizationId: { in: ['org-a', 'org-b'] },
        status: 'pending',
      },
    });
  });
});

describe('getAllUsers — active / deleted / all', () => {
  beforeEach(() => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.organization.findMany.mockResolvedValue([]);
  });

  it('hides deleted identities by default', async () => {
    await getAllUsers({});
    expect(mockPrisma.user.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
    expect(mockPrisma.user.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });

  it('lists only deleted identities when asked', async () => {
    await getAllUsers({ statusFilter: 'deleted' });
    expect(mockPrisma.user.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: { not: null },
    });
  });

  it('lists everyone for "all"', async () => {
    await getAllUsers({ statusFilter: 'all' });
    expect(mockPrisma.user.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('returns every organization, soft-deleted ones flagged, so their users stay filterable', async () => {
    const deletedAt = new Date('2026-10-08T10:00:00Z');
    mockPrisma.organization.findMany.mockResolvedValue([
      { id: 'org-a', name: 'Alpha', deletedAt: null },
      { id: 'org-z', name: 'Zeta', deletedAt },
    ]);

    const { organizations } = await getAllUsers({});

    expect(mockPrisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true, name: true, deletedAt: true } }),
    );
    expect(mockPrisma.organization.findMany.mock.calls[0][0]).not.toHaveProperty('where');
    expect(organizations).toEqual([
      { id: 'org-a', name: 'Alpha', deletedAt: null },
      { id: 'org-z', name: 'Zeta', deletedAt },
    ]);
  });

  // BUG-48: `User.avatarUrl` is a raw storage URI and nothing on /system renders
  // an avatar, so it is neither read nor returned.
  it('never selects or returns the stored avatar URI', async () => {
    await getAllUsers({});

    expect(mockPrisma.user.findMany.mock.calls[0][0].select).not.toHaveProperty('avatarUrl');
  });

  it('lets a deleted identity match the organization it was deleted from', async () => {
    await getAllUsers({ statusFilter: 'all', orgFilter: 'org-a' });
    expect(mockPrisma.user.findMany.mock.calls[0][0].where).toEqual({
      organizationMemberships: {
        some: {
          OR: [{ active: true }, { user: { is: { deletedAt: { not: null } } } }],
          organizationId: 'org-a',
        },
      },
    });
  });

  it("shows a deleted identity's retained records through its deactivated memberships", async () => {
    const membership = (active: boolean, org: string, enrollments: number) => ({
      active,
      role: 'nurse',
      organizationId: org,
      organization: { name: org.toUpperCase() },
      _count: { createdCourses: 0, enrollments, documents: 0, notifications: 0 },
    });
    mockPrisma.user.findMany.mockResolvedValueOnce([
      {
        id: 'u-del',
        email: 'd@example.com',
        authProvider: 'credentials',
        emailVerified: true,
        createdAt: DELETED_AT,
        firstName: null,
        lastName: null,
        fullName: 'Dana',
        deletedAt: DELETED_AT,
        organizationMemberships: [membership(false, 'org-a', 4), membership(false, 'org-b', 2)],
      },
      {
        id: 'u-live',
        email: 'l@example.com',
        authProvider: 'credentials',
        emailVerified: true,
        createdAt: DELETED_AT,
        firstName: null,
        lastName: null,
        fullName: 'Lee',
        deletedAt: null,
        organizationMemberships: [membership(false, 'org-old', 9), membership(true, 'org-a', 1)],
      },
    ]);

    const { users } = await getAllUsers({ statusFilter: 'all' });

    expect(users[0]).toMatchObject({
      id: 'u-del',
      deletedAt: DELETED_AT,
      role: 'nurse',
      organizationName: 'ORG-A',
      _count: { enrollments: 6 },
    });
    // A live identity is still represented by its ACTIVE memberships only.
    expect(users[1]).toMatchObject({
      id: 'u-live',
      deletedAt: null,
      organizationName: 'ORG-A',
      _count: { enrollments: 1 },
    });
  });
});

describe('getUserDetail — read-only view of a deleted user', () => {
  it('returns deletedAt alongside the retained records', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u-del',
      email: 'd@example.com',
      authProvider: 'credentials',
      emailVerified: true,
      createdAt: DELETED_AT,
      updatedAt: DELETED_AT,
      firstName: null,
      lastName: null,
      fullName: 'Dana',
      deletedAt: DELETED_AT,
    });
    mockPrisma.organizationUser.findFirst.mockResolvedValueOnce({
      role: 'nurse',
      organization: { id: 'org-a', name: 'Acme', slug: 'acme' },
      createdCourses: [],
      enrollments: [
        {
          id: 'e1',
          status: 'attested',
          progress: 100,
          score: 90,
          startedAt: DELETED_AT,
          completedAt: DELETED_AT,
          course: { id: 'c1', title: 'HIPAA' },
        },
      ],
      documents: [],
      _count: { createdCourses: 0, enrollments: 1, documents: 0, notifications: 0 },
    });

    const detail = await getUserDetail('u-del');

    expect(detail?.deletedAt).toEqual(DELETED_AT);
    // BUG-48: the raw storage URI never reaches the browser.
    expect(mockPrisma.user.findUnique.mock.calls[0][0].select).not.toHaveProperty('avatarUrl');
    expect(detail?.profile).not.toHaveProperty('avatarUrl');
    expect(detail?.enrollments).toHaveLength(1);
    // The representative membership is read active-or-not.
    expect(mockPrisma.organizationUser.findFirst.mock.calls[0][0].where).toEqual({
      userId: 'u-del',
    });
  });
});
