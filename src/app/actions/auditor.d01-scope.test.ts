/**
 * D-01 + team QA finding #17 — the catalogue/data asymmetry.
 *
 * #17 asks for something a naive "scope everything" fix would get wrong:
 *
 *   "when downloading an audit report for courses, ALL COURSES ARE LISTED, but
 *    the DATA in the export should be limited to the facility. When viewing the
 *    workers tab, the tab should display all workers in that specific facility
 *    only."
 *
 * So the report has two axes that scope differently. Narrowing the course list
 * as well would delete a course from a supervisor's report whenever it happened
 * to be authored by someone at another facility — the audit would read "this
 * facility has no bloodborne-pathogens course" when it has one with no local
 * enrollments. That is a worse artifact than the leak.
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
  },
  mockAuth: vi.fn(),
  mockResolveDataFacilityIds: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/facility/staff-where', () => ({
  resolveDataFacilityIds: mockResolveDataFacilityIds,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { getAuditorOverviewStats, getAuditorCourses, getAuditorStaff } from './auditor';

const ORG = 'org-a';
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
});

describe('#17 — the course catalogue is org-level, the data is facility-limited', () => {
  it('getAuditorCourses does NOT narrow the course list for a supervisor', async () => {
    mockAuth.mockResolvedValue(SUPERVISOR);
    mockResolveDataFacilityIds.mockResolvedValue(['annex']);

    await getAuditorCourses();

    const courseWhere = prismaMock.course.findMany.mock.calls[0][0].where;
    // The catalogue is scoped to the ORG only — no facility predicate.
    expect(courseWhere).toEqual(
      expect.objectContaining({ creator: { organizationId: ORG }, status: 'published' }),
    );
    expect(hasFacilityPredicate(courseWhere)).toBe(false);
  });

  it('...but DOES narrow the per-course enrollment stats inside it', async () => {
    mockAuth.mockResolvedValue(SUPERVISOR);
    mockResolveDataFacilityIds.mockResolvedValue(['annex']);

    await getAuditorCourses();

    const select = prismaMock.course.findMany.mock.calls[0][0].select;
    expect(select.enrollments.where.organizationUser).toEqual(
      expect.objectContaining({
        organizationId: ORG,
        facilities: { some: { facilityId: { in: ['annex'] }, active: true } },
      }),
    );
  });

  it('getAuditorStaff narrows the Workers tab to the caller facilities', async () => {
    mockAuth.mockResolvedValue(SUPERVISOR);
    mockResolveDataFacilityIds.mockResolvedValue(['annex']);

    await getAuditorStaff();

    const where = prismaMock.organizationUser.findMany.mock.calls[0][0].where;
    expect(where.facilities).toEqual({
      some: { facilityId: { in: ['annex'] }, active: true },
    });
  });

  it('overview: course COUNT stays org-wide while staff count and enrollments narrow', async () => {
    mockAuth.mockResolvedValue(SUPERVISOR);
    mockResolveDataFacilityIds.mockResolvedValue(['annex']);

    await getAuditorOverviewStats();

    expect(hasFacilityPredicate(prismaMock.course.count.mock.calls[0][0].where)).toBe(false);
    expect(prismaMock.organizationUser.count.mock.calls[0][0].where.facilities).toBeDefined();
    expect(
      prismaMock.enrollment.findMany.mock.calls[0][0].where.organizationUser.facilities,
    ).toBeDefined();
  });
});

describe('org-wide roles are not narrowed (TC-HR-001 must not regress)', () => {
  it('HR gets no facility predicate on any axis', async () => {
    mockAuth.mockResolvedValue(HR);
    mockResolveDataFacilityIds.mockResolvedValue(null);

    await getAuditorStaff();
    await getAuditorCourses();

    expect(hasFacilityPredicate(prismaMock.organizationUser.findMany.mock.calls[0][0].where)).toBe(
      false,
    );
    expect(hasFacilityPredicate(prismaMock.course.findMany.mock.calls[0][0].where)).toBe(false);
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
});
