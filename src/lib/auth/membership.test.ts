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
  resolveMembershipForActiveSession,
  listActiveMemberships,
  getActiveMembership,
  createMembership,
  recordMembershipLogin,
  ExistingMembershipError,
  DeletedOrganizationError,
  activeMembershipOf,
} from './membership';
import { Prisma } from '@/generated/prisma/client';
import { DeletedIdentityError } from './deleted-identity';
import { LastOwnerError } from '@/lib/organization/owner-guard';

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

describe('resolveActiveMembership — organization soft delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** First findMany = live memberships (none); second = the lost-to-delete probe. */
  function noLiveMembership(inDeletedOrgs: unknown[], totalRows = inDeletedOrgs.length) {
    prismaMock.user.findUnique.mockResolvedValue({ lastActiveOrganizationId: null });
    prismaMock.organizationUser.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(inDeletedOrgs);
    prismaMock.organizationUser.count.mockResolvedValue(totalRows);
  }

  const DELETED_AT = new Date('2026-10-08T10:00:00.000Z');

  it('reports org_deleted when the only org was deleted while the membership was still active', async () => {
    noLiveMembership([
      { active: true, deactivatedAt: null, organization: { deletedAt: DELETED_AT } },
    ]);

    expect(await resolveActiveMembership('user-1')).toEqual({ kind: 'org_deleted' });
  });

  it('reports org_deleted when the membership was deactivated by the delete itself (same instant)', async () => {
    noLiveMembership([
      {
        active: false,
        deactivatedAt: new Date(DELETED_AT.getTime()),
        organization: { deletedAt: DELETED_AT },
      },
    ]);

    expect(await resolveActiveMembership('user-1')).toEqual({ kind: 'org_deleted' });
  });

  it('stays revoked when the person was removed by an admin before the org was deleted', async () => {
    noLiveMembership([
      {
        active: false,
        deactivatedAt: new Date('2026-10-01T09:00:00.000Z'),
        organization: { deletedAt: DELETED_AT },
      },
    ]);

    expect(await resolveActiveMembership('user-1')).toEqual({ kind: 'revoked' });
  });

  it('stays revoked when the only deactivated membership is in a live org', async () => {
    noLiveMembership([], 1);

    expect(await resolveActiveMembership('user-1')).toEqual({ kind: 'revoked' });
  });

  it('asks only for deleted-org memberships when probing why access was lost', async () => {
    noLiveMembership([]);
    prismaMock.organizationUser.count.mockResolvedValue(1);

    await resolveActiveMembership('user-1');

    expect(prismaMock.organizationUser.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', organization: { deletedAt: { not: null } } },
      }),
    );
  });

  it('never probes for a deleted org when a live membership exists (multi-org user keeps their live org)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ lastActiveOrganizationId: null });
    prismaMock.organizationUser.findMany.mockResolvedValue([
      membershipRow({ id: 'ou-live', organizationId: 'org-live' }),
    ]);

    const result = await resolveActiveMembership('user-1');

    expect(result.kind).toBe('resolved');
    expect(result.kind === 'resolved' && result.membership.organizationId).toBe('org-live');
    expect(prismaMock.organizationUser.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.organizationUser.count).not.toHaveBeenCalled();
  });

  it('activeMembershipOf gives no membership for org_deleted', () => {
    expect(activeMembershipOf({ kind: 'org_deleted' })).toBeNull();
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
        where: { userId: 'user-1', active: true, organization: { deletedAt: null } },
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
        where: {
          userId: 'user-1',
          organizationId: 'org-1',
          active: true,
          organization: { deletedAt: null },
        },
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

describe('resolveMembershipForActiveSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs a POINT lookup (getActiveMembership) when the session already names an organization', async () => {
    prismaMock.organizationUser.findFirst.mockResolvedValue(membershipRow({ role: 'nurse' }));

    const result = await resolveMembershipForActiveSession('user-1', 'org-1');

    expect(result).toEqual({
      organizationUserId: 'ou-1',
      organizationId: 'org-1',
      organizationName: 'Acme Health',
      organizationSlug: 'acme-health',
      role: 'nurse',
    });
    expect(prismaMock.organizationUser.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          organizationId: 'org-1',
          active: true,
          organization: { deletedAt: null },
        },
      }),
    );
  });

  it('does NOT consult the global resolver (User.lastActiveOrganizationId or organizationUser.findMany) when the session already names an organization', async () => {
    prismaMock.organizationUser.findFirst.mockResolvedValue(membershipRow());

    await resolveMembershipForActiveSession('user-1', 'org-1');

    // The global resolver reads User.lastActiveOrganizationId and lists every
    // active membership — a sibling session's login or a later org switch may
    // have moved that value, so it must never be consulted once the session's
    // own JWT already names an org (see the point-lookup rationale in the
    // module doc comment).
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
  });

  it('returns null when the session names an organization the user is no longer an active member of', async () => {
    prismaMock.organizationUser.findFirst.mockResolvedValue(null);

    const result = await resolveMembershipForActiveSession('user-1', 'org-stale');

    expect(result).toBeNull();
  });

  it('falls back to the global resolver when the session is genuinely org-less (sessionOrganizationId null)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ lastActiveOrganizationId: null });
    prismaMock.organizationUser.findMany.mockResolvedValue([membershipRow()]);

    const result = await resolveMembershipForActiveSession('user-1', null);

    expect(result).toEqual({
      organizationUserId: 'ou-1',
      organizationId: 'org-1',
      organizationName: 'Acme Health',
      organizationSlug: 'acme-health',
      role: 'hr',
    });
    expect(prismaMock.organizationUser.findFirst).not.toHaveBeenCalled();
  });

  it('returns null via the global-resolver fallback when the org-less user has never joined any organization', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ lastActiveOrganizationId: null });
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.count.mockResolvedValue(0);

    const result = await resolveMembershipForActiveSession('user-1', null);

    expect(result).toBeNull();
  });
});

describe('createMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the OrganizationUser and its first OrganizationUserFacility row atomically', async () => {
    const txMock = {
      user: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null }) },
      organization: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      organizationUser: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(membershipRow()),
      },
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
    // Every join takes the organization lock the soft delete takes, so a join
    // racing a delete is serialised against it.
    expect(txMock.$queryRaw).toHaveBeenCalledOnce();
  });

  // RISK-16 — the concurrent case is driven end to end in owner-guard.test.ts.
  it('refuses to re-role the last active owner and writes nothing', async () => {
    const owner = { id: 'ou-1', organizationId: 'org-1', role: 'owner', active: true };
    const txMock = {
      user: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null }) },
      organization: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      organizationUser: {
        findUnique: vi.fn().mockResolvedValue(owner),
        count: vi.fn().mockResolvedValue(0),
        upsert: vi.fn(),
      },
      organizationUserFacility: { upsert: vi.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof txMock) => unknown) =>
      cb(txMock),
    );

    await expect(
      createMembership({
        userId: 'user-1',
        organizationId: 'org-1',
        facilityId: 'facility-1',
        role: 'nurse',
      }),
    ).rejects.toBeInstanceOf(LastOwnerError);
    expect(txMock.$queryRaw).toHaveBeenCalledOnce();
    expect(txMock.organizationUser.upsert).not.toHaveBeenCalled();
    expect(txMock.organizationUserFacility.upsert).not.toHaveBeenCalled();
  });

  it('reactivates a deactivated membership on re-join instead of creating a duplicate row', async () => {
    const txMock = {
      user: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null }) },
      organization: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
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

  it('refuses to attach or reactivate a deleted identity (Q-23) and writes nothing', async () => {
    const txMock = {
      user: { findUnique: vi.fn().mockResolvedValue({ deletedAt: new Date('2026-09-28') }) },
      organizationUser: { upsert: vi.fn() },
      organizationUserFacility: { upsert: vi.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof txMock) => unknown) =>
      cb(txMock),
    );

    await expect(
      createMembership({
        userId: 'user-1',
        organizationId: 'org-1',
        facilityId: 'facility-1',
        role: 'nurse',
      }),
    ).rejects.toBeInstanceOf(DeletedIdentityError);
    expect(txMock.organizationUser.upsert).not.toHaveBeenCalled();
    expect(txMock.organizationUserFacility.upsert).not.toHaveBeenCalled();
  });
});

describe('createMembership — soft-deleted organization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function deletedOrgTx() {
    return {
      user: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null }) },
      organization: {
        findUnique: vi.fn().mockResolvedValue({ deletedAt: new Date('2026-10-08') }),
      },
      organizationUser: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        upsert: vi.fn(),
      },
      organizationUserFacility: { create: vi.fn(), upsert: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
  }

  const base = {
    userId: 'user-1',
    organizationId: 'org-1',
    facilityId: 'facility-1',
    role: 'nurse' as const,
  };

  function expectNothingWritten(tx: ReturnType<typeof deletedOrgTx>) {
    expect(tx.organizationUser.create).not.toHaveBeenCalled();
    expect(tx.organizationUser.upsert).not.toHaveBeenCalled();
    expect(tx.organizationUserFacility.create).not.toHaveBeenCalled();
    expect(tx.organizationUserFacility.upsert).not.toHaveBeenCalled();
  }

  it.each([
    ['the default (reassign/upsert) branch', {}],
    ["the onExisting 'refuse' branch", { onExisting: 'refuse' as const }],
  ])('refuses a deleted organization on %s and writes nothing', async (_label, extra) => {
    const tx = deletedOrgTx();
    prismaMock.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

    await expect(createMembership({ ...base, ...extra })).rejects.toBeInstanceOf(
      DeletedOrganizationError,
    );
    expectNothingWritten(tx);
  });

  it('takes the organization lock BEFORE reading deletedAt', async () => {
    const tx = deletedOrgTx();
    prismaMock.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

    await createMembership(base).catch(() => undefined);

    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.organization.findUnique.mock.invocationCallOrder[0],
    );
  });

  it('refuses inside a caller transaction too, without opening its own', async () => {
    const tx = deletedOrgTx();

    await expect(
      createMembership({ ...base, onExisting: 'refuse' }, tx as never),
    ).rejects.toBeInstanceOf(DeletedOrganizationError);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expectNothingWritten(tx);
  });

  it('runs a successful join on the caller transaction without opening its own', async () => {
    const tx = deletedOrgTx();
    tx.organization.findUnique.mockResolvedValue({ deletedAt: null });
    tx.organizationUser.upsert.mockResolvedValue(membershipRow({ role: 'nurse' }));
    tx.organizationUserFacility.upsert.mockResolvedValue({});

    const result = await createMembership(base, tx as never);

    expect(result.role).toBe('nurse');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.organizationUser.upsert).toHaveBeenCalledOnce();
  });
});

// BUG-59: the self-serve join code must never re-role an existing member or
// restore a revoked one.
describe("createMembership({ onExisting: 'refuse' })", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function refuseTx(existing: { active: boolean } | null) {
    const txMock = {
      user: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null }) },
      organization: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      organizationUser: {
        findUnique: vi.fn().mockResolvedValue(existing),
        create: vi.fn().mockResolvedValue(membershipRow({ role: 'nurse' })),
        upsert: vi.fn(),
      },
      organizationUserFacility: { create: vi.fn().mockResolvedValue({}), upsert: vi.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof txMock) => unknown) =>
      cb(txMock),
    );
    return txMock;
  }

  const input = {
    userId: 'user-1',
    organizationId: 'org-1',
    facilityId: 'facility-1',
    role: 'nurse' as const,
    onExisting: 'refuse' as const,
  };

  it('creates a first membership and its facility row', async () => {
    const txMock = refuseTx(null);

    const result = await createMembership(input);

    expect(result.role).toBe('nurse');
    expect(txMock.organizationUser.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: 'user-1', organizationId: 'org-1', role: 'nurse' },
      }),
    );
    expect(txMock.organizationUserFacility.create).toHaveBeenCalledWith({
      data: { organizationUserId: 'ou-1', facilityId: 'facility-1' },
    });
  });

  it.each([
    ['an active', true],
    ['a deactivated', false],
  ])('refuses %s existing membership and writes nothing', async (_label, active) => {
    const txMock = refuseTx({ active });

    const refusal = await createMembership(input).catch((err: unknown) => err);

    expect(refusal).toBeInstanceOf(ExistingMembershipError);
    expect((refusal as ExistingMembershipError).active).toBe(active);
    expect(txMock.organizationUser.create).not.toHaveBeenCalled();
    expect(txMock.organizationUser.upsert).not.toHaveBeenCalled();
    expect(txMock.organizationUserFacility.create).not.toHaveBeenCalled();
    expect(txMock.organizationUserFacility.upsert).not.toHaveBeenCalled();
  });

  it('refuses when a concurrent writer creates the membership first', async () => {
    const txMock = refuseTx(null);
    txMock.organizationUser.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(createMembership(input)).rejects.toBeInstanceOf(ExistingMembershipError);
    expect(txMock.organizationUserFacility.create).not.toHaveBeenCalled();
  });

  it('still refuses a deleted identity (Q-23)', async () => {
    const txMock = refuseTx(null);
    txMock.user.findUnique.mockResolvedValue({ deletedAt: new Date('2026-09-28') });

    await expect(createMembership(input)).rejects.toBeInstanceOf(DeletedIdentityError);
    expect(txMock.organizationUser.create).not.toHaveBeenCalled();
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
