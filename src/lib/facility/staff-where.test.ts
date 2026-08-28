/**
 * `staff-where.ts` is the single source of truth for facility scoping across
 * every read path this PR touches. Its central invariant — the one every
 * consumer relies on — is that an EMPTY facility list narrows a query to
 * NOTHING, never back to everything. That inversion (`[]` silently read as
 * "no filter") was a live bug on this branch (the `/dashboard/status-tracker`
 * incident described in the module doc), so it is pinned here directly against
 * the pure functions rather than only indirectly through call sites.
 *
 * `resolveDataFacilityIds` is also pinned for the org-wide invariant: it must
 * return `null` — meaning NO predicate — for every org-wide role, so
 * `staffFacilityWhere(null)` composes to `{}` and leaves those roles'
 * queries byte-identical to the pre-scope shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockListAccessibleFacilities } = vi.hoisted(() => ({
  mockListAccessibleFacilities: vi.fn(),
}));

vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { resolveDataFacilityIds, staffFacilityWhere, inviteFacilityWhere } from './staff-where';
import { ADMIN_ROLES, WORKER_ROLES } from '@/lib/rbac/role-utils';
import { isOrgWideFacilityRole } from '@/lib/facility/scope';
import type { Role } from '@/types/next-auth';

const ORG_WIDE_ROLES = ADMIN_ROLES.filter(isOrgWideFacilityRole);
const FACILITY_BOUND_ROLES: readonly Role[] = [
  ...ADMIN_ROLES.filter((role) => !isOrgWideFacilityRole(role)),
  ...WORKER_ROLES,
];

function session(role: Role, organizationUserId: string | null = 'ou-1') {
  return { user: { id: 'u1', role, organizationId: 'org-1', organizationUserId } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveDataFacilityIds', () => {
  it.each(ORG_WIDE_ROLES)(
    'returns null for the org-wide role %s, without ever querying accessible facilities',
    async (role) => {
      const result = await resolveDataFacilityIds(session(role));

      expect(result).toBeNull();
      expect(mockListAccessibleFacilities).not.toHaveBeenCalled();
    },
  );

  it.each(FACILITY_BOUND_ROLES)(
    'returns the accessible facility ids for the facility-bound role %s',
    async (role) => {
      mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }, { id: 'fac-2' }]);

      const result = await resolveDataFacilityIds(session(role));

      expect(result).toEqual(['fac-1', 'fac-2']);
    },
  );

  it('FAIL-CLOSED: a facility-bound role with zero active assignments gets an empty array, never null', async () => {
    mockListAccessibleFacilities.mockResolvedValue([]);

    const result = await resolveDataFacilityIds(session('supervisor'));

    expect(result).toEqual([]);
    expect(result).not.toBeNull();
  });
});

describe('staffFacilityWhere', () => {
  it('applies NO predicate for null (org-wide) — the byte-identical invariant', () => {
    expect(staffFacilityWhere(null)).toEqual({});
  });

  it('narrows to the given facility ids', () => {
    expect(staffFacilityWhere(['fac-1', 'fac-2'])).toEqual({
      facilities: { some: { facilityId: { in: ['fac-1', 'fac-2'] }, active: true } },
    });
  });

  it('FAIL-CLOSED: an empty array narrows the predicate to an impossible-to-satisfy `in: []`, never to "no filter"', () => {
    const where = staffFacilityWhere([]);

    expect(where).not.toEqual({});
    expect(where).toEqual({ facilities: { some: { facilityId: { in: [] }, active: true } } });
  });
});

describe('inviteFacilityWhere', () => {
  it('applies NO predicate for null (org-wide)', () => {
    expect(inviteFacilityWhere(null)).toEqual({});
  });

  it('narrows to the given facility ids', () => {
    expect(inviteFacilityWhere(['fac-1'])).toEqual({ facilityId: { in: ['fac-1'] } });
  });

  it('FAIL-CLOSED: an empty array narrows to `in: []` (matches nothing), never to "no filter"', () => {
    const where = inviteFacilityWhere([]);

    expect(where).not.toEqual({});
    expect(where).toEqual({ facilityId: { in: [] } });
  });
});
