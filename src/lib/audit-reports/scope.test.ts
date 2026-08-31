/**
 * The audit surface's facility widening, in isolation.
 *
 * The point of these is the SHAPE of the exemption: exactly one role is added,
 * everyone else still goes through `resolveDataFacilityIds`, and the global
 * `ORG_WIDE_FACILITY_ROLES` list is not touched — so a future facility-bound
 * role that gains `auditPack.read` is narrowed by default rather than silently
 * inheriting this widening.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockResolveDataFacilityIds } = vi.hoisted(() => ({
  mockResolveDataFacilityIds: vi.fn(),
}));

vi.mock('@/lib/facility/staff-where', () => ({
  resolveDataFacilityIds: mockResolveDataFacilityIds,
}));

import { isOrgWideFacilityRole } from '@/lib/facility/scope';
import { resolveAuditFacilityIds } from './scope';
import type { Role } from '@/types/next-auth';

const session = (role: Role) => ({
  user: { id: 'u1', role, organizationId: 'org-a', organizationUserId: 'ou1' },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveAuditFacilityIds', () => {
  it('returns null for a supervisor without consulting the facility resolver', async () => {
    mockResolveDataFacilityIds.mockResolvedValue(['annex']);

    await expect(resolveAuditFacilityIds(session('supervisor'))).resolves.toBeNull();
    expect(mockResolveDataFacilityIds).not.toHaveBeenCalled();
  });

  it('defers to resolveDataFacilityIds for every other role', async () => {
    mockResolveDataFacilityIds.mockResolvedValue(null);
    await expect(resolveAuditFacilityIds(session('hr'))).resolves.toBeNull();

    mockResolveDataFacilityIds.mockResolvedValue(['annex']);
    await expect(resolveAuditFacilityIds(session('nurse'))).resolves.toEqual(['annex']);

    expect(mockResolveDataFacilityIds).toHaveBeenCalledTimes(2);
  });

  it('preserves the fail-closed empty array — [] means "see nothing"', async () => {
    mockResolveDataFacilityIds.mockResolvedValue([]);

    await expect(resolveAuditFacilityIds(session('nurse'))).resolves.toEqual([]);
  });

  it('does not widen the global facility role set', () => {
    expect(isOrgWideFacilityRole('supervisor')).toBe(false);
  });
});
