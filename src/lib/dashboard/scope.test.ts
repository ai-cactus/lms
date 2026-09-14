/**
 * `resolveDashboardScope` is the population both dashboard actions read from —
 * see the module doc-comment in `scope.ts`. These pin the `string[] | null`
 * facility contract, the mandatory org pin on `enrollmentWhere`, and the
 * fail-closed "no organisation" shape, independent of either action.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { prismaMock, mockListAccessibleFacilities } = vi.hoisted(() => ({
  prismaMock: { orgCourseOffering: { findMany: vi.fn() } },
  mockListAccessibleFacilities: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
// `isOrgWideFacilityRole` stays real (pure role-list lookup) — only the
// roster-backed `listAccessibleFacilities` is stubbed.
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { resolveDashboardScope } from './scope';
import type { Role } from '@/types/next-auth';

const ORG_ID = 'org-a';

function session(overrides: Partial<{ role: Role; organizationId: string | null }> = {}) {
  return {
    user: {
      id: 'user-1',
      role: overrides.role ?? ('owner' as Role),
      organizationId: overrides.organizationId === undefined ? ORG_ID : overrides.organizationId,
      organizationUserId: 'ou-1',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.orgCourseOffering.findMany.mockResolvedValue([]);
  mockListAccessibleFacilities.mockResolvedValue([]);
});

describe('resolveDashboardScope — dataFacilityIds (string[] | null contract)', () => {
  it('is null for an org-wide role with no requested ids — no facility predicate', async () => {
    const scope = await resolveDashboardScope(session({ role: 'owner' }));

    expect(scope.dataFacilityIds).toBeNull();
    expect(scope.enrollmentWhere).not.toHaveProperty('facilityId');
  });

  it('is [] — not the org-wide null — for a facility-bound role with no accessible assignments, and narrows to nothing rather than everything', async () => {
    mockListAccessibleFacilities.mockResolvedValue([]);

    const scope = await resolveDashboardScope(session({ role: 'supervisor' }));

    expect(scope.dataFacilityIds).toEqual([]);
    // The fail-open this contract exists to prevent: an empty array must
    // produce `{ in: [] }` (matches nothing), never `{}` (matches everything).
    expect(scope.enrollmentWhere.facilityId).toEqual({ in: [] });
  });

  it('drops a requested id the caller cannot access rather than trusting it', async () => {
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);

    const scope = await resolveDashboardScope(session({ role: 'supervisor' }), [
      'fac-1',
      'foreign-id',
    ]);

    expect(scope.dataFacilityIds).toEqual(['fac-1']);
    expect(scope.enrollmentWhere.facilityId).toEqual({ in: ['fac-1'] });
  });

  it('narrows an org-wide role too when it explicitly requests a subset', async () => {
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }, { id: 'fac-2' }]);

    const scope = await resolveDashboardScope(session({ role: 'owner' }), ['fac-1']);

    expect(scope.dataFacilityIds).toEqual(['fac-1']);
  });
});

describe('resolveDashboardScope — the org pin', () => {
  it('is always present on enrollmentWhere, whatever the facility scope', async () => {
    const orgWide = await resolveDashboardScope(session({ role: 'owner' }));
    const facilityBound = await resolveDashboardScope(session({ role: 'supervisor' }));

    expect(orgWide.enrollmentWhere.organizationUser).toEqual({ organizationId: ORG_ID });
    expect(facilityBound.enrollmentWhere.organizationUser).toEqual({ organizationId: ORG_ID });
  });

  it('is always present on staffWhere()', async () => {
    const scope = await resolveDashboardScope(session({ role: 'owner' }));

    expect(scope.staffWhere()).toMatchObject({ organizationId: ORG_ID, active: true });
  });
});

describe('resolveDashboardScope — no organisation (mid-onboarding)', () => {
  it('fails closed: every predicate matches nothing rather than everything', async () => {
    const scope = await resolveDashboardScope(session({ organizationId: null }));

    expect(scope.organizationId).toBeNull();
    expect(scope.courseWhere).toEqual({ id: { in: [] } });
    expect(scope.enrollmentWhere).toEqual({ id: { in: [] } });
    expect(scope.staffWhere()).toEqual({ id: { in: [] } });
  });

  it('never issues the adopted-course lookup with no organisation to scope it to', async () => {
    await resolveDashboardScope(session({ organizationId: null }));

    expect(prismaMock.orgCourseOffering.findMany).not.toHaveBeenCalled();
  });
});

describe('resolveDashboardScope — courseWhere', () => {
  it('unions the authored set with adopted course ids when the org has adopted any', async () => {
    prismaMock.orgCourseOffering.findMany.mockResolvedValue([{ courseId: 'adopted-1' }]);

    const scope = await resolveDashboardScope(session({ role: 'owner' }));

    expect(scope.courseWhere).toEqual({
      OR: [{ creator: { organizationId: ORG_ID } }, { id: { in: ['adopted-1'] } }],
    });
  });

  it('is the plain authored predicate when nothing is adopted', async () => {
    const scope = await resolveDashboardScope(session({ role: 'owner' }));

    expect(scope.courseWhere).toEqual({ creator: { organizationId: ORG_ID } });
  });
});
