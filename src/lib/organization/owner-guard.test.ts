/**
 * RISK-16: an organization must always keep an active owner. A user delete
 * (Q-30) and a demotion of the OTHER owner could each pass their own "another
 * owner remains" check at the same moment and leave the organization with
 * none. Both now take the organization lock before checking.
 *
 * The race suite drives the real `softDeleteUser` and `createMembership` (the
 * one path that can re-role an active owner: a join code or an invite accepted
 * by someone who already owns the org) against an in-memory database whose
 * `SELECT … FOR UPDATE` blocks like Postgres does, and whose reads yield to
 * the event loop so an unlocked interleaving really happens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  active: boolean;
  deactivatedAt: Date | null;
}

const { db, lockState } = vi.hoisted(() => ({
  db: {
    users: [] as { id: string; email: string; deletedAt: Date | null }[],
    memberships: [] as Membership[],
  },
  lockState: { enabled: true, queues: new Map<string, Promise<void>>() },
}));

vi.mock('@/lib/prisma', () => {
  const yieldToOthers = () => new Promise((resolve) => setTimeout(resolve, 1));
  // Writes land well after any read, so two unlocked transactions both finish
  // their checks before either one changes anything — the race, made certain.
  const slowWrite = () => new Promise((resolve) => setTimeout(resolve, 20));

  function matches(m: Membership, where: Record<string, unknown>): boolean {
    const not = (key: 'userId' | 'id') =>
      (where[key] as { not?: string } | undefined)?.not !== undefined
        ? m[key] !== (where[key] as { not: string }).not
        : typeof where[key] === 'string'
          ? m[key] === where[key]
          : true;
    return (
      (where.organizationId === undefined || m.organizationId === where.organizationId) &&
      (where.active === undefined || m.active === where.active) &&
      (where.role === undefined || m.role === where.role) &&
      not('userId') &&
      not('id')
    );
  }

  function orgOf(id: string) {
    return { name: `Org ${id}`, slug: id };
  }

  function makeClient(held: (() => void)[]) {
    return {
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          await yieldToOthers();
          const user = db.users.find((u) => u.id === where.id);
          return user ? { ...user } : null;
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; deletedAt: null };
          data: { deletedAt: Date };
        }) => {
          await slowWrite();
          const user = db.users.find((u) => u.id === where.id && u.deletedAt === null);
          if (!user) return { count: 0 };
          user.deletedAt = data.deletedAt;
          return { count: 1 };
        },
      },
      organizationUser: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          await yieldToOthers();
          return db.memberships
            .filter((m) => matches(m, where))
            .map((m) => ({ ...m, organization: orgOf(m.organizationId) }));
        },
        findUnique: async ({
          where,
        }: {
          where: { userId_organizationId: { userId: string; organizationId: string } };
        }) => {
          await yieldToOthers();
          const { userId, organizationId } = where.userId_organizationId;
          const row = db.memberships.find(
            (m) => m.userId === userId && m.organizationId === organizationId,
          );
          return row ? { ...row } : null;
        },
        count: async ({ where }: { where: Record<string, unknown> }) => {
          await yieldToOthers();
          return db.memberships.filter((m) => matches(m, where)).length;
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { userId: string; active: true };
          data: Partial<Membership>;
        }) => {
          await slowWrite();
          const rows = db.memberships.filter((m) => m.userId === where.userId && m.active);
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
        upsert: async ({
          where,
          update,
        }: {
          where: { userId_organizationId: { userId: string; organizationId: string } };
          update: Partial<Membership>;
        }) => {
          await slowWrite();
          const { userId, organizationId } = where.userId_organizationId;
          const row = db.memberships.find(
            (m) => m.userId === userId && m.organizationId === organizationId,
          )!;
          Object.assign(row, update);
          return { ...row, organization: orgOf(row.organizationId) };
        },
      },
      organizationUserFacility: { upsert: async () => ({}) },
      invite: { updateMany: async () => ({ count: 0 }) },
      verificationToken: { deleteMany: async () => ({ count: 0 }) },
      $queryRaw: async (_sql: TemplateStringsArray, orgIds: string[]) => {
        if (!lockState.enabled) return [];
        for (const id of orgIds) {
          const previous = lockState.queues.get(id) ?? Promise.resolve();
          let release!: () => void;
          const mine = new Promise<void>((resolve) => (release = resolve));
          lockState.queues.set(
            id,
            previous.then(() => mine),
          );
          await previous;
          held.push(release);
        }
        return orgIds.map((id) => ({ id }));
      },
    };
  }

  const root = {
    ...makeClient([]),
    // Row locks are released when the transaction ends, committed or not.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const held: (() => void)[] = [];
      try {
        return await fn(makeClient(held));
      } finally {
        for (const release of held) release();
      }
    },
  };
  return { default: root, prisma: root };
});
vi.mock('@/lib/audit', () => ({ auditCritical: vi.fn() }));
vi.mock('@/lib/auth/session-revalidation-cache', () => ({
  invalidateRevalidationCache: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: () => '[masked]',
}));

import { softDeleteUser } from '@/lib/system/delete-user';
import { createMembership } from '@/lib/auth/membership';
import { LastOwnerError, lockOrganizations, wouldLeaveOrganizationOwnerless } from './owner-guard';

function seed() {
  db.users = [
    { id: 'user-a', email: 'a@acme.test', deletedAt: null },
    { id: 'user-b', email: 'b@acme.test', deletedAt: null },
    { id: 'user-n', email: 'n@acme.test', deletedAt: null },
  ];
  const member = (id: string, userId: string, role: string): Membership => ({
    id,
    userId,
    organizationId: 'org-1',
    role,
    active: true,
    deactivatedAt: null,
  });
  db.memberships = [
    member('ou-a', 'user-a', 'owner'),
    member('ou-b', 'user-b', 'owner'),
    member('ou-n', 'user-n', 'nurse'),
  ];
}

const activeOwners = () =>
  db.memberships.filter((m) => m.organizationId === 'org-1' && m.active && m.role === 'owner');

/** Owner A is deleted while owner B re-joins by code as a nurse — at the same moment. */
function race() {
  return Promise.allSettled([
    softDeleteUser('user-a', { actorRole: 'system_admin' }),
    createMembership({
      userId: 'user-b',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      role: 'nurse',
    }),
  ]);
}

beforeEach(() => {
  seed();
  lockState.enabled = true;
  lockState.queues.clear();
});

describe('RISK-16 — a user delete racing a demotion of the other owner', () => {
  it('lets exactly one through and leaves the organization an active owner', async () => {
    const [deleted, demoted] = await race();

    const deleteWon = deleted.status === 'fulfilled' && deleted.value.status === 'deleted';
    const demoteWon = demoted.status === 'fulfilled';
    expect(deleteWon !== demoteWon).toBe(true);
    expect(activeOwners()).toHaveLength(1);

    if (deleteWon) {
      expect(demoted.status === 'rejected' && demoted.reason).toBeInstanceOf(LastOwnerError);
    } else {
      expect(deleted.status === 'fulfilled' && deleted.value.status).toBe('blocked');
    }
  });

  it('is a real race: without the lock both writes pass and the organization is orphaned', async () => {
    lockState.enabled = false;

    const [deleted, demoted] = await race();

    expect(deleted.status === 'fulfilled' && deleted.value.status).toBe('deleted');
    expect(demoted.status).toBe('fulfilled');
    expect(activeOwners()).toHaveLength(0);
  });

  it('still lets an owner re-join as another role while a second owner remains', async () => {
    await createMembership({
      userId: 'user-b',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      role: 'nurse',
    });

    expect(db.memberships.find((m) => m.id === 'ou-b')?.role).toBe('nurse');
    expect(activeOwners().map((m) => m.id)).toEqual(['ou-a']);
  });

  it('refuses to re-role the sole active owner, changing nothing', async () => {
    db.memberships.find((m) => m.id === 'ou-a')!.active = false;

    await expect(
      createMembership({
        userId: 'user-b',
        organizationId: 'org-1',
        facilityId: 'facility-1',
        role: 'nurse',
      }),
    ).rejects.toBeInstanceOf(LastOwnerError);
    expect(db.memberships.find((m) => m.id === 'ou-b')?.role).toBe('owner');
  });
});

describe('lockOrganizations', () => {
  it('locks each organization once, in id order, and skips an empty set', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };

    await lockOrganizations(tx as never, ['org-b', 'org-a', 'org-b']);
    await lockOrganizations(tx as never, []);

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.$queryRaw.mock.calls[0][1]).toEqual(['org-a', 'org-b']);
  });
});

describe('wouldLeaveOrganizationOwnerless', () => {
  const tx = (others: number) => ({
    organizationUser: { count: vi.fn().mockResolvedValue(others) },
  });
  const owner = { id: 'ou-1', organizationId: 'org-1', role: 'owner', active: true };

  it('is true only for an active owner with no other active owner', async () => {
    expect(await wouldLeaveOrganizationOwnerless(tx(0) as never, owner)).toBe(true);
    expect(await wouldLeaveOrganizationOwnerless(tx(1) as never, owner)).toBe(false);
  });

  it('never counts for a non-owner or an already inactive owner', async () => {
    const counter = tx(0);
    expect(
      await wouldLeaveOrganizationOwnerless(counter as never, { ...owner, role: 'admin' }),
    ).toBe(false);
    expect(
      await wouldLeaveOrganizationOwnerless(counter as never, { ...owner, active: false }),
    ).toBe(false);
    expect(counter.organizationUser.count).not.toHaveBeenCalled();
  });

  it('counts the other active owners of the same organization, excluding this row', async () => {
    const counter = tx(1);
    await wouldLeaveOrganizationOwnerless(counter as never, owner);

    expect(counter.organizationUser.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', active: true, role: 'owner', id: { not: 'ou-1' } },
    });
  });
});
