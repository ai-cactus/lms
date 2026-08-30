/**
 * The mutation-target facility contract.
 *
 * These helpers are the shared answer to "may this caller ACT ON the target
 * they just named". Every write that accepts a caller-supplied identifier now
 * routes through them, so the invariants below are the ones holding the whole
 * class of cross-facility escalation shut — not a detail of any one action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockOrgUserFindMany, mockListAccessibleFacilities } = vi.hoisted(() => ({
  mockOrgUserFindMany: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = { organizationUser: { findMany: mockOrgUserFindMany } };
  return { prisma, default: prisma };
});
// isOrgWideFacilityRole stays real so the org-wide vs facility-bound split is genuine.
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import {
  areFacilitiesInCallerScope,
  partitionEmailsByFacility,
  partitionOrgUsersByFacility,
} from './target-scope';

const ORG = 'org-1';
const F1 = 'facility-1';
const F2 = 'facility-2';

function session(role: string) {
  return { user: { id: 'u-1', role, organizationId: ORG, organizationUserId: 'ou-1' } } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListAccessibleFacilities.mockResolvedValue([{ id: F1 }]);
});

describe('partitionOrgUsersByFacility', () => {
  it('admits a target holding an active membership of the caller facility', async () => {
    mockOrgUserFindMany.mockResolvedValue([{ id: 'ou-a', facilities: [{ facilityId: F1 }] }]);

    const result = await partitionOrgUsersByFacility(session('supervisor'), ORG, ['ou-a']);

    expect(result).toEqual({ allowed: ['ou-a'], rejected: [] });
  });

  it('rejects a target that only holds another facility', async () => {
    mockOrgUserFindMany.mockResolvedValue([{ id: 'ou-b', facilities: [{ facilityId: F2 }] }]);

    const result = await partitionOrgUsersByFacility(session('supervisor'), ORG, ['ou-b']);

    expect(result).toEqual({ allowed: [], rejected: ['ou-b'] });
  });

  it('rejects an id that matches no member — an unknown target is not an actionable one', async () => {
    mockOrgUserFindMany.mockResolvedValue([]);

    const result = await partitionOrgUsersByFacility(session('supervisor'), ORG, ['ou-ghost']);

    expect(result.rejected).toEqual(['ou-ghost']);
  });

  it('applies no narrowing at all for an org-wide role, and issues no query', async () => {
    const result = await partitionOrgUsersByFacility(session('owner'), ORG, ['ou-a', 'ou-b']);

    expect(result).toEqual({ allowed: ['ou-a', 'ou-b'], rejected: [] });
    expect(mockOrgUserFindMany).not.toHaveBeenCalled();
  });

  it('acts on NOTHING when a facility-bound caller has no accessible facilities — empty means none', async () => {
    mockListAccessibleFacilities.mockResolvedValue([]);
    mockOrgUserFindMany.mockResolvedValue([{ id: 'ou-a', facilities: [{ facilityId: F1 }] }]);

    const result = await partitionOrgUsersByFacility(session('supervisor'), ORG, ['ou-a']);

    expect(result).toEqual({ allowed: [], rejected: ['ou-a'] });
  });

  it('ignores an INACTIVE membership — scope is where the person is now', async () => {
    // The query filters `active: true`, so a lapsed membership never comes back.
    mockOrgUserFindMany.mockResolvedValue([{ id: 'ou-a', facilities: [] }]);

    const result = await partitionOrgUsersByFacility(session('supervisor'), ORG, ['ou-a']);

    expect(result.rejected).toEqual(['ou-a']);
    expect(mockOrgUserFindMany.mock.calls[0][0].select.facilities.where).toEqual({ active: true });
  });
});

describe('partitionEmailsByFacility', () => {
  it('rejects a member outside the caller facilities', async () => {
    mockOrgUserFindMany.mockResolvedValue([
      { user: { email: 'out@example.com' }, facilities: [{ facilityId: F2 }] },
    ]);

    const result = await partitionEmailsByFacility(session('supervisor'), ORG, ['out@example.com']);

    expect(result.rejected).toEqual(['out@example.com']);
  });

  it('ALLOWS an email belonging to no member — that is an invite question, not a facility one', async () => {
    mockOrgUserFindMany.mockResolvedValue([]);

    const result = await partitionEmailsByFacility(session('supervisor'), ORG, [
      'stranger@example.com',
    ]);

    expect(result).toEqual({ allowed: ['stranger@example.com'], rejected: [] });
  });

  it('normalises case and surrounding whitespace before comparing', async () => {
    mockOrgUserFindMany.mockResolvedValue([
      { user: { email: 'out@example.com' }, facilities: [{ facilityId: F2 }] },
    ]);

    const result = await partitionEmailsByFacility(session('supervisor'), ORG, [
      '  OUT@Example.com ',
    ]);

    expect(result.rejected).toEqual(['out@example.com']);
  });
});

describe('areFacilitiesInCallerScope', () => {
  it('permits any destination for an org-wide role', async () => {
    await expect(areFacilitiesInCallerScope(session('owner'), [F1, F2])).resolves.toBe(true);
  });

  it('permits a destination the caller holds', async () => {
    await expect(areFacilitiesInCallerScope(session('supervisor'), [F1])).resolves.toBe(true);
  });

  it('refuses when ANY destination is outside scope, not merely when all are', async () => {
    await expect(areFacilitiesInCallerScope(session('supervisor'), [F1, F2])).resolves.toBe(false);
  });

  it('refuses every destination when the caller has no accessible facilities', async () => {
    mockListAccessibleFacilities.mockResolvedValue([]);

    await expect(areFacilitiesInCallerScope(session('supervisor'), [F1])).resolves.toBe(false);
  });
});
