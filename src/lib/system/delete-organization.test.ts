/**
 * Organization soft delete and restore.
 *
 * The lib runs against a small in-memory fake of the tables it touches. The
 * fake is strict: a model, method or `where` key the lib is not supposed to use
 * throws, and `$transaction` rolls the fake back when the callback throws, so
 * "the delete and its audit row commit together", "billing and invites are not
 * touched" and "restore brings back exactly the delete's memberships" are
 * proven against state rather than against a handful of call mocks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  deletedAt: Date | null;
  subscription: { plan: string; status: string; cancelAtPeriodEnd: boolean } | null;
}
interface UserRow {
  id: string;
  deletedAt: Date | null;
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
  organizationId: string;
  status: 'pending' | 'accepted' | 'expired';
}
interface ReminderRow {
  id: string;
  organizationId: string;
  summarizedAt: Date | null;
}
interface EventRow {
  id: string;
  organizationId: string;
  status: 'pending' | 'dispatched' | 'skipped';
}

const { db, trace, mockAuditCritical, mockLogger, retainedCounts, mockGetSeatUsage } = vi.hoisted(
  () => ({
    db: {
      orgs: [] as OrgRow[],
      users: [] as UserRow[],
      memberships: [] as MembershipRow[],
      invites: [] as InviteRow[],
      reminderLogs: [] as ReminderRow[],
      reminderNudges: [] as ReminderRow[],
      events: [] as EventRow[],
      /** When set, the next stamp reports 0 rows but leaves the org deleted at this instant. */
      loseStampRaceTo: null as Date | null,
    },
    trace: [] as string[],
    mockAuditCritical: vi.fn(),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    retainedCounts: {
      course: 7,
      document: 5,
      enrollment: 40,
      certificate: 12,
      quizAttempt: 90,
      facility: 2,
      otherOrgEnrollment: 3,
      otherOrgOffering: 1,
      otherOrgCertificate: 2,
    },
    mockGetSeatUsage: vi.fn(),
  }),
);

vi.mock('@/lib/prisma', () => {
  function strict<T extends object>(name: string, impl: T): T {
    return new Proxy(impl, {
      get(target, prop) {
        if (prop in target) return target[prop as keyof T];
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        throw new Error(`organization soft delete must not call ${name}.${String(prop)}`);
      },
    });
  }

  const sameInstant = (a: Date | null, b: Date | null) =>
    a === null || b === null ? a === b : a.getTime() === b.getTime();

  function unknownKey(model: string, key: string): never {
    throw new Error(`${model} fake does not understand where.${key}`);
  }

  function userMatches(
    userId: string,
    where: {
      deletedAt?: null | { not: null };
      organizationMemberships?: {
        some: {
          organizationId: { not: string };
          active: boolean;
          organization: { deletedAt: null };
        };
      };
    },
  ): boolean {
    const user = db.users.find((u) => u.id === userId)!;
    for (const [key, value] of Object.entries(where)) {
      if (key === 'deletedAt') {
        const expectDeleted = value !== null;
        if ((user.deletedAt !== null) !== expectDeleted) return false;
      } else if (key === 'organizationMemberships') {
        const some = (value as NonNullable<typeof where.organizationMemberships>).some;
        const hit = db.memberships.some(
          (m) =>
            m.userId === userId &&
            m.organizationId !== some.organizationId.not &&
            m.active === some.active &&
            db.orgs.find((o) => o.id === m.organizationId)!.deletedAt === null,
        );
        if (!hit) return false;
      } else {
        unknownKey('user', key);
      }
    }
    return true;
  }

  function membershipMatches(m: MembershipRow, where: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(where)) {
      switch (key) {
        case 'organizationId':
          if (m.organizationId !== value) return false;
          break;
        case 'active':
          if (m.active !== value) return false;
          break;
        case 'role':
          if (m.role !== value) return false;
          break;
        case 'deactivatedAt':
          if (!sameInstant(m.deactivatedAt, value as Date | null)) return false;
          break;
        case 'user':
          if (!userMatches(m.userId, value as Parameters<typeof userMatches>[1])) return false;
          break;
        default:
          unknownKey('organizationUser', key);
      }
    }
    return true;
  }

  const inOrg = (rows: ReminderRow[], where: { summarizedAt: null; enrollment: unknown }) => {
    const orgId = (where.enrollment as { organizationUser: { organizationId: string } })
      .organizationUser.organizationId;
    return rows.filter((r) => r.organizationId === orgId && r.summarizedAt === null);
  };

  const count = (key: keyof typeof retainedCounts) => async () => retainedCounts[key];
  const client = strict('prisma', {
    organization: strict('organization', {
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select: Record<string, unknown>;
      }) => {
        trace.push('read:organization');
        const row = db.orgs.find((o) => o.id === where.id);
        if (!row) return null;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(select)) {
          out[key] = key === 'subscription' ? row.subscription : row[key as keyof OrgRow];
        }
        return out;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; deletedAt: Date | null };
        data: { deletedAt: Date | null };
      }) => {
        const row = db.orgs.find((o) => o.id === where.id);
        if (db.loseStampRaceTo && row) {
          row.deletedAt = db.loseStampRaceTo;
          db.loseStampRaceTo = null;
          return { count: 0 };
        }
        if (!row || !sameInstant(row.deletedAt, where.deletedAt)) return { count: 0 };
        row.deletedAt = data.deletedAt;
        return { count: 1 };
      },
    }),
    organizationUser: strict('organizationUser', {
      count: async ({ where }: { where: Record<string, unknown> }) =>
        db.memberships.filter((m) => membershipMatches(m, where)).length,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: { active: boolean; deactivatedAt: Date | null };
      }) => {
        const rows = db.memberships.filter((m) => membershipMatches(m, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
    }),
    invite: strict('invite', {
      count: async ({ where }: { where: { organizationId: string; status: string } }) =>
        db.invites.filter(
          (i) => i.organizationId === where.organizationId && i.status === where.status,
        ).length,
    }),
    reminderLog: strict('reminderLog', {
      updateMany: async ({
        where,
        data,
      }: {
        where: { summarizedAt: null; enrollment: unknown };
        data: { summarizedAt: Date };
      }) => {
        const rows = inOrg(db.reminderLogs, where);
        for (const row of rows) row.summarizedAt = data.summarizedAt;
        return { count: rows.length };
      },
    }),
    reminderNudge: strict('reminderNudge', {
      updateMany: async ({
        where,
        data,
      }: {
        where: { summarizedAt: null; enrollment: unknown };
        data: { summarizedAt: Date };
      }) => {
        const rows = inOrg(db.reminderNudges, where);
        for (const row of rows) row.summarizedAt = data.summarizedAt;
        return { count: rows.length };
      },
    }),
    notificationEvent: strict('notificationEvent', {
      updateMany: async ({
        where,
        data,
      }: {
        where: { organizationId: string; status: 'pending' };
        data: { status: 'skipped' };
      }) => {
        const rows = db.events.filter(
          (e) => e.organizationId === where.organizationId && e.status === where.status,
        );
        for (const row of rows) row.status = data.status;
        return { count: rows.length };
      },
    }),
    // Preview-only counts: fixed numbers, told apart by what they are scoped to.
    enrollment: strict('enrollment', {
      count: async ({ where }: { where: Record<string, unknown> }) =>
        'course' in where ? retainedCounts.otherOrgEnrollment : retainedCounts.enrollment,
    }),
    certificate: strict('certificate', {
      count: async ({ where }: { where: Record<string, unknown> }) =>
        'course' in where ? retainedCounts.otherOrgCertificate : retainedCounts.certificate,
    }),
    quizAttempt: strict('quizAttempt', { count: count('quizAttempt') }),
    facility: strict('facility', { count: count('facility') }),
    orgCourseOffering: strict('orgCourseOffering', { count: count('otherOrgOffering') }),
    $queryRaw: async (_sql: TemplateStringsArray, orgIds: string[]) => {
      trace.push(`lock:${orgIds.join(',')}`);
      return orgIds.map((id) => ({ id }));
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: async (fn: (tx: any) => Promise<unknown>) => {
      const snapshot = structuredClone({
        orgs: db.orgs,
        users: db.users,
        memberships: db.memberships,
        invites: db.invites,
        reminderLogs: db.reminderLogs,
        reminderNudges: db.reminderNudges,
        events: db.events,
      });
      try {
        return await fn(client);
      } catch (err) {
        Object.assign(db, snapshot);
        throw err;
      }
    },
  });

  return { default: client, prisma: client };
});

vi.mock('@/db/index', () => ({
  rawPrisma: {
    course: { count: async () => retainedCounts.course },
    document: { count: async () => retainedCounts.document },
  },
}));
vi.mock('@/lib/audit', () => ({ auditCritical: mockAuditCritical }));
vi.mock('@/lib/logger', () => ({ logger: mockLogger, maskEmail: (e: string) => e }));
vi.mock('@/lib/seat-limits', () => ({ getSeatUsage: mockGetSeatUsage }));

import {
  previewOrganizationRestore,
  previewOrganizationSoftDelete,
  restoreOrganization,
  softDeleteOrganization,
  RESTORE_WITHOUT_OWNER_REFUSAL,
  SYSTEM_ORGANIZATION_REFUSAL,
} from './delete-organization';

const ACTOR = { actorId: 'sys-1', actorRole: 'system_admin', ip: '203.0.113.9' };
const ORG = 'org-acme';

function membership(
  id: string,
  userId: string,
  role: string,
  overrides: Partial<MembershipRow> = {},
  organizationId = ORG,
): MembershipRow {
  return {
    id,
    userId,
    organizationId,
    role,
    active: true,
    deactivatedAt: null,
    ...overrides,
  };
}

function seed() {
  db.loseStampRaceTo = null;
  db.orgs = [
    {
      id: ORG,
      name: 'Acme Health',
      slug: 'acme-health',
      deletedAt: null,
      subscription: { plan: 'growth', status: 'active', cancelAtPeriodEnd: false },
    },
    { id: 'org-other', name: 'Other Co', slug: 'other-co', deletedAt: null, subscription: null },
    { id: 'org-system', name: 'System', slug: 'system', deletedAt: null, subscription: null },
    {
      id: 'org-gone-2',
      name: 'Gone Two',
      slug: 'gone-two',
      deletedAt: new Date('2026-01-01T00:00:00Z'),
      subscription: null,
    },
  ];
  db.users = [
    { id: 'u-owner', deletedAt: null },
    { id: 'u-nurse', deletedAt: null },
    { id: 'u-multi', deletedAt: null },
    { id: 'u-removed', deletedAt: null },
    { id: 'u-erased', deletedAt: null },
    { id: 'u-solo', deletedAt: null },
  ];
  db.memberships = [
    membership('m-owner', 'u-owner', 'owner'),
    membership('m-nurse', 'u-nurse', 'nurse'),
    membership('m-multi', 'u-multi', 'nurse'),
    membership('m-multi-other', 'u-multi', 'nurse', {}, 'org-other'),
    // Removed by an admin long before any org delete — must stay removed on restore.
    membership('m-removed', 'u-removed', 'nurse', {
      active: false,
      deactivatedAt: new Date('2026-03-01T00:00:00Z'),
    }),
    membership('m-erased', 'u-erased', 'nurse'),
    membership('m-solo-gone', 'u-solo', 'nurse', {}, 'org-gone-2'),
  ];
  db.invites = [
    { id: 'inv-1', organizationId: ORG, status: 'pending' },
    { id: 'inv-2', organizationId: ORG, status: 'pending' },
    { id: 'inv-done', organizationId: ORG, status: 'accepted' },
    { id: 'inv-other', organizationId: 'org-other', status: 'pending' },
  ];
  db.reminderLogs = [
    { id: 'rl-1', organizationId: ORG, summarizedAt: null },
    { id: 'rl-done', organizationId: ORG, summarizedAt: new Date('2026-09-01T00:00:00Z') },
    { id: 'rl-other', organizationId: 'org-other', summarizedAt: null },
  ];
  db.reminderNudges = [
    { id: 'rn-1', organizationId: ORG, summarizedAt: null },
    { id: 'rn-other', organizationId: 'org-other', summarizedAt: null },
  ];
  db.events = [
    { id: 'ev-1', organizationId: ORG, status: 'pending' },
    { id: 'ev-2', organizationId: ORG, status: 'pending' },
    { id: 'ev-sent', organizationId: ORG, status: 'dispatched' },
    { id: 'ev-other', organizationId: 'org-other', status: 'pending' },
  ];
}

const org = (id = ORG) => db.orgs.find((o) => o.id === id)!;
const mem = (id: string) => db.memberships.find((m) => m.id === id)!;

beforeEach(() => {
  vi.clearAllMocks();
  trace.length = 0;
  seed();
  mockGetSeatUsage.mockResolvedValue({ staffMax: null, planName: null, current: 0 });
  mockAuditCritical.mockResolvedValue(undefined);
});

describe('softDeleteOrganization', () => {
  it('stamps deletedAt and deactivates the active memberships with the SAME instant', async () => {
    const result = await softDeleteOrganization(ORG, ACTOR);

    expect(result.status).toBe('deleted');
    const stamp = org().deletedAt!;
    expect(stamp).toBeInstanceOf(Date);
    for (const id of ['m-owner', 'm-nurse', 'm-multi', 'm-erased']) {
      expect(mem(id).active).toBe(false);
      // The restore contract: equality with the org's deletedAt, to the millisecond.
      expect(mem(id).deactivatedAt!.getTime()).toBe(stamp.getTime());
    }
    expect(result.status === 'deleted' && result.organization.deletedAt).toEqual(stamp);
  });

  it('leaves a previously removed member and every other organization untouched', async () => {
    const before = structuredClone({
      removed: mem('m-removed'),
      other: mem('m-multi-other'),
      gone2: mem('m-solo-gone'),
    });

    await softDeleteOrganization(ORG, ACTOR);

    expect(mem('m-removed')).toEqual(before.removed);
    expect(mem('m-multi-other')).toEqual(before.other);
    expect(mem('m-solo-gone')).toEqual(before.gone2);
    expect(org('org-other').deletedAt).toBeNull();
  });

  it('leaves pending invites pending and does not touch billing', async () => {
    await softDeleteOrganization(ORG, ACTOR);

    expect(db.invites.filter((i) => i.status === 'pending').map((i) => i.id)).toEqual([
      'inv-1',
      'inv-2',
      'inv-other',
    ]);
    expect(org().subscription).toEqual({
      plan: 'growth',
      status: 'active',
      cancelAtPeriodEnd: false,
    });
  });

  it('retires only this organization unsummarized reminder rows and skips only its pending events', async () => {
    const result = await softDeleteOrganization(ORG, ACTOR);
    const stamp = org().deletedAt!;

    expect(db.reminderLogs.find((r) => r.id === 'rl-1')!.summarizedAt).toEqual(stamp);
    expect(db.reminderNudges.find((r) => r.id === 'rn-1')!.summarizedAt).toEqual(stamp);
    // Already summarized: not re-stamped. Another tenant: not touched.
    expect(db.reminderLogs.find((r) => r.id === 'rl-done')!.summarizedAt).toEqual(
      new Date('2026-09-01T00:00:00Z'),
    );
    expect(db.reminderLogs.find((r) => r.id === 'rl-other')!.summarizedAt).toBeNull();
    expect(db.reminderNudges.find((r) => r.id === 'rn-other')!.summarizedAt).toBeNull();
    expect(db.events.map((e) => [e.id, e.status])).toEqual([
      ['ev-1', 'skipped'],
      ['ev-2', 'skipped'],
      ['ev-sent', 'dispatched'],
      ['ev-other', 'pending'],
    ]);
    expect(result).toMatchObject({
      status: 'deleted',
      membershipsDeactivated: 4,
      pendingInvites: 2,
      remindersRetired: 2,
      eventsSkipped: 2,
    });
  });

  it('writes one audit row with ids and counts only, inside the transaction', async () => {
    await softDeleteOrganization(ORG, ACTOR);

    expect(mockAuditCritical).toHaveBeenCalledOnce();
    const [entry, tx] = mockAuditCritical.mock.calls[0];
    expect(entry).toEqual({
      action: 'system.org.soft_delete',
      targetType: 'organization',
      targetId: ORG,
      organizationId: ORG,
      metadata: {
        mode: 'soft',
        membershipsDeactivated: 4,
        pendingInvites: 2,
        remindersRetired: 2,
        eventsSkipped: 2,
      },
      ...ACTOR,
    });
    expect(tx).toBeDefined();
    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain('Acme Health');
    expect(serialised).not.toContain('@');
  });

  it('takes the organization lock before it reads the organization', async () => {
    await softDeleteOrganization(ORG, ACTOR);

    expect(trace[0]).toBe(`lock:${ORG}`);
    expect(trace.indexOf('read:organization')).toBeGreaterThan(0);
  });

  it('is idempotent: a second delete reports already_deleted, changes nothing and writes no audit row', async () => {
    const first = await softDeleteOrganization(ORG, ACTOR);
    mockAuditCritical.mockClear();
    const snapshot = JSON.stringify(db);

    const second = await softDeleteOrganization(ORG, ACTOR);

    expect(first.status).toBe('deleted');
    expect(second).toEqual({ status: 'already_deleted', deletedAt: org().deletedAt });
    expect(JSON.stringify(db)).toBe(snapshot);
    expect(mockAuditCritical).not.toHaveBeenCalled();
  });

  it('loses a stamp race cleanly: reports already_deleted with the winner instant, no audit row', async () => {
    const winner = new Date('2026-10-08T09:00:00Z');
    db.loseStampRaceTo = winner;

    const result = await softDeleteOrganization(ORG, ACTOR);

    expect(result).toEqual({ status: 'already_deleted', deletedAt: winner });
    expect(mockAuditCritical).not.toHaveBeenCalled();
    expect(mem('m-owner').active).toBe(true);
  });

  it('refuses the internal System organization and changes nothing', async () => {
    const snapshot = JSON.stringify(db);

    const result = await softDeleteOrganization('org-system', ACTOR);

    expect(result).toEqual({ status: 'refused', message: SYSTEM_ORGANIZATION_REFUSAL });
    expect(JSON.stringify(db)).toBe(snapshot);
    expect(mockAuditCritical).not.toHaveBeenCalled();
  });

  it('reports not_found for an unknown id', async () => {
    await expect(softDeleteOrganization('org-missing', ACTOR)).resolves.toEqual({
      status: 'not_found',
    });
    expect(mockAuditCritical).not.toHaveBeenCalled();
  });

  it('rolls the whole delete back when the audit write fails (no half-deleted organization)', async () => {
    mockAuditCritical.mockRejectedValue(new Error('audit sink down'));
    const snapshot = JSON.stringify(db);

    await expect(softDeleteOrganization(ORG, ACTOR)).rejects.toThrow('audit sink down');

    expect(JSON.stringify(db)).toBe(snapshot);
    expect(org().deletedAt).toBeNull();
    expect(mem('m-owner').active).toBe(true);
  });
});

describe('restoreOrganization', () => {
  it('reactivates the memberships the delete deactivated and clears deletedAt', async () => {
    await softDeleteOrganization(ORG, ACTOR);

    const result = await restoreOrganization(ORG, ACTOR);

    expect(result).toMatchObject({
      status: 'restored',
      membershipsReactivated: 4,
      skippedDeletedUsers: 0,
    });
    expect(org().deletedAt).toBeNull();
    for (const id of ['m-owner', 'm-nurse', 'm-multi', 'm-erased']) {
      expect(mem(id)).toMatchObject({ active: true, deactivatedAt: null });
    }
  });

  it('does not reactivate a member an administrator had removed before the delete', async () => {
    await softDeleteOrganization(ORG, ACTOR);

    await restoreOrganization(ORG, ACTOR);

    expect(mem('m-removed')).toMatchObject({
      active: false,
      deactivatedAt: new Date('2026-03-01T00:00:00Z'),
    });
  });

  it('skips members whose identity has since been deleted, and counts them', async () => {
    await softDeleteOrganization(ORG, ACTOR);
    db.users.find((u) => u.id === 'u-erased')!.deletedAt = new Date('2026-10-09T00:00:00Z');

    const result = await restoreOrganization(ORG, ACTOR);

    expect(result).toMatchObject({
      status: 'restored',
      membershipsReactivated: 3,
      skippedDeletedUsers: 1,
    });
    expect(mem('m-erased').active).toBe(false);
  });

  it('skips a member individually deactivated AFTER the org was deleted (different instant)', async () => {
    await softDeleteOrganization(ORG, ACTOR);
    mem('m-nurse').deactivatedAt = new Date(org().deletedAt!.getTime() + 5000);

    const result = await restoreOrganization(ORG, ACTOR);

    expect(result).toMatchObject({ status: 'restored', membershipsReactivated: 3 });
    expect(mem('m-nurse').active).toBe(false);
  });

  it('delete then restore round-trips the membership state exactly', async () => {
    const before = structuredClone(db.memberships);

    await softDeleteOrganization(ORG, ACTOR);
    await restoreOrganization(ORG, ACTOR);

    expect(db.memberships).toEqual(before);
  });

  it('is blocked, changing nothing, when no active owner would result', async () => {
    mem('m-owner').role = 'admin';
    await softDeleteOrganization(ORG, ACTOR);
    mockAuditCritical.mockClear();
    const snapshot = JSON.stringify(db);

    const result = await restoreOrganization(ORG, ACTOR);

    expect(result).toEqual({ status: 'blocked', message: RESTORE_WITHOUT_OWNER_REFUSAL });
    expect(JSON.stringify(db)).toBe(snapshot);
    expect(mockAuditCritical).not.toHaveBeenCalled();
  });

  it('is blocked when the only owner has since had their identity deleted', async () => {
    await softDeleteOrganization(ORG, ACTOR);
    db.users.find((u) => u.id === 'u-owner')!.deletedAt = new Date('2026-10-09T00:00:00Z');

    const result = await restoreOrganization(ORG, ACTOR);

    expect(result.status).toBe('blocked');
    expect(org().deletedAt).not.toBeNull();
  });

  it('reports not_deleted for a live organization and writes nothing', async () => {
    const snapshot = JSON.stringify(db);

    const result = await restoreOrganization(ORG, ACTOR);

    expect(result).toEqual({ status: 'not_deleted' });
    expect(JSON.stringify(db)).toBe(snapshot);
    expect(mockAuditCritical).not.toHaveBeenCalled();
  });

  it('reports not_found for an unknown id', async () => {
    await expect(restoreOrganization('org-missing', ACTOR)).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('writes one audit row with counts only, inside the transaction', async () => {
    await softDeleteOrganization(ORG, ACTOR);
    mockAuditCritical.mockClear();

    await restoreOrganization(ORG, ACTOR);

    expect(mockAuditCritical).toHaveBeenCalledOnce();
    const [entry, tx] = mockAuditCritical.mock.calls[0];
    expect(entry).toEqual({
      action: 'system.org.restore',
      targetType: 'organization',
      targetId: ORG,
      organizationId: ORG,
      metadata: { membershipsReactivated: 4, skippedDeletedUsers: 0 },
      ...ACTOR,
    });
    expect(tx).toBeDefined();
  });

  it('takes the organization lock before reading', async () => {
    await softDeleteOrganization(ORG, ACTOR);
    trace.length = 0;

    await restoreOrganization(ORG, ACTOR);

    expect(trace[0]).toBe(`lock:${ORG}`);
  });

  it('rolls the restore back when the audit write fails', async () => {
    await softDeleteOrganization(ORG, ACTOR);
    mockAuditCritical.mockRejectedValue(new Error('audit sink down'));
    const snapshot = JSON.stringify(db);

    await expect(restoreOrganization(ORG, ACTOR)).rejects.toThrow('audit sink down');

    expect(JSON.stringify(db)).toBe(snapshot);
    expect(org().deletedAt).not.toBeNull();
  });
});

describe('previewOrganizationSoftDelete', () => {
  it('summarises members, owners, multi-org members, pending invites and the subscription', async () => {
    const preview = await previewOrganizationSoftDelete(ORG);

    expect(preview).toMatchObject({
      organization: { id: ORG, name: 'Acme Health', slug: 'acme-health', deletedAt: null },
      refusal: null,
      members: { active: 4, owners: 1, alsoInOtherLiveOrgs: 1 },
      pendingInvites: 2,
      subscription: { plan: 'growth', status: 'active', cancelAtPeriodEnd: false },
      retained: {
        courses: 7,
        documents: 5,
        enrollments: 40,
        certificates: 12,
        quizAttempts: 90,
        facilities: 2,
      },
      usedByOtherOrgs: { enrollments: 3, offerings: 1, certificates: 2 },
    });
  });

  it('does not count a member whose other organization is itself soft-deleted as keeping access', async () => {
    db.memberships.push(membership('m-erased-2', 'u-erased', 'nurse', {}, 'org-gone-2'));

    const preview = await previewOrganizationSoftDelete(ORG);

    expect(preview!.members.alsoInOtherLiveOrgs).toBe(1);
  });

  it('carries the System-organization refusal', async () => {
    const preview = await previewOrganizationSoftDelete('org-system');

    expect(preview!.refusal).toBe(SYSTEM_ORGANIZATION_REFUSAL);
  });

  it('is null for an unknown id and reports no subscription when there is none', async () => {
    await expect(previewOrganizationSoftDelete('org-missing')).resolves.toBeNull();
    const preview = await previewOrganizationSoftDelete('org-other');
    expect(preview!.subscription).toBeNull();
  });
});

describe('previewOrganizationRestore', () => {
  it('counts what a restore would bring back and what it would skip', async () => {
    await softDeleteOrganization(ORG, ACTOR);
    db.users.find((u) => u.id === 'u-erased')!.deletedAt = new Date('2026-10-09T00:00:00Z');

    const preview = await previewOrganizationRestore(ORG);

    expect(preview).toMatchObject({
      membersToReactivate: 3,
      skippedDeletedUsers: 1,
      ownersAfterRestore: 1,
      seatWarning: null,
      blockedReason: null,
    });
  });

  it('computes the seat warning against the plan limit and still allows the restore', async () => {
    await softDeleteOrganization(ORG, ACTOR);
    mockGetSeatUsage.mockResolvedValue({ staffMax: 2, planName: 'Starter', current: 0 });

    const preview = await previewOrganizationRestore(ORG);

    expect(preview).toMatchObject({
      membersToReactivate: 4,
      seatWarning: { used: 4, max: 2, over: 2 },
      blockedReason: null,
    });
  });

  it('shows no seat warning exactly at the limit', async () => {
    await softDeleteOrganization(ORG, ACTOR);
    mockGetSeatUsage.mockResolvedValue({ staffMax: 4, planName: 'Growth', current: 0 });

    const preview = await previewOrganizationRestore(ORG);

    expect(preview!.seatWarning).toBeNull();
  });

  it('reports the owner block when no active owner would remain', async () => {
    mem('m-owner').role = 'admin';
    await softDeleteOrganization(ORG, ACTOR);

    const preview = await previewOrganizationRestore(ORG);

    expect(preview).toMatchObject({
      ownersAfterRestore: 0,
      blockedReason: RESTORE_WITHOUT_OWNER_REFUSAL,
    });
  });

  it('answers a live organization with nothing to restore and no block', async () => {
    const preview = await previewOrganizationRestore(ORG);

    expect(preview).toMatchObject({
      membersToReactivate: 0,
      blockedReason: null,
      organization: { deletedAt: null },
    });
  });

  it('is null for an unknown id', async () => {
    await expect(previewOrganizationRestore('org-missing')).resolves.toBeNull();
  });
});
