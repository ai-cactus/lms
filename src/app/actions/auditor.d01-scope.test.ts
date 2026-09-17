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

const { prismaMock, rawPrismaMock, mockAuth, mockResolveDataFacilityIds } = vi.hoisted(() => ({
  prismaMock: {
    // Course gets a SEPARATE pair of spies from `rawPrismaMock` below, wired to
    // the empty "live rows only" answer. The catalogue is read off the
    // un-extended client so the screen agrees with the export worker (Q24), and
    // splitting the spies is what makes a regression that swaps them fail
    // loudly instead of returning an equivalent-looking result.
    course: { count: vi.fn(), findMany: vi.fn() },
    enrollment: { findMany: vi.fn() },
    organizationUser: { count: vi.fn(), findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
    orgCourseOffering: { findMany: vi.fn() },
  },
  rawPrismaMock: { course: { count: vi.fn(), findMany: vi.fn() } },
  mockAuth: vi.fn(),
  mockResolveDataFacilityIds: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/db/index', () => ({ rawPrisma: rawPrismaMock }));
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
  rawPrismaMock.course.count.mockResolvedValue(0);
  rawPrismaMock.course.findMany.mockResolvedValue([]);
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

    const call = rawPrismaMock.course.findMany.mock.calls[0][0];
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
    expect(hasFacilityPredicate(rawPrismaMock.course.findMany.mock.calls[0][0].where)).toBe(false);
  });
});

describe('catalogue scope — adopted courses, drafts excluded', () => {
  it('unions own courses with the organisation offering', async () => {
    mockAuth.mockResolvedValue(HR);
    prismaMock.orgCourseOffering.findMany.mockResolvedValue([{ courseId: 'adopted-1' }]);

    await getAuditorCourses();

    expect(rawPrismaMock.course.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ organizationId: ORG }, { id: { in: ['adopted-1'] } }],
      status: { not: 'draft' },
    });
  });

  it('falls back to the bare organisation predicate when the org has adopted nothing', async () => {
    mockAuth.mockResolvedValue(HR);

    await getAuditorCourses();

    expect(rawPrismaMock.course.findMany.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
      status: { not: 'draft' },
    });
  });

  // ⛔ Reverses the earlier ruling that the auditor catalogue spans every
  // status. Drafts are out; `inactive` stays. The SAME predicate is asserted in
  // auditor-export-worker.archive-scope.test.ts — the screen and the PDF must
  // filter identically or the auditor reads two different numbers.
  it('excludes drafts from both the list and the overview count', async () => {
    mockAuth.mockResolvedValue(HR);

    await getAuditorCourses();
    await getAuditorOverviewStats();

    expect(rawPrismaMock.course.findMany.mock.calls[0][0].where.status).toEqual({ not: 'draft' });
    expect(rawPrismaMock.course.count.mock.calls[0][0].where.status).toEqual({ not: 'draft' });
  });

  it('keeps retired (inactive) courses — only `draft` is excluded', async () => {
    mockAuth.mockResolvedValue(HR);

    await getAuditorCourses();

    // A retired course was in service and people took it; its records are the
    // evidence an audit asks for. The predicate must exclude `draft` alone, not
    // narrow to `published`.
    expect(rawPrismaMock.course.findMany.mock.calls[0][0].where.status).not.toEqual({
      equals: 'published',
    });
    expect(rawPrismaMock.course.findMany.mock.calls[0][0].where.status).toEqual({ not: 'draft' });
  });

  it('surfaces each course status on the row', async () => {
    mockAuth.mockResolvedValue(HR);
    rawPrismaMock.course.findMany.mockResolvedValue([
      {
        id: 'c1',
        title: 'Bloodborne Pathogens',
        thumbnail: null,
        status: 'inactive',
        createdAt: new Date('2026-01-01'),
        enrollments: [],
      },
    ]);

    const rows = await getAuditorCourses();

    expect(rows[0].status).toBe('inactive');
  });

  it('still narrows the per-course enrollment stats to the caller org', async () => {
    mockAuth.mockResolvedValue(HR);

    await getAuditorCourses();

    const select = rawPrismaMock.course.findMany.mock.calls[0][0].select;
    expect(select.enrollments.where.organizationUser).toEqual(
      expect.objectContaining({ organizationId: ORG }),
    );
  });
});

/**
 * Q24: "delete" archives. An archived course is still part of what the
 * organisation has to account for, so it belongs in the auditor's catalogue —
 * and the export worker already counts it. Reading this surface through the
 * archive-filtered client would show the auditor one number on screen and a
 * different one in the PDF they download, which is the one thing a compliance
 * artifact cannot do.
 *
 * The widening is the COURSE ROW and nothing else. The last test here is the
 * important one: it pins that a facility-bound auditor did not gain visibility
 * of another facility's staff along the way.
 */
describe('archived courses — the catalogue is read off the un-extended client', () => {
  const ARCHIVED_ROW = {
    id: 'c-archived',
    title: 'Retired Bloodborne Pathogens',
    thumbnail: null,
    status: 'published',
    createdAt: new Date('2026-01-01'),
    enrollments: [{ status: 'completed' }],
  };

  it('lists an archived course in the auditor catalogue', async () => {
    mockAuth.mockResolvedValue(HR);
    rawPrismaMock.course.findMany.mockResolvedValue([ARCHIVED_ROW]);
    // What the archive-filtered client would return instead.
    prismaMock.course.findMany.mockResolvedValue([]);

    const rows = await getAuditorCourses();

    expect(rows.map((r) => r.id)).toEqual(['c-archived']);
    expect(prismaMock.course.findMany).not.toHaveBeenCalled();
  });

  it('counts an archived course in the overview catalogue total', async () => {
    mockAuth.mockResolvedValue(HR);
    rawPrismaMock.course.count.mockResolvedValue(7);
    prismaMock.course.count.mockResolvedValue(6);

    const stats = await getAuditorOverviewStats();

    expect(stats.totalCourses).toBe(7);
    expect(prismaMock.course.count).not.toHaveBeenCalled();
  });

  it('does NOT widen subject data — a supervisor keeps the facility narrowing on staff and enrollments', async () => {
    mockAuth.mockResolvedValue(SUPERVISOR);
    mockResolveDataFacilityIds.mockResolvedValue(['annex']);
    rawPrismaMock.course.findMany.mockResolvedValue([ARCHIVED_ROW]);

    await getAuditorCourses();
    await getAuditorOverviewStats();
    await getAuditorStaff();

    // The archived course still lists — with its per-course rollup confined to
    // the caller's own facilities.
    const courseCall = rawPrismaMock.course.findMany.mock.calls[0][0];
    expect(hasFacilityPredicate(courseCall.where)).toBe(false);
    expect(hasFacilityPredicate(courseCall.select.enrollments.where.organizationUser)).toBe(true);

    // …and every SUBJECT query around it is untouched by the widening.
    expect(
      hasFacilityPredicate(prismaMock.enrollment.findMany.mock.calls[0][0].where.organizationUser),
    ).toBe(true);
    expect(hasFacilityPredicate(prismaMock.organizationUser.count.mock.calls[0][0].where)).toBe(
      true,
    );
    expect(hasFacilityPredicate(prismaMock.organizationUser.findMany.mock.calls[0][0].where)).toBe(
      true,
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
    expect(rawPrismaMock.course.findMany).not.toHaveBeenCalled();
    expect(prismaMock.course.findMany).not.toHaveBeenCalled();
  });
});
