/**
 * The audit-report surface's scoping contract, in one place.
 *
 * Four things have to hold at once, and three of them are asymmetries that a
 * naive "scope everything" or "widen everything" fix gets wrong:
 *
 *   ORG       — always applied. The tenant boundary. Never relaxed.
 *   FACILITY  — applied to SUBJECT data for every facility-bound role,
 *               supervisor included. This surface briefly widened supervisors
 *               org-wide via a local `@/lib/audit-reports/scope`; the team test
 *               of 2026-09-03 reversed that, so there is now exactly ONE
 *               resolver (`resolveDataFacilityIds`) behind the page, the export
 *               job's stamped scope, and the status/download re-checks.
 *   CATALOGUE — NOT facility-narrowed, and spans adopted (platform-offering)
 *               courses authored by another tenant plus every status, drafts
 *               included. A course with no in-facility enrollments still lists,
 *               with zeroes — omitting it would read as "this facility has no
 *               such course" when it has one.
 *   ROLE      — every member of the org, not just the eight worker roles.
 *
 * These assert on the Prisma `where` each action builds, because the asymmetry
 * lives in the query, not the return value.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { prismaMock, mockAuth, mockResolveDataFacilityIds } = vi.hoisted(() => ({
  prismaMock: {
    course: { count: vi.fn(), findMany: vi.fn() },
    enrollment: { findMany: vi.fn() },
    organizationUser: { count: vi.fn(), findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
    orgCourseOffering: { findMany: vi.fn() },
  },
  mockAuth: vi.fn(),
  mockResolveDataFacilityIds: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAuth }));
// Only the resolver is mocked; `staffFacilityWhere` runs for real so these
// assert on the predicate the shipped helper actually builds.
vi.mock('@/lib/facility/staff-where', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/staff-where')>()),
  resolveDataFacilityIds: mockResolveDataFacilityIds,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { isOrgWideFacilityRole } from '@/lib/facility/scope';
import { getAuditorOverviewStats, getAuditorCourses, getAuditorStaff } from './auditor';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const SUPERVISOR = {
  user: { id: 'u1', role: 'supervisor', organizationId: ORG, organizationUserId: 'ou1' },
};
const HR = { user: { id: 'u2', role: 'hr', organizationId: ORG, organizationUserId: 'ou2' } };

const hasFacilityPredicate = (where: Record<string, unknown> | undefined) =>
  !!where && 'facilities' in where;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.course.count.mockResolvedValue(0);
  prismaMock.course.findMany.mockResolvedValue([]);
  prismaMock.enrollment.findMany.mockResolvedValue([]);
  prismaMock.organizationUser.count.mockResolvedValue(0);
  prismaMock.organizationUser.findMany.mockResolvedValue([]);
  prismaMock.orgCourseOffering.findMany.mockResolvedValue([]);
  mockResolveDataFacilityIds.mockResolvedValue(null);
});

describe('facility scope — subject data follows the caller, the catalogue does not', () => {
  it('narrows the Staff tab to a supervisor’s own facilities', async () => {
    mockAuth.mockResolvedValue(SUPERVISOR);
    mockResolveDataFacilityIds.mockResolvedValue(['annex']);

    await getAuditorStaff();

    const where = prismaMock.organizationUser.findMany.mock.calls[0][0].where;
    expect(where.facilities).toEqual({ some: { facilityId: { in: ['annex'] }, active: true } });
    expect(where.organizationId).toBe(ORG);
  });

  it('narrows the overview KPIs — staff count and the enrollment set behind the completion rate', async () => {
    mockAuth.mockResolvedValue(SUPERVISOR);
    mockResolveDataFacilityIds.mockResolvedValue(['annex']);

    await getAuditorOverviewStats();

    expect(hasFacilityPredicate(prismaMock.organizationUser.count.mock.calls[0][0].where)).toBe(
      true,
    );
    expect(
      hasFacilityPredicate(prismaMock.enrollment.findMany.mock.calls[0][0].where.organizationUser),
    ).toBe(true);
  });

  it('narrows the per-course rollups but still lists the whole catalogue', async () => {
    mockAuth.mockResolvedValue(SUPERVISOR);
    mockResolveDataFacilityIds.mockResolvedValue(['annex']);

    await getAuditorCourses();

    const call = prismaMock.course.findMany.mock.calls[0][0];
    // The course list itself carries no facility predicate…
    expect(hasFacilityPredicate(call.where)).toBe(false);
    // …but the enrollments counted inside each row do.
    expect(hasFacilityPredicate(call.select.enrollments.where.organizationUser)).toBe(true);
  });

  it('does NOT return staff from a facility the supervisor is not a member of', async () => {
    mockAuth.mockResolvedValue(SUPERVISOR);
    mockResolveDataFacilityIds.mockResolvedValue(['annex']);

    await getAuditorStaff();

    const where = prismaMock.organizationUser.findMany.mock.calls[0][0].where;
    expect(where.facilities.some.facilityId.in).toEqual(['annex']);
    expect(where.facilities.some.facilityId.in).not.toContain('riverside');
  });

  it('fail-closed: a supervisor with no facility assignments sees nothing, not everything', async () => {
    mockAuth.mockResolvedValue(SUPERVISOR);
    mockResolveDataFacilityIds.mockResolvedValue([]);

    await getAuditorStaff();

    // `[]` must become an impossible predicate, never an absent one.
    const where = prismaMock.organizationUser.findMany.mock.calls[0][0].where;
    expect(where.facilities).toEqual({ some: { facilityId: { in: [] }, active: true } });
  });

  it('still cannot reach another organisation — every subject query is org-anchored', async () => {
    mockAuth.mockResolvedValue(SUPERVISOR);
    mockResolveDataFacilityIds.mockResolvedValue(['annex']);

    await getAuditorStaff();
    await getAuditorOverviewStats();

    expect(prismaMock.organizationUser.findMany.mock.calls[0][0].where.organizationId).toBe(ORG);
    expect(prismaMock.organizationUser.count.mock.calls[0][0].where.organizationId).toBe(ORG);
    expect(
      prismaMock.enrollment.findMany.mock.calls[0][0].where.organizationUser.organizationId,
    ).toBe(ORG);
    const serialized = JSON.stringify(prismaMock.organizationUser.findMany.mock.calls[0][0]);
    expect(serialized).not.toContain(OTHER_ORG);
  });

  it('scopes a supervisor in another org to THAT org, not to org-a', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'u9', role: 'supervisor', organizationId: OTHER_ORG, organizationUserId: 'ou9' },
    });

    await getAuditorStaff();

    expect(prismaMock.organizationUser.findMany.mock.calls[0][0].where.organizationId).toBe(
      OTHER_ORG,
    );
  });

  it('leaves the global facility role set alone — supervisor is still not org-wide', () => {
    // The write-side boundary PR #552 closed. Narrowing the audit read must not
    // have nudged this in either direction.
    expect(isOrgWideFacilityRole('supervisor')).toBe(false);
  });

  it('HR is unchanged — no facility predicate anywhere (TC-HR-001 must not regress)', async () => {
    mockAuth.mockResolvedValue(HR);

    await getAuditorStaff();
    await getAuditorCourses();

    expect(hasFacilityPredicate(prismaMock.organizationUser.findMany.mock.calls[0][0].where)).toBe(
      false,
    );
    expect(hasFacilityPredicate(prismaMock.course.findMany.mock.calls[0][0].where)).toBe(false);
  });
});

describe('catalogue scope — adopted courses and every status', () => {
  it('unions own courses with the organisation offering', async () => {
    mockAuth.mockResolvedValue(HR);
    prismaMock.orgCourseOffering.findMany.mockResolvedValue([{ courseId: 'adopted-1' }]);

    await getAuditorCourses();

    expect(prismaMock.course.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ creator: { organizationId: ORG } }, { id: { in: ['adopted-1'] } }],
    });
  });

  it('falls back to the creator predicate when the org has adopted nothing', async () => {
    mockAuth.mockResolvedValue(HR);

    await getAuditorCourses();

    expect(prismaMock.course.findMany.mock.calls[0][0].where).toEqual({
      creator: { organizationId: ORG },
    });
  });

  it('does not filter the catalogue by status', async () => {
    mockAuth.mockResolvedValue(HR);

    await getAuditorCourses();
    await getAuditorOverviewStats();

    expect(prismaMock.course.findMany.mock.calls[0][0].where).not.toHaveProperty('status');
    expect(prismaMock.course.count.mock.calls[0][0].where).not.toHaveProperty('status');
  });

  it('surfaces each course status on the row', async () => {
    mockAuth.mockResolvedValue(HR);
    prismaMock.course.findMany.mockResolvedValue([
      {
        id: 'c1',
        title: 'Bloodborne Pathogens',
        thumbnail: null,
        status: 'draft',
        createdAt: new Date('2026-01-01'),
        enrollments: [],
      },
    ]);

    const rows = await getAuditorCourses();

    expect(rows[0].status).toBe('draft');
  });

  it('still narrows the per-course enrollment stats to the caller org', async () => {
    mockAuth.mockResolvedValue(HR);

    await getAuditorCourses();

    const select = prismaMock.course.findMany.mock.calls[0][0].select;
    expect(select.enrollments.where.organizationUser).toEqual(
      expect.objectContaining({ organizationId: ORG }),
    );
  });
});

describe('role scope — managers carry training too', () => {
  it('does not filter the Staff tab to the worker roles', async () => {
    mockAuth.mockResolvedValue(HR);

    await getAuditorStaff();

    expect(prismaMock.organizationUser.findMany.mock.calls[0][0].where).not.toHaveProperty('role');
  });

  it('does not filter the overview staff count to the worker roles', async () => {
    mockAuth.mockResolvedValue(HR);

    await getAuditorOverviewStats();

    expect(prismaMock.organizationUser.count.mock.calls[0][0].where).not.toHaveProperty('role');
  });

  it('does not hide deactivated members — a departed employee’s record is evidence', async () => {
    mockAuth.mockResolvedValue(HR);

    await getAuditorStaff();
    await getAuditorOverviewStats();

    expect(prismaMock.organizationUser.findMany.mock.calls[0][0].where).not.toHaveProperty(
      'active',
    );
    expect(prismaMock.organizationUser.count.mock.calls[0][0].where).not.toHaveProperty('active');
  });
});

describe('the verb gate still holds', () => {
  it('denies finance — no auditPack permission at all', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'u3', role: 'finance', organizationId: ORG, organizationUserId: 'ou3' },
    });

    await expect(getAuditorStaff()).rejects.toThrow('Unauthorized');
    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
  });

  it('denies a worker — workerPermissions holds no auditPack verb', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'u4', role: 'nurse', organizationId: ORG, organizationUserId: 'ou4' },
    });

    await expect(getAuditorStaff()).rejects.toThrow('Unauthorized');
    await expect(getAuditorCourses()).rejects.toThrow('Unauthorized');
    await expect(getAuditorOverviewStats()).rejects.toThrow('Unauthorized');
    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
    expect(prismaMock.course.findMany).not.toHaveBeenCalled();
  });
});
