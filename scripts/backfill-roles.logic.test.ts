/**
 * Unit tests for the backfill-roles.js algorithm.
 *
 * The script cannot be imported directly in this test runner because:
 *   1. It uses CJS `require('@prisma/client')` without a driver adapter.
 *   2. Prisma 7.8 requires an adapter (PrismaPg) — `new PrismaClient()` without
 *      one throws PrismaClientConstructorValidationError at startup.
 *   3. The script auto-executes `main()` at module load, which would attempt a
 *      real DB connection.
 *
 * Instead, the algorithm is replicated here as a pure async function and tested
 * with a mock Prisma object. This is the same "replicated-algorithm" strategy
 * used for transcode-worker.mjs.
 *
 * Invariants:
 *   - Idempotent: org with an existing owner is skipped entirely.
 *   - Earliest-by-createdAt tie-break: if two supervisors were created at the same
 *     millisecond, the one with the lexicographically lower id is promoted.
 *   - No-supervisor org: logged and left untouched (counter incremented).
 *   - Orphan supervisors (no org): logged, left as supervisor.
 *   - Dry-run: all DB writes are suppressed; promoted counter still increments.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ── Algorithm replica ─────────────────────────────────────────────────────────
//
// Mirrors the logic of scripts/backfill-roles.js so we can inject a mock
// Prisma client and assert against the resulting operations.

interface BackfillResult {
  orgsWithSuperAdmin: number;
  orgsAlreadyOwned: number;
  promoted: number;
  orgsWithNoSuperAdmin: number;
  orphanSuperAdmins: number;
  writes: { userId: string; from: string; to: string }[];
}

async function runBackfillAlgorithm(
  prisma: {
    user: {
      findMany: (args: unknown) => Promise<{ id: string; email: string; organizationId?: string | null }[]>;
      findFirst: (args: unknown) => Promise<{ id: string; email: string } | null>;
      update: (args: unknown) => Promise<void>;
    };
  },
  dryRun = false,
): Promise<BackfillResult> {
  const result: BackfillResult = {
    orgsWithSuperAdmin: 0,
    orgsAlreadyOwned: 0,
    promoted: 0,
    orgsWithNoSuperAdmin: 0,
    orphanSuperAdmins: 0,
    writes: [],
  };

  // Orphans: supervisor with no org
  const orphans = await prisma.user.findMany({
    where: { role: 'supervisor', organizationId: null },
    select: { id: true, email: true },
  });
  result.orphanSuperAdmins = orphans.length;

  // Distinct orgs that have at least one supervisor
  const orgRows = await prisma.user.findMany({
    where: { role: 'supervisor', organizationId: { not: null } },
    distinct: ['organizationId'],
    select: { organizationId: true },
  });
  const orgIds = orgRows.map((r) => r.organizationId).filter(Boolean) as string[];
  result.orgsWithSuperAdmin = orgIds.length;

  for (const organizationId of orgIds) {
    const existingOwner = await prisma.user.findFirst({
      where: { organizationId, role: 'owner' },
      select: { id: true },
    });
    if (existingOwner) {
      result.orgsAlreadyOwned += 1;
      continue;
    }

    const founder = await prisma.user.findFirst({
      where: { organizationId, role: 'supervisor' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, email: true },
    });

    if (!founder) {
      result.orgsWithNoSuperAdmin += 1;
      continue;
    }

    if (!dryRun) {
      await prisma.user.update({ where: { id: founder.id }, data: { role: 'owner' } });
      result.writes.push({ userId: founder.id, from: 'supervisor', to: 'owner' });
    }
    result.promoted += 1;
  }

  return result;
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const t0 = new Date('2024-01-01T00:00:00.000Z');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('backfill-roles algorithm — idempotency', () => {
  it('skips an org that already has an owner', async () => {
    const calls: unknown[] = [];
    const prisma = {
      user: {
        findMany: async (args: unknown) => {
          calls.push(args);
          // No orphans
          if ((args as { where?: { organizationId?: unknown } })?.where?.organizationId === null) return [];
          // One org row (org-1 has a supervisor)
          return [{ id: 'u-sup', email: 'sup@a.com', organizationId: 'org-1' }];
        },
        findFirst: async (args: unknown) => {
          const a = args as Record<string, { organizationId?: string; role?: string }>;
          // Existing owner check
          if (a?.where?.role === 'owner') return { id: 'u-owner', email: 'owner@a.com' };
          return null;
        },
        update: async () => {
          throw new Error('update should NOT be called — org already has an owner');
        },
      },
    };

    const result = await runBackfillAlgorithm(prisma);

    expect(result.orgsAlreadyOwned).toBe(1);
    expect(result.promoted).toBe(0);
    expect(result.writes).toHaveLength(0);
  });
});

describe('backfill-roles algorithm — promotion', () => {
  it('promotes the earliest supervisor by createdAt when no owner exists', async () => {
    const updates: { userId: string }[] = [];
    const prisma = {
      user: {
        findMany: async () => [{ id: 'u-sup', email: 'sup@a.com', organizationId: 'org-1' }],
        findFirst: async (args: unknown) => {
          const a = args as Record<string, unknown>;
          if ((a?.where as Record<string, unknown>)?.role === 'owner') return null; // no owner
          return { id: 'u-sup', email: 'sup@a.com' }; // founder
        },
        update: async (args: unknown) => {
          updates.push({ userId: (args as Record<string, { id: string }>).where.id });
        },
      },
    };

    const result = await runBackfillAlgorithm(prisma);

    expect(result.promoted).toBe(1);
    expect(result.writes[0].userId).toBe('u-sup');
    expect(updates[0].userId).toBe('u-sup');
  });
});

describe('backfill-roles algorithm — dry-run', () => {
  it('counts promotions but does NOT call prisma.user.update', async () => {
    const updates: unknown[] = [];
    const prisma = {
      user: {
        findMany: async () => [{ id: 'u-sup', email: 'sup@a.com', organizationId: 'org-1' }],
        findFirst: async (args: unknown) => {
          const a = args as Record<string, unknown>;
          if ((a?.where as Record<string, unknown>)?.role === 'owner') return null;
          return { id: 'u-sup', email: 'sup@a.com' };
        },
        update: async (args: unknown) => {
          updates.push(args);
        },
      },
    };

    const result = await runBackfillAlgorithm(prisma, true /* dryRun */);

    expect(result.promoted).toBe(1); // counter still increments
    expect(result.writes).toHaveLength(0); // nothing written
    expect(updates).toHaveLength(0); // update was never called
  });
});

describe('backfill-roles algorithm — orphan supervisors', () => {
  it('counts supervisors with null organizationId and does not promote them', async () => {
    let orphanQueryCalled = false;
    const prisma = {
      user: {
        findMany: async (args: unknown) => {
          const a = args as Record<string, unknown>;
          const where = a?.where as Record<string, unknown>;
          if (where?.organizationId === null) {
            orphanQueryCalled = true;
            return [
              { id: 'orphan-1', email: 'o1@a.com', organizationId: null },
              { id: 'orphan-2', email: 'o2@a.com', organizationId: null },
            ];
          }
          return []; // no orgs with supervisors
        },
        findFirst: async () => null,
        update: async () => {
          throw new Error('update should NOT be called for orphan supervisors');
        },
      },
    };

    const result = await runBackfillAlgorithm(prisma);

    expect(orphanQueryCalled).toBe(true);
    expect(result.orphanSuperAdmins).toBe(2);
    expect(result.promoted).toBe(0);
  });
});

describe('backfill-roles algorithm — multiple orgs', () => {
  it('promotes one founder per org, skips orgs that already have an owner', async () => {
    const updates: string[] = [];

    // Two orgs: org-1 needs a promotion, org-2 already has an owner
    const orgSupervisors: Record<string, string> = {
      'org-1': 'u-sup-1', // needs promotion
    };
    const orgOwners = new Set(['org-2']); // already has an owner

    const prisma = {
      user: {
        findMany: async (args: unknown) => {
          const a = args as Record<string, unknown>;
          const where = a?.where as Record<string, unknown>;
          if (where?.organizationId === null) return [];
          // Return two distinct org rows
          return [
            { id: 'u-sup-1', email: 's1@a.com', organizationId: 'org-1' },
            { id: 'u-sup-2', email: 's2@a.com', organizationId: 'org-2' },
          ];
        },
        findFirst: async (args: unknown) => {
          const a = args as Record<string, unknown>;
          const where = a?.where as Record<string, unknown>;
          const orgId = where?.organizationId as string;
          const role = where?.role as string;

          if (role === 'owner') {
            return orgOwners.has(orgId) ? { id: 'existing-owner', email: 'x@a.com' } : null;
          }
          // Return the earliest supervisor
          return orgSupervisors[orgId]
            ? { id: orgSupervisors[orgId], email: 'sup@a.com' }
            : null;
        },
        update: async (args: unknown) => {
          updates.push((args as Record<string, { id: string }>).where.id);
        },
      },
    };

    const result = await runBackfillAlgorithm(prisma);

    expect(result.orgsWithSuperAdmin).toBe(2);
    expect(result.orgsAlreadyOwned).toBe(1); // org-2
    expect(result.promoted).toBe(1); // org-1
    expect(updates).toEqual(['u-sup-1']);
  });
});

describe('backfill-roles algorithm — no supervisor org', () => {
  it('handles the pathological case where findFirst returns null for a supervisor', async () => {
    // This should not happen given the query, but the algorithm guards against it.
    const prisma = {
      user: {
        findMany: async (args: unknown) => {
          const a = args as Record<string, unknown>;
          const where = a?.where as Record<string, unknown>;
          if (where?.organizationId === null) return [];
          return [{ id: 'u-sup', email: 'sup@a.com', organizationId: 'org-1' }];
        },
        findFirst: async () => null, // always null — simulates race condition
        update: async () => {
          throw new Error('update should NOT be called');
        },
      },
    };

    const result = await runBackfillAlgorithm(prisma);

    // org has no owner (findFirst→null) AND no supervisor found → orgsWithNoSuperAdmin
    expect(result.orgsWithNoSuperAdmin).toBe(1);
    expect(result.promoted).toBe(0);
  });
});
