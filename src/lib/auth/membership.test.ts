/**
 * Regression coverage for the User -> OrganizationUser membership-resolution
 * seam introduced by the multi-org refactor. `resolveActiveMembership` is the
 * single decision point for login routing (onboarding vs auto-select vs org
 * picker vs removed-access), so its four resolution kinds are covered
 * explicitly, including the `lastActiveOrganizationId` picker-skip and its
 * stale-reference fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockLogger } = vi.hoisted(() => {
  const prismaMock = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    organizationUser: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), upsert: vi.fn() },
    organizationUserFacility: { upsert: vi.fn() },
    $transaction: vi.fn(),
  };
  return {
    prismaMock,
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({ logger: mockLogger, maskEmail: (e: string) => e }));

import {
  resolveActiveMembership,
  listActiveMemberships,
  getActiveMembership,
  createMembership,
  recordMembershipLogin,
} from './membership';

function membershipRow(
  overrides: Partial<{ id: string; role: string; organizationId: string }> = {},
) {
  return {
    id: overrides.id ?? 'ou-1',
    role: overrides.role ?? 'hr',
    organizationId: overrides.organizationId ?? 'org-1',
    organization: { name: 'Acme Health', slug: 'acme-health' },
  };
}

describe('resolveActiveMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns kind "none" when the identity has zero membership rows ever (founder heading to onboarding)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ lastActiveOrganizationId: null });
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.count.mockResolvedValue(0);

    const result = await resolveActiveMembership('user-1');

    expect(result).toEqual({ kind: 'none' });
  });

  it('returns kind "revoked" when membership rows exist but none are active', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ lastActiveOrganizationId: null });
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.count.mockResolvedValue(2); // had rows, all deactivated

    const result = await resolveActiveMembership('user-1');

    expect(result).toEqual({ kind: 'revoked' });
  });

  it('returns kind "resolved" with the single membership when exactly one active membership exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ lastActiveOrganizationId: null });
    prismaMock.organizationUser.findMany.mockResolvedValue([membershipRow()]);

    const result = await resolveActiveMembership('user-1');

    expect(result).toEqual({
      kind: 'resolved',
      membership: {
        organizationUserId: 'ou-1',
        organizationId: 'org-1',
        organizationName: 'Acme Health',
        organizationSlug: 'acme-health',
        role: 'hr',
      },
    });
    // Single-membership accounts must never be routed through the revoked-count
    // lookup — that query is reserved for the zero-active-membership path.
    expect(prismaMock.organizationUser.count).not.toHaveBeenCalled();
  });

  it('returns kind "choice" with all memberships when 2+ active memberships exist and no remembered org', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ lastActiveOrganizationId: null });
    const memberships = [
      membershipRow({ id: 'ou-1', organizationId: 'org-1' }),
      membershipRow({ id: 'ou-2', organizationId: 'org-2', role: 'owner' }),
    ];
    prismaMock.organizationUser.findMany.mockResolvedValue(memberships);

    const result = await resolveActiveMembership('user-1');

    expect(result.kind).toBe('choice');
    expect(result.kind === 'choice' && result.memberships).toHaveLength(2);
  });

  it('skips the picker (kind "resolved") when lastActiveOrganizationId names one of the active memberships', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ lastActiveOrganizationId: 'org-2' });
    prismaMock.organizationUser.findMany.mockResolvedValue([
      membershipRow({ id: 'ou-1', organizationId: 'org-1' }),
      membershipRow({ id: 'ou-2', organizationId: 'org-2', role: 'owner' }),
    ]);

    const result = await resolveActiveMembership('user-1');

    expect(result).toEqual({
      kind: 'resolved',
      membership: {
        organizationUserId: 'ou-2',
        organizationId: 'org-2',
        organizationName: 'Acme Health',
        organizationSlug: 'acme-health',
        role: 'owner',
      },
    });
  });

  it('falls back to the picker (kind "choice") when lastActiveOrganizationId no longer matches any active membership', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ lastActiveOrganizationId: 'org-stale' });
    prismaMock.organizationUser.findMany.mockResolvedValue([
      membershipRow({ id: 'ou-1', organizationId: 'org-1' }),
      membershipRow({ id: 'ou-2', organizationId: 'org-2' }),
    ]);

    const result = await resolveActiveMembership('user-1');

    expect(result.kind).toBe('choice');
  });
});

describe('listActiveMemberships / getActiveMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries only active memberships, ordered oldest-join-first', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([membershipRow()]);

    await listActiveMemberships('user-1');

    expect(prismaMock.organizationUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', active: true },
        orderBy: { joinedAt: 'asc' },
      }),
    );
  });

  it('getActiveMembership returns null when no active row matches the (user, org) pair', async () => {
    prismaMock.organizationUser.findFirst.mockResolvedValue(null);

    const result = await getActiveMembership('user-1', 'org-1');

    expect(result).toBeNull();
    expect(prismaMock.organizationUser.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', organizationId: 'org-1', active: true },
      }),
    );
  });

  it('getActiveMembership maps a found row to a MembershipSummary', async () => {
    prismaMock.organizationUser.findFirst.mockResolvedValue(membershipRow({ role: 'supervisor' }));

    const result = await getActiveMembership('user-1', 'org-1');

    expect(result).toEqual({
      organizationUserId: 'ou-1',
      organizationId: 'org-1',
      organizationName: 'Acme Health',
      organizationSlug: 'acme-health',
      role: 'supervisor',
    });
  });
});

describe('createMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the OrganizationUser and its first OrganizationUserFacility row atomically', async () => {
    const txMock = {
      organizationUser: { upsert: vi.fn().mockResolvedValue(membershipRow()) },
      organizationUserFacility: { upsert: vi.fn().mockResolvedValue({}) },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof txMock) => unknown) =>
      cb(txMock),
    );

    const result = await createMembership({
      userId: 'user-1',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      role: 'hr',
    });

    expect(result).toEqual({
      organizationUserId: 'ou-1',
      organizationId: 'org-1',
      organizationName: 'Acme Health',
      organizationSlug: 'acme-health',
      role: 'hr',
    });
    expect(txMock.organizationUser.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_organizationId: { userId: 'user-1', organizationId: 'org-1' } },
        create: expect.objectContaining({ userId: 'user-1', organizationId: 'org-1', role: 'hr' }),
      }),
    );
    expect(txMock.organizationUserFacility.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationUserId_facilityId: { organizationUserId: 'ou-1', facilityId: 'facility-1' },
        },
        create: { organizationUserId: 'ou-1', facilityId: 'facility-1' },
      }),
    );
  });

  it('reactivates a deactivated membership on re-join instead of creating a duplicate row', async () => {
    const txMock = {
      organizationUser: { upsert: vi.fn().mockResolvedValue(membershipRow({ role: 'owner' })) },
      organizationUserFacility: { upsert: vi.fn().mockResolvedValue({}) },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof txMock) => unknown) =>
      cb(txMock),
    );

    await createMembership({
      userId: 'user-1',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      role: 'owner',
    });

    const upsertCall = txMock.organizationUser.upsert.mock.calls[0][0];
    expect(upsertCall.update).toEqual(
      expect.objectContaining({ role: 'owner', active: true, deactivatedAt: null }),
    );
  });
});

describe('recordMembershipLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stamps the membership lastLoginAt and the user lastActiveOrganizationId', async () => {
    prismaMock.organizationUser.upsert.mockResolvedValue({});
    prismaMock.user.update.mockResolvedValue({});
    // recordMembershipLogin uses prisma.organizationUser.update, not upsert —
    // wire it explicitly so the fire-and-forget calls resolve.
    (prismaMock.organizationUser as unknown as { update: ReturnType<typeof vi.fn> }).update = vi
      .fn()
      .mockResolvedValue({});

    const membership = {
      organizationUserId: 'ou-1',
      organizationId: 'org-1',
      organizationName: 'Acme',
      organizationSlug: 'acme',
      role: 'hr' as const,
    };
    recordMembershipLogin('user-1', membership);
    // Fire-and-forget: flush the microtask queue before asserting.
    await new Promise((resolve) => setImmediate(resolve));

    expect(
      (prismaMock.organizationUser as unknown as { update: ReturnType<typeof vi.fn> }).update,
    ).toHaveBeenCalledWith({ where: { id: 'ou-1' }, data: { lastLoginAt: expect.any(Date) } });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { lastActiveOrganizationId: 'org-1' },
    });
  });

  it('swallows a failure and logs a warning rather than throwing (auth path must never break on this)', async () => {
    (prismaMock.organizationUser as unknown as { update: ReturnType<typeof vi.fn> }).update = vi
      .fn()
      .mockRejectedValue(new Error('db down'));
    prismaMock.user.update.mockResolvedValue({});

    expect(() =>
      recordMembershipLogin('user-1', {
        organizationUserId: 'ou-1',
        organizationId: 'org-1',
        organizationName: 'Acme',
        organizationSlug: 'acme',
        role: 'hr' as const,
      }),
    ).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('Failed to record membership login'),
      }),
    );
  });
});
