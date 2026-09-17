/**
 * `liveRowsOnly` is the whole Q24 read policy — it runs on EVERY top-level
 * Course and Document read in the app (see the query extension in
 * `db/index.ts`). Two properties matter, and getting either wrong is silent:
 *
 *   1. it adds `archivedAt: null`;
 *   2. it KEEPS whatever the caller already filtered on.
 *
 * Property 2 is the dangerous one. A "tidy-up" to `where: { archivedAt: null }`
 * still reads perfectly and still hides archived rows — while discarding every
 * caller's own predicate, including the `organizationId` clause that is the
 * tenancy boundary. That turns an archive filter into a cross-tenant leak.
 */
import { describe, it, expect } from 'vitest';
import { liveRowsOnly } from './archive-filter';

describe('liveRowsOnly', () => {
  it('adds the archive predicate to an empty args object', () => {
    expect(liveRowsOnly({})).toEqual({ where: { archivedAt: null } });
  });

  it('adds the archive predicate when there is no `where` at all (bare count)', () => {
    // Bound to a variable rather than inlined: an object literal passed straight
    // into the generic triggers excess-property checking against the constraint,
    // which real Prisma arg types never hit.
    const args = { select: { id: true } };

    expect(liveRowsOnly(args)).toEqual({ select: { id: true }, where: { archivedAt: null } });
  });

  it("PRESERVES the caller's own predicates — dropping them would void every tenancy clause", () => {
    expect(
      liveRowsOnly({
        where: { organizationId: 'org-1', status: 'published' },
      }),
    ).toEqual({
      where: { organizationId: 'org-1', status: 'published', archivedAt: null },
    });
  });

  it('preserves a top-level OR predicate (the adopted-course union)', () => {
    const where = { OR: [{ organizationId: 'org-1' }, { id: { in: ['adopted-1'] } }] };

    expect(liveRowsOnly({ where })).toEqual({ where: { ...where, archivedAt: null } });
  });

  it('preserves sibling args such as select, include, orderBy and take', () => {
    const args = {
      where: { organizationId: 'org-1' },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: 25,
    };

    expect(liveRowsOnly(args)).toEqual({
      ...args,
      where: { organizationId: 'org-1', archivedAt: null },
    });
  });

  it('does not mutate the caller args in place', () => {
    const args = { where: { organizationId: 'org-1' } };

    liveRowsOnly(args);

    expect(args).toEqual({ where: { organizationId: 'org-1' } });
  });

  it('wins over a caller-supplied archivedAt — the policy is not negotiable per call site', () => {
    expect(liveRowsOnly({ where: { archivedAt: { not: null } } })).toEqual({
      where: { archivedAt: null },
    });
  });
});
