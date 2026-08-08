/**
 * Unit tests for src/lib/facility/member-facility.ts — the single source of
 * truth for "which facility does this member's enrollment get stamped with".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindFirst, mockFindMany } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockFindMany: vi.fn(),
}));

import { resolveMemberFacilityId, resolveMemberFacilityIds } from './member-facility';

// The real param type is a narrow Pick<typeof prisma, 'organizationUserFacility'>
// (not exported), so the mock is cast to it rather than satisfying the full
// Prisma delegate shape (find*OrThrow, create, update, etc. are irrelevant here).
const client = {
  organizationUserFacility: { findFirst: mockFindFirst, findMany: mockFindMany },
} as unknown as Parameters<typeof resolveMemberFacilityId>[0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveMemberFacilityId', () => {
  it('returns null when the member holds no active assignment', async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await resolveMemberFacilityId(client, 'ou-1');

    expect(result).toBeNull();
  });

  it('returns the single active assignment facility id', async () => {
    mockFindFirst.mockResolvedValue({ facilityId: 'fac-1' });

    const result = await resolveMemberFacilityId(client, 'ou-1');

    expect(result).toBe('fac-1');
  });

  it('queries only active assignments for the given member, ordered oldest-first tie-broken by id', async () => {
    mockFindFirst.mockResolvedValue({ facilityId: 'fac-1' });

    await resolveMemberFacilityId(client, 'ou-1');

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { organizationUserId: 'ou-1', active: true },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      select: { facilityId: true },
    });
  });
});

describe('resolveMemberFacilityIds (batch)', () => {
  it('returns an empty map without querying when given an empty id list', async () => {
    const result = await resolveMemberFacilityIds(client, []);

    expect(result.size).toBe(0);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('maps each member to their facility, omitting members with no active assignment', async () => {
    mockFindMany.mockResolvedValue([
      { organizationUserId: 'ou-1', facilityId: 'fac-1' },
      { organizationUserId: 'ou-2', facilityId: 'fac-2' },
    ]);

    const result = await resolveMemberFacilityIds(client, ['ou-1', 'ou-2', 'ou-3']);

    expect(result.get('ou-1')).toBe('fac-1');
    expect(result.get('ou-2')).toBe('fac-2');
    expect(result.has('ou-3')).toBe(false);
  });

  it('picks the oldest assignment when a member holds several active facility rows', async () => {
    // Rows arrive oldest-first per the orderBy; the batch resolver keeps the
    // first one seen per member and ignores later rows for the same member.
    mockFindMany.mockResolvedValue([
      { organizationUserId: 'ou-1', facilityId: 'fac-oldest' },
      { organizationUserId: 'ou-1', facilityId: 'fac-newest' },
    ]);

    const result = await resolveMemberFacilityIds(client, ['ou-1']);

    expect(result.get('ou-1')).toBe('fac-oldest');
  });

  it('queries with the given id set, active only, ordered oldest-first tie-broken by id', async () => {
    mockFindMany.mockResolvedValue([]);

    await resolveMemberFacilityIds(client, ['ou-1', 'ou-2']);

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { organizationUserId: { in: ['ou-1', 'ou-2'] }, active: true },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      select: { organizationUserId: true, facilityId: true },
    });
  });
});
