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

    expect(orgWide.enrollmentWhere.organizationUser).toEqual({
      organizationId: ORG_ID,
      active: true,
    });
    expect(facilityBound.enrollmentWhere.organizationUser).toEqual({
      organizationId: ORG_ID,
      active: true,
    });
  });

  // Q23 retention: removeStaff no longer deletes a departed member's in-flight
  // enrollments, so the dashboard's own predicate is the only thing keeping
  // them out of overdue/outstanding counts. Dropping it would silently reinstate
  // departed staff in every aggregate built on enrollmentWhere.
  it('pins enrollmentWhere to ACTIVE memberships so retained records of removed staff stay out of the counts', async () => {
    const orgWide = await resolveDashboardScope(session({ role: 'owner' }));
    const facilityBound = await resolveDashboardScope(session({ role: 'supervisor' }));

    expect(orgWide.enrollmentWhere.organizationUser).toMatchObject({ active: true });
    expect(facilityBound.enrollmentWhere.organizationUser).toMatchObject({ active: true });
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
  it('unions the organisation own courses with adopted course ids when the org has adopted any', async () => {
    prismaMock.orgCourseOffering.findMany.mockResolvedValue([{ courseId: 'adopted-1' }]);

    const scope = await resolveDashboardScope(session({ role: 'owner' }));

    expect(scope.courseWhere).toEqual({
      OR: [{ organizationId: ORG_ID }, { id: { in: ['adopted-1'] } }],
    });
  });

  it('is the plain organisation predicate when nothing is adopted', async () => {
    const scope = await resolveDashboardScope(session({ role: 'owner' }));

    expect(scope.courseWhere).toEqual({ organizationId: ORG_ID });
  });

  // BUG-01. Finance is the one manager role without `course.read`, so it used to
  // fall to `createdByOrgUserId` — and, authoring no courses, read an
  // organisation with four courses as an organisation with two. "Total Courses"
  // is a fact about the organisation; what a role may SEE of the catalogue is
  // the caller's decision, not a smaller number on the same tile.
  it.each(['owner', 'admin', 'hr', 'clinical_director', 'supervisor', 'finance'] as const)(
    'is the same organisation-wide predicate for %s — role narrows nothing',
    async (role) => {
      const scope = await resolveDashboardScope(session({ role }));

      expect(scope.courseWhere).toEqual({ organizationId: ORG_ID });
      expect(scope.liveCourseWhere).toEqual({ organizationId: ORG_ID, archivedAt: null });
      expect(JSON.stringify(scope.courseWhere)).not.toContain('createdByOrgUserId');
    },
  );

  it('unions the adopted ids for a role without course.read too, rather than narrowing to what it authored', async () => {
    prismaMock.orgCourseOffering.findMany.mockResolvedValue([{ courseId: 'adopted-1' }]);

    const finance = await resolveDashboardScope(session({ role: 'finance' }));
    const owner = await resolveDashboardScope(session({ role: 'owner' }));

    expect(finance.courseWhere).toEqual(owner.courseWhere);
    expect(finance.courseWhere).toEqual({
      OR: [{ organizationId: ORG_ID }, { id: { in: ['adopted-1'] } }],
    });
  });

  // The other half of the line: facility scope is a legitimate narrowing, and it
  // applies to the enrolment-derived figures ONLY. Courses are org-global (they
  // carry no facility), so a facility-bound supervisor still counts the whole
  // catalogue while their enrolment figures narrow to their own sites.
  it('is never facility-narrowed, while the facility-bound caller enrolment predicate is', async () => {
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);

    const scope = await resolveDashboardScope(session({ role: 'supervisor' }));

    expect(scope.courseWhere).toEqual({ organizationId: ORG_ID });
    expect(scope.enrollmentWhere.facilityId).toEqual({ in: ['fac-1'] });
  });

  // `courseWhere` stays archive-neutral because its callers are TOP-LEVEL
  // Course reads, where the query extension in `db/index.ts` already excludes
  // archived rows. It is `liveCourseWhere` that travels through a nested
  // `course:` relation, which the extension cannot reach.
  it('leaves courseWhere archive-neutral and puts the predicate on liveCourseWhere', async () => {
    const scope = await resolveDashboardScope(session({ role: 'owner' }));

    expect(scope.courseWhere).not.toHaveProperty('archivedAt');
    expect(scope.liveCourseWhere).toEqual({ organizationId: ORG_ID, archivedAt: null });
  });

  it('ANDs the archive predicate with the adopted union rather than replacing it', async () => {
    prismaMock.orgCourseOffering.findMany.mockResolvedValue([{ courseId: 'adopted-1' }]);

    const scope = await resolveDashboardScope(session({ role: 'owner' }));

    expect(scope.liveCourseWhere).toEqual({
      OR: [{ organizationId: ORG_ID }, { id: { in: ['adopted-1'] } }],
      archivedAt: null,
    });
  });
});

// Archiving retires a course from the catalogue, so its enrolments must stop
// feeding overdue, at-risk and coverage figures a manager can no longer act on.
// The predicate lives on the shared bundle so a NEW aggregate cannot omit it —
// the same reasoning as the org pin above.
describe('resolveDashboardScope — the archive predicate', () => {
  it('is always present on enrollmentWhere, whatever the facility scope', async () => {
    const orgWide = await resolveDashboardScope(session({ role: 'owner' }));
    const facilityBound = await resolveDashboardScope(session({ role: 'supervisor' }));

    expect(orgWide.enrollmentWhere.course).toEqual({ archivedAt: null });
    expect(facilityBound.enrollmentWhere.course).toEqual({ archivedAt: null });
  });
});
