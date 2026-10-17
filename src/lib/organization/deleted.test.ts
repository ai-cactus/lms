/**
 * The helpers every cron path uses to leave a soft-deleted organization out.
 * `excludeDeletedOrgIds` carries the one subtle contract: rows with NO
 * organization must survive, because SQL `NULL NOT IN (…)` is not true.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { organization: { findMany: vi.fn() } },
}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));

import { excludeDeletedOrgIds, getDeletedOrganizationIds, liveOrganizationWhere } from './deleted';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('liveOrganizationWhere', () => {
  it('selects organizations with no deletedAt', () => {
    expect(liveOrganizationWhere).toEqual({ deletedAt: null });
  });
});

describe('getDeletedOrganizationIds', () => {
  it('returns the ids of soft-deleted organizations only', async () => {
    prismaMock.organization.findMany.mockResolvedValue([{ id: 'org-a' }, { id: 'org-b' }]);

    await expect(getDeletedOrganizationIds()).resolves.toEqual(['org-a', 'org-b']);
    expect(prismaMock.organization.findMany).toHaveBeenCalledWith({
      where: { deletedAt: { not: null } },
      select: { id: true },
    });
  });

  it('returns an empty list when nothing is deleted', async () => {
    prismaMock.organization.findMany.mockResolvedValue([]);

    await expect(getDeletedOrganizationIds()).resolves.toEqual([]);
  });
});

describe('excludeDeletedOrgIds', () => {
  it('adds no predicate when nothing is deleted (an empty notIn would be wasted work)', () => {
    expect(excludeDeletedOrgIds([])).toEqual({});
  });

  it('keeps org-less rows and drops the deleted organizations', () => {
    expect(excludeDeletedOrgIds(['org-a', 'org-b'])).toEqual({
      OR: [{ organizationId: null }, { organizationId: { notIn: ['org-a', 'org-b'] } }],
    });
  });

  it('does not alias the caller array into the query', () => {
    const ids = ['org-a'];
    const where = excludeDeletedOrgIds(ids) as {
      OR: [unknown, { organizationId: { notIn: string[] } }];
    };

    ids.push('org-b');

    expect(where.OR[1].organizationId.notIn).toEqual(['org-a']);
  });
});
