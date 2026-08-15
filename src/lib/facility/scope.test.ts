/**
 * Unit tests for src/lib/facility/scope.ts.
 *
 * Covers isOrgWideFacilityRole, listAccessibleFacilities (org-wide vs
 * facility-bound roles, tenant isolation, missing org/membership) and
 * resolveFacilityScope (no request -> all, valid -> single, foreign/unknown
 * request -> silent fallback to all, never throws).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindMany, mockWarn } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = { facility: { findMany: mockFindMany } };
  return { prisma, default: prisma };
});

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: mockWarn, error: vi.fn(), debug: vi.fn() },
}));

import {
  isOrgWideFacilityRole,
  listAccessibleFacilities,
  resolveFacilityScope,
  resolveFacilityScopeSelection,
} from './scope';

const FACILITY_A = { id: 'fac-a', name: 'Alpha Site', type: 'clinic', city: 'Austin' };
const FACILITY_B = { id: 'fac-b', name: 'Beta Site', type: 'clinic', city: 'Dallas' };

function session(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    user: {
      id: 'user-1',
      role: 'owner',
      organizationId: 'org-1',
      organizationUserId: 'ou-1',
      ...overrides,
    },
  } as Parameters<typeof listAccessibleFacilities>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isOrgWideFacilityRole', () => {
  it.each(['owner', 'admin', 'hr', 'clinical_director', 'finance'] as const)(
    'treats %s as org-wide',
    (role) => {
      expect(isOrgWideFacilityRole(role)).toBe(true);
    },
  );

  it.each(['supervisor', 'nurse', 'therapist_clinician'] as const)(
    'treats %s as facility-bound, not org-wide',
    (role) => {
      expect(isOrgWideFacilityRole(role)).toBe(false);
    },
  );
});

describe('listAccessibleFacilities', () => {
  it('returns [] when the session carries no organization', async () => {
    const result = await listAccessibleFacilities(session({ organizationId: undefined }));

    expect(result).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('queries every facility in the org (unfiltered by membership) for an org-wide role', async () => {
    mockFindMany.mockResolvedValue([FACILITY_A, FACILITY_B]);

    const result = await listAccessibleFacilities(session({ role: 'owner' }));

    expect(result).toEqual([FACILITY_A, FACILITY_B]);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      select: { id: true, name: true, type: true, city: true },
      orderBy: { name: 'asc' },
    });
  });

  it('never leaks a foreign org — the where clause is unconditionally scoped by organizationId', async () => {
    mockFindMany.mockResolvedValue([]);
    await listAccessibleFacilities(session({ role: 'owner', organizationId: 'org-1' }));

    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe('org-1');
  });

  it('narrows a supervisor to only their active OrganizationUserFacility assignments', async () => {
    mockFindMany.mockResolvedValue([FACILITY_A]);

    const result = await listAccessibleFacilities(session({ role: 'supervisor' }));

    expect(result).toEqual([FACILITY_A]);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        userFacilities: { some: { organizationUserId: 'ou-1', active: true } },
      },
      select: { id: true, name: true, type: true, city: true },
      orderBy: { name: 'asc' },
    });
  });

  it('returns [] for a facility-bound role with no organizationUserId, without querying', async () => {
    const result = await listAccessibleFacilities(
      session({ role: 'supervisor', organizationUserId: undefined }),
    );

    expect(result).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe('resolveFacilityScope', () => {
  it('returns { mode: "all" } when no facility is requested', async () => {
    const result = await resolveFacilityScope(session(), undefined);

    expect(result).toEqual({ mode: 'all' });
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('returns { mode: "all" } for an empty-string request without querying', async () => {
    const result = await resolveFacilityScope(session(), '');

    expect(result).toEqual({ mode: 'all' });
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('resolves to { mode: "single" } when the requested facility is accessible', async () => {
    mockFindMany.mockResolvedValue([FACILITY_A, FACILITY_B]);

    const result = await resolveFacilityScope(session(), FACILITY_B.id);

    expect(result).toEqual({ mode: 'single', facility: FACILITY_B });
  });

  it('falls back to { mode: "all" } for a foreign/inaccessible facility id, logging a warning, never throwing', async () => {
    mockFindMany.mockResolvedValue([FACILITY_A]);

    const result = await resolveFacilityScope(session(), 'foreign-facility-id');

    expect(result).toEqual({ mode: 'all' });
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('not accessible'),
        requestedFacilityId: 'foreign-facility-id',
      }),
    );
  });

  it('falls back to { mode: "all" } for a well-formed but nonexistent facility id', async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await resolveFacilityScope(session(), 'does-not-exist');

    expect(result).toEqual({ mode: 'all' });
  });

  it('falls back to { mode: "all" } (not an error) for a supervisor requesting a facility outside their assignment set', async () => {
    // Supervisor's own query already narrows to their assigned facilities, so a
    // foreign-facility request simply never appears in `accessible`.
    mockFindMany.mockResolvedValue([FACILITY_A]);

    const result = await resolveFacilityScope(session({ role: 'supervisor' }), FACILITY_B.id);

    expect(result).toEqual({ mode: 'all' });
  });
});

const FACILITY_C = { id: 'fac-c', name: 'Gamma Site', type: 'clinic', city: 'Houston' };

describe('resolveFacilityScopeSelection', () => {
  it('returns { mode: "all" } for an absent param without querying', async () => {
    const result = await resolveFacilityScopeSelection(session(), undefined);

    expect(result).toEqual({ mode: 'all' });
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('resolves a single accessible id to { mode: "single" }', async () => {
    mockFindMany.mockResolvedValue([FACILITY_A, FACILITY_B]);

    const result = await resolveFacilityScopeSelection(session(), FACILITY_B.id);

    expect(result).toEqual({ mode: 'single', facility: FACILITY_B });
  });

  it('resolves two or more accessible ids to { mode: "compare" }', async () => {
    mockFindMany.mockResolvedValue([FACILITY_A, FACILITY_B, FACILITY_C]);

    const result = await resolveFacilityScopeSelection(
      session(),
      `${FACILITY_C.id},${FACILITY_A.id}`,
    );

    // Ordered by the accessible set (alphabetical), not by the URL's order.
    expect(result).toEqual({ mode: 'compare', facilities: [FACILITY_A, FACILITY_C] });
  });

  it("drops ids outside the caller's accessible set and compares what remains", async () => {
    mockFindMany.mockResolvedValue([FACILITY_A, FACILITY_B]);

    const result = await resolveFacilityScopeSelection(
      session(),
      `${FACILITY_A.id},foreign-id,${FACILITY_B.id}`,
    );

    expect(result).toEqual({ mode: 'compare', facilities: [FACILITY_A, FACILITY_B] });
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('not accessible') }),
    );
  });

  it('narrows to { mode: "single" } when only one requested id survives the tenancy filter', async () => {
    mockFindMany.mockResolvedValue([FACILITY_A]);

    const result = await resolveFacilityScopeSelection(session(), `${FACILITY_A.id},foreign-id`);

    expect(result).toEqual({ mode: 'single', facility: FACILITY_A });
  });

  it('falls back to { mode: "all" } when no requested id is accessible, never throwing', async () => {
    mockFindMany.mockResolvedValue([FACILITY_A]);

    const result = await resolveFacilityScopeSelection(session(), 'foreign-1,foreign-2');

    expect(result).toEqual({ mode: 'all' });
    expect(mockWarn).toHaveBeenCalled();
  });

  it('accepts a repeated param array as one comparison request', async () => {
    mockFindMany.mockResolvedValue([FACILITY_A, FACILITY_B]);

    const result = await resolveFacilityScopeSelection(session(), [FACILITY_A.id, FACILITY_B.id]);

    expect(result).toEqual({ mode: 'compare', facilities: [FACILITY_A, FACILITY_B] });
  });

  it('never widens a supervisor beyond their assigned facilities', async () => {
    // The supervisor's accessible query returns only FACILITY_A, so the second
    // requested id cannot enter the comparison.
    mockFindMany.mockResolvedValue([FACILITY_A]);

    const result = await resolveFacilityScopeSelection(
      session({ role: 'supervisor' }),
      `${FACILITY_A.id},${FACILITY_B.id}`,
    );

    expect(result).toEqual({ mode: 'single', facility: FACILITY_A });
  });
});
