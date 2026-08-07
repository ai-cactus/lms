/**
 * Unit tests for resolveRoleRecipients — the escalation-pathway resolver
 * (§2.2): resolve a target role to its holders (active memberships only) in an
 * org, falling back to the (deterministically oldest) owner when nobody holds
 * the role.
 *
 * Covers: role present / absent→oldest-owner (tie-break by id) / zero owners /
 * actor excluded / actor-is-sole-owner / no-fallback → missingRoles.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockLoggerInfo, mockLoggerError } = vi.hoisted(() => ({
  prismaMock: {
    organizationUser: { findMany: vi.fn(), findFirst: vi.fn() },
  },
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: mockLoggerInfo, warn: vi.fn(), error: mockLoggerError, debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { resolveRoleRecipients } from './recipients';

/**
 * Builds a membership row. `id` doubles as the membership's underlying global
 * `userId` in these fixtures (this suite never distinguishes the two), since
 * actor exclusion (`excludeUserIds`) matches on `userId`, not the membership id.
 */
function holder(id: string, role: string, opts: { name?: string | null } = {}) {
  return { id, userId: id, role, user: { email: `${id}@acme.com`, fullName: opts.name ?? null } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveRoleRecipients — guard clauses', () => {
  it('returns the empty result immediately for a blank organizationId, without querying', async () => {
    const result = await resolveRoleRecipients('', ['hr']);
    expect(result).toEqual({
      organizationUserIds: [],
      emails: [],
      usedFallback: false,
      missingRoles: [],
    });
    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
  });

  it('returns the empty result immediately for an empty targetRoles array', async () => {
    const result = await resolveRoleRecipients('org-1', []);
    expect(result).toEqual({
      organizationUserIds: [],
      emails: [],
      usedFallback: false,
      missingRoles: [],
    });
    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
  });
});

describe('resolveRoleRecipients — role holders present', () => {
  it('returns every holder of the target role, usedFallback: false, no missingRoles', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([
      holder('hr-1', 'hr', { name: 'Hana R' }),
      holder('hr-2', 'hr'),
    ]);

    const result = await resolveRoleRecipients('org-1', ['hr'], { fallbackToOwner: true });

    expect(result.organizationUserIds).toEqual(['hr-1', 'hr-2']);
    expect(result.emails).toEqual([
      { organizationUserId: 'hr-1', userId: 'hr-1', email: 'hr-1@acme.com', name: 'Hana R' },
      { organizationUserId: 'hr-2', userId: 'hr-2', email: 'hr-2@acme.com', name: null },
    ]);
    expect(result.usedFallback).toBe(false);
    expect(result.missingRoles).toEqual([]);
    expect(prismaMock.organizationUser.findFirst).not.toHaveBeenCalled();
  });

  it('queries active memberships scoped to the organization and the target roles, ordered createdAt asc then id asc', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([]);

    await resolveRoleRecipients('org-1', ['hr', 'clinical_director']);

    expect(prismaMock.organizationUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', role: { in: ['hr', 'clinical_director'] }, active: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });
});

describe('resolveRoleRecipients — actor exclusion', () => {
  it('excludes the actor from the returned recipients when they hold the target role', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([
      holder('hr-1', 'hr'),
      holder('hr-2', 'hr'),
    ]);

    const result = await resolveRoleRecipients('org-1', ['hr'], { excludeUserIds: ['hr-1'] });

    expect(result.organizationUserIds).toEqual(['hr-2']);
  });

  it('an actor who is the ONLY role-holder yields zero recipients WITHOUT triggering owner fallback', async () => {
    // Regression: exclusion happens AFTER the role-coverage check, so this must
    // NOT be treated as "nobody holds the role" (which would trigger fallback).
    prismaMock.organizationUser.findMany.mockResolvedValue([holder('hr-1', 'hr')]);

    const result = await resolveRoleRecipients('org-1', ['hr'], {
      fallbackToOwner: true,
      excludeUserIds: ['hr-1'],
    });

    expect(result.organizationUserIds).toEqual([]);
    expect(result.usedFallback).toBe(false);
    expect(result.missingRoles).toEqual([]);
    expect(prismaMock.organizationUser.findFirst).not.toHaveBeenCalled();
  });

  it('ignores null/undefined entries in excludeUserIds', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([holder('hr-1', 'hr')]);

    const result = await resolveRoleRecipients('org-1', ['hr'], {
      excludeUserIds: [null, undefined, 'someone-else'],
    });

    expect(result.organizationUserIds).toEqual(['hr-1']);
  });
});

describe('resolveRoleRecipients — owner fallback (no role holders)', () => {
  it('falls back to the oldest owner (createdAt asc) when nobody holds the role and fallback is enabled', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.findFirst.mockResolvedValue(
      holder('owner-1', 'owner', { name: 'Old Owner' }),
    );

    const result = await resolveRoleRecipients('org-1', ['hr'], { fallbackToOwner: true });

    expect(result.organizationUserIds).toEqual(['owner-1']);
    expect(result.usedFallback).toBe(true);
    expect(result.missingRoles).toEqual(['hr']);
    expect(prismaMock.organizationUser.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', role: 'owner', active: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('the owner query itself is tie-broken by id asc for determinism (multi-owner orgs)', async () => {
    // We don't fabricate a tie here (the DB does that via orderBy) — this pins
    // that the resolver relies on the DB ordering rather than re-sorting, so a
    // future refactor can't silently drop the id tie-break.
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.findFirst.mockResolvedValue(holder('owner-a', 'owner'));

    await resolveRoleRecipients('org-1', ['hr'], { fallbackToOwner: true });

    const orderBy = prismaMock.organizationUser.findFirst.mock.calls[0][0].orderBy;
    expect(orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('excludes the owner from fallback recipients when the owner IS the actor', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.findFirst.mockResolvedValue(holder('owner-1', 'owner'));

    const result = await resolveRoleRecipients('org-1', ['hr'], {
      fallbackToOwner: true,
      excludeUserIds: ['owner-1'],
    });

    expect(result.organizationUserIds).toEqual([]);
    // Still correctly flagged as a fallback scenario for the caller's meta-alert logic.
    expect(result.usedFallback).toBe(true);
    expect(result.missingRoles).toEqual(['hr']);
  });

  it('returns empty recipients + missingRoles, no fallback query, when fallbackToOwner is false', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([]);

    const result = await resolveRoleRecipients('org-1', ['hr']);

    expect(result).toEqual({
      organizationUserIds: [],
      emails: [],
      usedFallback: false,
      missingRoles: ['hr'],
    });
    expect(prismaMock.organizationUser.findFirst).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('No role holders and no owner fallback'),
      }),
    );
  });

  it('logs an error and returns empty when the organization has no owner at all (dead end)', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.findFirst.mockResolvedValue(null);

    const result = await resolveRoleRecipients('org-1', ['hr'], { fallbackToOwner: true });

    expect(result).toEqual({
      organizationUserIds: [],
      emails: [],
      usedFallback: false,
      missingRoles: ['hr'],
    });
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('Escalation dead end'),
      }),
    );
  });
});

describe('resolveRoleRecipients — missingRoles with partial coverage', () => {
  it('reports only the target roles nobody holds, when some but not all are covered', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([holder('cd-1', 'clinical_director')]);

    const result = await resolveRoleRecipients('org-1', ['hr', 'clinical_director'], {
      fallbackToOwner: true,
    });

    // holders.length > 0, so we return the covered role's holder(s) directly —
    // no fallback query even though 'hr' itself is missing.
    expect(result.organizationUserIds).toEqual(['cd-1']);
    expect(result.usedFallback).toBe(false);
    expect(result.missingRoles).toEqual(['hr']);
    expect(prismaMock.organizationUser.findFirst).not.toHaveBeenCalled();
  });
});

describe('resolveRoleRecipients — deactivated memberships', () => {
  it('scopes the owner-fallback query to active memberships only', async () => {
    // Query-level filter (active: true), verified directly since the mock
    // controls what findFirst "returns" rather than filtering in JS.
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.findFirst.mockResolvedValue(null);

    await resolveRoleRecipients('org-1', ['hr'], { fallbackToOwner: true });

    expect(prismaMock.organizationUser.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ active: true }) }),
    );
  });
});
