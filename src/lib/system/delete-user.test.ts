/**
 * Q-23 (2026-09-28): deleting a user must KEEP their compliance records.
 *
 * `softDeleteUser` runs against a small in-memory fake of the tables it is
 * allowed to touch. The fake is strict: any model or method the delete is not
 * supposed to use throws, so "no enrollment, certificate, attempt, course or
 * document was deleted or rewritten" is proven by construction rather than by
 * asserting on a handful of mocks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface UserRow {
  id: string;
  email: string;
  deletedAt: Date | null;
  sessionVersion: number;
}
interface MembershipRow {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  active: boolean;
  deactivatedAt: Date | null;
}
interface InviteRow {
  id: string;
  email: string;
  organizationId: string;
  status: 'pending' | 'accepted' | 'expired';
}
interface TokenRow {
  identifier: string;
  token: string;
}

const { db, lockedOrgs, mockAuditCritical, mockInvalidate, mockLogger } = vi.hoisted(() => ({
  lockedOrgs: [] as string[][],
  db: {
    users: [] as UserRow[],
    memberships: [] as MembershipRow[],
    invites: [] as InviteRow[],
    tokens: [] as TokenRow[],
    deletedOrgIds: [] as string[],
  },
  mockAuditCritical: vi.fn(),
  mockInvalidate: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/prisma', () => {
  function strict<T extends object>(name: string, impl: T): T {
    return new Proxy(impl, {
      get(target, prop) {
        if (prop in target) return target[prop as keyof T];
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        throw new Error(`softDeleteUser must not call ${name}.${String(prop)}`);
      },
    });
  }

  const client = strict('prisma', {
    user: strict('user', {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = db.users.find((u) => u.id === where.id);
        return row ? { ...row } : null;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; deletedAt: null };
        data: { deletedAt: Date; sessionVersion: { increment: number } };
      }) => {
        const rows = db.users.filter((u) => u.id === where.id && u.deletedAt === null);
        for (const row of rows) {
          row.deletedAt = data.deletedAt;
          row.sessionVersion += data.sessionVersion.increment;
        }
        return { count: rows.length };
      },
    }),
    organizationUser: strict('organizationUser', {
      findMany: async ({
        where,
      }: {
        where: { userId: string; active?: boolean; organization?: { deletedAt: null } };
      }) =>
        db.memberships
          .filter(
            (m) =>
              m.userId === where.userId &&
              (where.active === undefined || m.active === where.active) &&
              !(
                where.organization?.deletedAt === null &&
                db.deletedOrgIds.includes(m.organizationId)
              ),
          )
          .map((m) => ({
            organizationId: m.organizationId,
            role: m.role,
            organization: { name: m.organizationId.toUpperCase() },
          })),
      count: async ({
        where,
      }: {
        where: { organizationId: string; active: true; userId: { not: string }; role?: string };
      }) =>
        db.memberships.filter(
          (m) =>
            m.organizationId === where.organizationId &&
            m.active &&
            m.userId !== where.userId.not &&
            (where.role === undefined || m.role === where.role),
        ).length,
      updateMany: async ({
        where,
        data,
      }: {
        where: { userId: string; active: true };
        data: { active: false; deactivatedAt: Date };
      }) => {
        const rows = db.memberships.filter((m) => m.userId === where.userId && m.active);
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
    }),
    invite: strict('invite', {
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          email: { equals: string; mode: 'insensitive' };
          organizationId: { in: string[] };
          status: 'pending';
        };
        data: { status: 'expired' };
      }) => {
        const rows = db.invites.filter(
          (i) =>
            i.email.toLowerCase() === where.email.equals.toLowerCase() &&
            where.organizationId.in.includes(i.organizationId) &&
            i.status === where.status,
        );
        for (const row of rows) row.status = data.status;
        return { count: rows.length };
      },
    }),
    verificationToken: strict('verificationToken', {
      deleteMany: async ({ where }: { where: { identifier: string } }) => {
        const before = db.tokens.length;
        db.tokens = db.tokens.filter((t) => t.identifier !== where.identifier);
        return { count: before - db.tokens.length };
      },
    }),
    $queryRaw: async (_sql: TemplateStringsArray, orgIds: string[]) => {
      lockedOrgs.push(orgIds);
      return orgIds.map((id) => ({ id }));
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(client),
  });

  return { prisma: client, default: client };
});
vi.mock('@/lib/audit', () => ({ auditCritical: mockAuditCritical }));
vi.mock('@/lib/auth/session-revalidation-cache', () => ({
  invalidateRevalidationCache: mockInvalidate,
}));
vi.mock('@/lib/logger', () => ({ logger: mockLogger, maskEmail: (e: string) => e }));

import { softDeleteUser } from './delete-user';

const ACTOR = { actorRole: 'system_admin', ip: '203.0.113.9' };

function seed() {
  db.users = [
    { id: 'u-del', email: 'Dana@Example.com', deletedAt: null, sessionVersion: 3 },
    { id: 'u-other', email: 'other@example.com', deletedAt: null, sessionVersion: 0 },
  ];
  db.memberships = [
    {
      id: 'm-a',
      userId: 'u-del',
      organizationId: 'org-a',
      role: 'nurse',
      active: true,
      deactivatedAt: null,
    },
    // A co-owner of org-b survives, so deleting this owner is allowed (Q-30).
    {
      id: 'm-b',
      userId: 'u-del',
      organizationId: 'org-b',
      role: 'owner',
      active: true,
      deactivatedAt: null,
    },
    {
      id: 'm-co',
      userId: 'u-co',
      organizationId: 'org-b',
      role: 'owner',
      active: true,
      deactivatedAt: null,
    },
    // Already removed from org-c by removeStaff earlier: must stay as it was.
    {
      id: 'm-c',
      userId: 'u-del',
      organizationId: 'org-c',
      role: 'owner',
      active: false,
      deactivatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: 'm-other',
      userId: 'u-other',
      organizationId: 'org-a',
      role: 'owner',
      active: true,
      deactivatedAt: null,
    },
  ];
  db.invites = [
    { id: 'inv-own', email: 'dana@example.com', organizationId: 'org-b', status: 'pending' },
    { id: 'inv-own-c', email: 'dana@example.com', organizationId: 'org-c', status: 'pending' },
    { id: 'inv-accepted', email: 'dana@example.com', organizationId: 'org-a', status: 'accepted' },
    // BUG-26: another tenant's invite to the same email is not this delete's business.
    { id: 'inv-foreign', email: 'dana@example.com', organizationId: 'org-z', status: 'pending' },
    { id: 'inv-colleague', email: 'other@example.com', organizationId: 'org-a', status: 'pending' },
  ];
  db.deletedOrgIds = [];
  db.tokens = [
    { identifier: 'Dana@Example.com', token: 'reset-1' },
    { identifier: 'other@example.com', token: 'reset-2' },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  lockedOrgs.length = 0;
  seed();
});

describe('softDeleteUser — Q-23 soft delete', () => {
  it('deactivates every active membership in every organization', async () => {
    const result = await softDeleteUser('u-del', ACTOR);

    expect(result.status).toBe('deleted');
    if (result.status !== 'deleted') return;
    expect(result.membershipsDeactivated).toBe(2);

    const mine = db.memberships.filter((m) => m.userId === 'u-del');
    expect(mine.every((m) => !m.active)).toBe(true);
    expect(db.memberships.find((m) => m.id === 'm-a')?.deactivatedAt).toEqual(result.deletedAt);
    expect(db.memberships.find((m) => m.id === 'm-b')?.deactivatedAt).toEqual(result.deletedAt);
    // A membership removed earlier keeps its original deactivation date.
    expect(db.memberships.find((m) => m.id === 'm-c')?.deactivatedAt).toEqual(
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(db.memberships.find((m) => m.id === 'm-other')?.active).toBe(true);
  });

  it('stamps deletedAt and bumps sessionVersion, then evicts the revalidation cache', async () => {
    const result = await softDeleteUser('u-del', ACTOR);

    const user = db.users.find((u) => u.id === 'u-del');
    expect(user?.deletedAt).toBeInstanceOf(Date);
    expect(user?.sessionVersion).toBe(4);
    expect(result.status === 'deleted' && result.deletedAt).toEqual(user?.deletedAt);
    expect(mockInvalidate).toHaveBeenCalledExactlyOnceWith('u-del');
  });

  it('never touches enrollments, certificates, attempts, courses or documents (strict fake)', async () => {
    // Any call outside user/organizationUser/invite/verificationToken would
    // throw from the strict proxy and fail this delete.
    await expect(softDeleteUser('u-del', ACTOR)).resolves.toMatchObject({ status: 'deleted' });
  });

  it("expires pending invites only from the person's own organizations", async () => {
    const result = await softDeleteUser('u-del', ACTOR);

    const status = (id: string) => db.invites.find((i) => i.id === id)?.status;
    expect(status('inv-own')).toBe('expired');
    expect(status('inv-own-c')).toBe('expired');
    expect(status('inv-accepted')).toBe('accepted');
    expect(status('inv-foreign')).toBe('pending');
    expect(status('inv-colleague')).toBe('pending');
    expect(result.status === 'deleted' && result.invitesExpired).toBe(2);
  });

  it("revokes the person's outstanding verification tokens only", async () => {
    await softDeleteUser('u-del', ACTOR);

    expect(db.tokens).toEqual([{ identifier: 'other@example.com', token: 'reset-2' }]);
  });

  it('writes the audit row inside the transaction with counts only', async () => {
    await softDeleteUser('u-del', ACTOR);

    expect(mockAuditCritical).toHaveBeenCalledTimes(1);
    const [entry, client] = mockAuditCritical.mock.calls[0];
    expect(entry).toEqual({
      action: 'system.user.delete',
      targetType: 'user',
      targetId: 'u-del',
      metadata: {
        mode: 'soft',
        membershipsDeactivated: 2,
        invitesExpired: 2,
        verificationTokensRevoked: 1,
      },
      actorRole: 'system_admin',
      ip: '203.0.113.9',
    });
    expect(client).toBeDefined();
    expect(JSON.stringify(entry)).not.toMatch(/example\.com/i);
  });

  it('is idempotent: a second delete is refused as already deleted and changes nothing', async () => {
    const first = await softDeleteUser('u-del', ACTOR);
    const snapshot = JSON.stringify(db);
    vi.clearAllMocks();

    const second = await softDeleteUser('u-del', ACTOR);

    expect(second).toEqual({
      status: 'already_deleted',
      deletedAt: first.status === 'deleted' ? first.deletedAt : undefined,
    });
    expect(JSON.stringify(db)).toBe(snapshot);
    expect(mockAuditCritical).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('reports not_found for an unknown user', async () => {
    await expect(softDeleteUser('nope', ACTOR)).resolves.toEqual({ status: 'not_found' });
    expect(mockAuditCritical).not.toHaveBeenCalled();
  });

  it('does not evict the cache or report success when the audit write fails', async () => {
    mockAuditCritical.mockRejectedValueOnce(new Error('audit sink down'));

    await expect(softDeleteUser('u-del', ACTOR)).rejects.toThrow('audit sink down');
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});

describe('softDeleteUser — Q-30 never orphan an organization', () => {
  const membership = (id: string, userId: string, org: string, role: string, active = true) => ({
    id,
    userId,
    organizationId: org,
    role,
    active,
    deactivatedAt: null,
  });

  it('refuses a sole owner, names the organization and changes nothing', async () => {
    db.memberships = [
      membership('m1', 'u-del', 'org-a', 'owner'),
      membership('m2', 'u-other', 'org-a', 'nurse'),
      // A deactivated co-owner does not count as an owner left behind.
      membership('m3', 'u-gone', 'org-a', 'owner', false),
    ];
    const snapshot = JSON.stringify(db);

    const result = await softDeleteUser('u-del', ACTOR);

    expect(result).toEqual({
      status: 'blocked',
      blocks: [{ organizationId: 'org-a', organizationName: 'ORG-A', reason: 'sole_owner' }],
      message: 'Transfer ownership of ORG-A before deleting this user.',
    });
    expect(JSON.stringify(db)).toBe(snapshot);
    expect(mockAuditCritical).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('allows deleting an owner when an active co-owner remains', async () => {
    db.memberships = [
      membership('m1', 'u-del', 'org-a', 'owner'),
      membership('m2', 'u-other', 'org-a', 'owner'),
    ];

    await expect(softDeleteUser('u-del', ACTOR)).resolves.toMatchObject({ status: 'deleted' });
  });

  it('refuses deleting the last active member of an organization', async () => {
    db.memberships = [
      membership('m1', 'u-del', 'org-a', 'nurse'),
      membership('m2', 'u-other', 'org-a', 'owner', false),
    ];

    const result = await softDeleteUser('u-del', ACTOR);

    expect(result).toMatchObject({
      status: 'blocked',
      blocks: [{ organizationId: 'org-a', reason: 'last_member' }],
    });
    expect(db.users.find((u) => u.id === 'u-del')?.deletedAt).toBeNull();
  });

  it('names every blocked organization in one refusal', async () => {
    db.memberships = [
      membership('m1', 'u-del', 'org-a', 'owner'),
      membership('m2', 'u-other', 'org-a', 'nurse'),
      membership('m3', 'u-del', 'org-b', 'owner'),
      membership('m4', 'u-del', 'org-c', 'nurse'),
      membership('m5', 'u-other', 'org-c', 'owner'),
    ];

    const result = await softDeleteUser('u-del', ACTOR);

    expect(result.status === 'blocked' && result.message).toBe(
      'Transfer ownership of ORG-A before deleting this user. ' +
        'ORG-B has no other active member. Add an owner there before deleting this user.',
    );
  });

  it('ignores a soft-deleted organization: a sole owner there does not block the delete', async () => {
    db.memberships = [
      membership('m1', 'u-del', 'org-gone', 'owner'),
      membership('m2', 'u-del', 'org-live', 'nurse'),
      membership('m3', 'u-other', 'org-live', 'owner'),
    ];
    db.deletedOrgIds = ['org-gone'];

    await expect(softDeleteUser('u-del', ACTOR)).resolves.toMatchObject({ status: 'deleted' });
  });

  it('still blocks on a LIVE organization when another one is soft-deleted', async () => {
    db.memberships = [
      membership('m1', 'u-del', 'org-gone', 'owner'),
      membership('m2', 'u-del', 'org-live', 'owner'),
      membership('m3', 'u-other', 'org-live', 'nurse'),
    ];
    db.deletedOrgIds = ['org-gone'];

    const result = await softDeleteUser('u-del', ACTOR);

    expect(result).toMatchObject({
      status: 'blocked',
      blocks: [{ organizationId: 'org-live', reason: 'sole_owner' }],
    });
  });

  it("locks the person's organizations before checking, so concurrent co-owner deletes serialise", async () => {
    await softDeleteUser('u-del', ACTOR);

    expect(lockedOrgs).toEqual([['org-a', 'org-b', 'org-c']]);
  });
});
