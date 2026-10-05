import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockWorkerAuth,
  mockCourseFindMany,
  mockOfferingFindMany,
  mockEnrollmentGroupBy,
  mockEnrollmentFindMany,
  mockFacilityFindMany,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindMany: vi.fn(),
  mockOfferingFindMany: vi.fn(),
  mockEnrollmentGroupBy: vi.fn(),
  mockEnrollmentFindMany: vi.fn(),
  mockFacilityFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findMany: mockCourseFindMany },
    // Read by `orgCourseWhere` / `listAdoptedCourseIds` (the REAL module — the
    // point of RISK-11 is that getCourses goes through it).
    orgCourseOffering: { findMany: mockOfferingFindMany },
    enrollment: { groupBy: mockEnrollmentGroupBy, findMany: mockEnrollmentFindMany },
    // getCourses facility-scopes its enrollment tallies, which resolves the
    // caller's accessible facilities for anything but an org-wide role.
    facility: { findMany: mockFacilityFindMany },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));

import { getCourses } from './course';
import { orgCourseWhere } from '@/lib/course/org-scope';

const courseRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: id,
  description: null,
  thumbnailStorageUri: null,
  previewPosterStorageUri: null,
  status: 'published',
  type: 'document',
  duration: 10,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  organizationId: 'org-1',
  _count: { lessons: 0 },
  lessons: [],
  versions: [],
  ...overrides,
});

/** A latest-version lineage row pointing at a live source document. */
const liveLineage = (documentId: string) => [
  { documentVersion: { documentId, document: { archivedAt: null } } },
];

beforeEach(() => {
  vi.clearAllMocks();
  // Post User/OrganizationUser split: the session itself carries the active
  // membership id and org id directly — there is no separate `prisma.user`
  // lookup to enrich the session with org context.
  mockAuth.mockResolvedValue({
    user: {
      id: 'admin-1',
      role: 'admin',
      organizationUserId: 'ou-admin-1',
      organizationId: 'org-1',
    },
  });
  mockWorkerAuth.mockResolvedValue(null);
  mockCourseFindMany.mockResolvedValue([]);
  mockOfferingFindMany.mockResolvedValue([]);
  mockEnrollmentGroupBy.mockResolvedValue([]);
  mockEnrollmentFindMany.mockResolvedValue([]);
  mockFacilityFindMany.mockResolvedValue([]);
});

describe('getCourses', () => {
  it('includes adopted offered video courses alongside own courses', async () => {
    mockOfferingFindMany.mockResolvedValue([{ courseId: 'global-1' }]);
    mockCourseFindMany.mockResolvedValue([
      courseRow('own-1'),
      courseRow('global-1', {
        type: 'video',
        duration: 30,
        _count: { lessons: 1 },
        // Cross-tenant publisher: lineage must resolve to null for this org.
        organizationId: 'other-org',
        versions: liveLineage('their-doc'),
      }),
    ]);
    mockEnrollmentGroupBy.mockResolvedValue([
      { courseId: 'global-1', status: 'completed', _count: { _all: 1 } },
    ]);

    const result = await getCourses();

    expect(result.map((c) => c.id)).toEqual(['own-1', 'global-1']);
    expect(result.find((c) => c.id === 'global-1')).toMatchObject({
      enrollmentsCount: 1,
      completionRate: 100,
      lessonsCount: 1,
      isOrgAuthored: false,
      sourceDocumentId: null,
    });
    expect(result.find((c) => c.id === 'own-1')).toMatchObject({
      enrollmentsCount: 0,
      isOrgAuthored: true,
    });
  });

  it('keeps a same-org course’s source-document lineage (COU-004)', async () => {
    mockCourseFindMany.mockResolvedValue([
      courseRow('colleague-1', { versions: liveLineage('doc-1') }),
    ]);

    const [course] = await getCourses();

    expect(course.sourceDocumentId).toBe('doc-1');
  });

  // Previously two reads, own then adopted. The single read is ordered by
  // creation date, so the org's own courses are put back in front.
  it('lists the organisation’s own courses ahead of adopted ones', async () => {
    mockOfferingFindMany.mockResolvedValue([{ courseId: 'adopted-new' }]);
    mockCourseFindMany.mockResolvedValue([
      courseRow('adopted-new', { organizationId: 'other-org' }),
      courseRow('own-old'),
    ]);

    const result = await getCourses();

    expect(result.map((c) => c.id)).toEqual(['own-old', 'adopted-new']);
  });
});

/**
 * Team QA #15 / C1 — "Any course created is global, so should be viewable by
 * any manager + supervisor with access to courses" — and RISK-11: the manager
 * list is "the organisation's courses" by the SAME predicate the dashboards and
 * audit reports use (`orgCourseWhere`), not a second union keyed on the
 * author's membership.
 *
 * Asserted on the Prisma `where` the action builds, because the scope decision
 * lives in the query.
 */
describe('getCourses — org-manager visibility (#15, RISK-11)', () => {
  const sessionFor = (role?: string) => ({
    user: {
      id: 'u-1',
      role,
      organizationUserId: 'ou-1',
      organizationId: 'org-1',
    },
  });

  it.each(['owner', 'admin', 'hr', 'clinical_director', 'supervisor'])(
    '%s lists the organisation’s courses by orgCourseWhere',
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));

      await getCourses();

      const where = mockCourseFindMany.mock.calls[0][0].where;
      expect(where).toEqual(await orgCourseWhere('org-1'));
      expect(where).toEqual({ organizationId: 'org-1' });
    },
  );

  it('an organisation with adopted courses gets the same union the dashboards use', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner'));
    mockOfferingFindMany.mockResolvedValue([{ courseId: 'adopted-1' }]);

    await getCourses();

    expect(mockCourseFindMany.mock.calls[0][0].where).toEqual({
      OR: [{ organizationId: 'org-1' }, { id: { in: ['adopted-1'] } }],
    });
    expect(mockOfferingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' } }),
    );
  });

  it('never keys on the author or the author’s membership', async () => {
    mockAuth.mockResolvedValue(sessionFor('supervisor'));

    await getCourses();

    const where = mockCourseFindMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('createdByOrgUserId');
    expect(where).not.toHaveProperty('creator');
  });

  it('finance is NOT widened — it lost course.read (#9)', async () => {
    mockAuth.mockResolvedValue(sessionFor('finance'));

    await getCourses();

    expect(mockCourseFindMany.mock.calls[0][0].where).toEqual({ createdByOrgUserId: 'ou-1' });
  });

  it('a worker is NOT widened — worker roles hold course.read for their OWN enrolled courses', async () => {
    mockAuth.mockResolvedValue(sessionFor('nurse'));

    await getCourses();

    expect(mockCourseFindMany.mock.calls[0][0].where).toEqual({ createdByOrgUserId: 'ou-1' });
  });

  it('a non-manager still sees the organisation’s adopted offerings beside their own courses', async () => {
    mockAuth.mockResolvedValue(sessionFor('nurse'));
    mockOfferingFindMany.mockResolvedValue([{ courseId: 'adopted-1' }]);

    await getCourses();

    expect(mockCourseFindMany.mock.calls[0][0].where).toEqual({
      OR: [{ createdByOrgUserId: 'ou-1' }, { id: { in: ['adopted-1'] } }],
    });
  });

  it('the enrollment tally covers exactly the listed courses, with the learner pinned to this org', async () => {
    mockAuth.mockResolvedValue(sessionFor('hr'));
    mockCourseFindMany.mockResolvedValue([courseRow('c-1'), courseRow('c-2')]);

    await getCourses();

    // The learner is pinned as well as the course. A video course is adopted by
    // many organisations, so a course-only predicate counts other tenants'
    // enrollments.
    expect(mockEnrollmentGroupBy.mock.calls[0][0].where).toEqual({
      courseId: { in: ['c-1', 'c-2'] },
      organizationUser: { organizationId: 'org-1', active: true },
    });
  });

  it('skips the tally entirely when nothing is listed', async () => {
    mockAuth.mockResolvedValue(sessionFor('hr'));

    await expect(getCourses()).resolves.toEqual([]);
    expect(mockEnrollmentGroupBy).not.toHaveBeenCalled();
  });
});

/**
 * The per-course headline figures (enrolled/completion) must not disagree with
 * the roster beneath them: getCourseById's roster is facility-narrowed for a
 * supervisor, so a card reporting an organisation-wide "42 enrolled" over that
 * narrowed roster would itself be a leak of the same kind.
 */
describe('getCourses — facility-scoped enrollment tallies', () => {
  const sessionFor = (role: string) => ({
    user: { id: 'u-1', role, organizationUserId: 'ou-1', organizationId: 'org-1' },
  });

  beforeEach(() => {
    mockCourseFindMany.mockResolvedValue([courseRow('c-1')]);
  });

  it('an ORG-WIDE role (admin) applies NO facility filter to the enrollment tally', async () => {
    mockAuth.mockResolvedValue(sessionFor('admin'));

    await getCourses();

    const where = mockEnrollmentGroupBy.mock.calls[0][0].where;
    expect(where.facilityId).toBeUndefined();
    expect(where.organizationUser).toEqual({ organizationId: 'org-1', active: true });
  });

  // BUG-37: by CURRENT roster, never by the `Enrollment.facilityId` stamp — and
  // merged into the one `organizationUser` object, so the org pin survives.
  it('a FACILITY-BOUND role (supervisor) narrows the tally by current roster, keeping the org pin', async () => {
    mockAuth.mockResolvedValue(sessionFor('supervisor'));
    mockFacilityFindMany.mockResolvedValue([{ id: 'fac-1' }]);

    await getCourses();

    const where = mockEnrollmentGroupBy.mock.calls[0][0].where;
    expect(where.facilityId).toBeUndefined();
    expect(where.organizationUser).toEqual({
      organizationId: 'org-1',
      active: true,
      facilities: { some: { facilityId: { in: ['fac-1'] }, active: true } },
    });
  });

  it('FAIL-CLOSED: a facility-bound role with no accessible facilities narrows the tally to an impossible `in: []`', async () => {
    mockAuth.mockResolvedValue(sessionFor('supervisor'));
    mockFacilityFindMany.mockResolvedValue([]);

    await getCourses();

    const where = mockEnrollmentGroupBy.mock.calls[0][0].where;
    expect(where.organizationUser.facilities).toEqual({
      some: { facilityId: { in: [] }, active: true },
    });
  });

  it('looks retakes up once, over the same predicate as the tally', async () => {
    mockAuth.mockResolvedValue(sessionFor('supervisor'));
    mockFacilityFindMany.mockResolvedValue([{ id: 'fac-1' }]);
    mockCourseFindMany.mockResolvedValue([courseRow('c-1'), courseRow('c-2')]);

    await getCourses();

    expect(mockEnrollmentFindMany).toHaveBeenCalledTimes(1);
    const { where } = mockEnrollmentFindMany.mock.calls[0][0];
    const { where: tallyWhere } = mockEnrollmentGroupBy.mock.calls[0][0];
    expect(where).toEqual({ ...tallyWhere, retakeOf: { not: null } });
  });
});

/**
 * BUG-37 behaviour over an in-memory roster: the card figures follow where a
 * member works NOW (active `OrganizationUserFacility` rows), as the dashboards
 * do, and drop retake-superseded enrolments (BUG-38).
 */
describe('getCourses — card counts by current-facility attribution (BUG-37)', () => {
  type Member = {
    id: string;
    organizationId: string;
    active?: boolean;
    activeFacilityIds: string[];
  };
  type Row = {
    id: string;
    courseId: string;
    status: string;
    organizationUserId: string;
    /** The assignment-time stamp — must never decide attribution. */
    facilityId: string | null;
    retakeOf: string | null;
  };
  type TallyWhere = {
    courseId: { in: string[] };
    organizationUser: {
      organizationId?: string;
      active?: true;
      facilities?: { some: { facilityId: { in: string[] }; active: true } };
    };
    id?: { notIn: string[] };
    retakeOf?: { not: null };
  };

  let members: Member[] = [];
  let rows: Row[] = [];

  function matches(where: TallyWhere, row: Row): boolean {
    const member = members.find((m) => m.id === row.organizationUserId);
    if (!member) return false;
    if (!where.courseId.in.includes(row.courseId)) return false;
    const { organizationId, active, facilities } = where.organizationUser;
    if (organizationId !== undefined && member.organizationId !== organizationId) return false;
    if (active && member.active === false) return false;
    if (
      facilities &&
      !member.activeFacilityIds.some((id) => facilities.some.facilityId.in.includes(id))
    ) {
      return false;
    }
    if (where.id && where.id.notIn.includes(row.id)) return false;
    if (where.retakeOf && row.retakeOf === null) return false;
    return true;
  }

  const sessionFor = (role: string) => ({
    user: { id: 'u-viewer', role, organizationUserId: 'ou-viewer', organizationId: 'org-1' },
  });

  async function cardFor(role: string, accessibleFacilityIds: string[]) {
    mockAuth.mockResolvedValue(sessionFor(role));
    mockFacilityFindMany.mockResolvedValue(accessibleFacilityIds.map((id) => ({ id })));
    const [card] = await getCourses();
    return { enrolled: card.enrollmentsCount, completion: card.completionRate };
  }

  beforeEach(() => {
    // Tom enrolled while at facility A and has since TRANSFERRED to B; Bea has
    // always been at B; Ada is at A. Only Tom's stamp disagrees with his roster.
    members = [
      { id: 'ou-tom', organizationId: 'org-1', activeFacilityIds: ['fac-b'] },
      { id: 'ou-bea', organizationId: 'org-1', activeFacilityIds: ['fac-b'] },
      { id: 'ou-ada', organizationId: 'org-1', activeFacilityIds: ['fac-a'] },
      { id: 'ou-other-tenant', organizationId: 'org-2', activeFacilityIds: ['fac-b'] },
    ];
    rows = [
      {
        id: 'e-tom',
        courseId: 'c-1',
        status: 'completed',
        organizationUserId: 'ou-tom',
        facilityId: 'fac-a',
        retakeOf: null,
      },
      {
        id: 'e-bea',
        courseId: 'c-1',
        status: 'in_progress',
        organizationUserId: 'ou-bea',
        facilityId: 'fac-b',
        retakeOf: null,
      },
      {
        id: 'e-ada',
        courseId: 'c-1',
        status: 'attested',
        organizationUserId: 'ou-ada',
        facilityId: 'fac-a',
        retakeOf: null,
      },
      {
        id: 'e-other-tenant',
        courseId: 'c-1',
        status: 'completed',
        organizationUserId: 'ou-other-tenant',
        facilityId: 'fac-b',
        retakeOf: null,
      },
    ];

    mockCourseFindMany.mockResolvedValue([courseRow('c-1')]);
    mockEnrollmentFindMany.mockImplementation(({ where }: { where: TallyWhere }) =>
      Promise.resolve(
        rows.filter((row) => matches(where, row)).map(({ retakeOf }) => ({ retakeOf })),
      ),
    );
    mockEnrollmentGroupBy.mockImplementation(({ where }: { where: TallyWhere }) => {
      const buckets = new Map<
        string,
        { courseId: string; status: string; _count: { _all: number } }
      >();
      for (const row of rows.filter((r) => matches(where, r))) {
        const key = `${row.courseId}|${row.status}`;
        const bucket = buckets.get(key) ?? {
          courseId: row.courseId,
          status: row.status,
          _count: { _all: 0 },
        };
        bucket._count._all += 1;
        buckets.set(key, bucket);
      }
      return Promise.resolve([...buckets.values()]);
    });
  });

  it('the NEW facility’s supervisor counts a transferred member', async () => {
    expect(await cardFor('supervisor', ['fac-b'])).toEqual({ enrolled: 2, completion: 50 });
  });

  it('the OLD facility’s supervisor no longer counts them, whatever the stamp says', async () => {
    expect(await cardFor('supervisor', ['fac-a'])).toEqual({ enrolled: 1, completion: 100 });
  });

  it('a multi-facility supervisor counts every member of either facility, still inside the org', async () => {
    // Guards the spread-merge pitfall: had the facility predicate overwritten
    // the org pin, the other tenant's learner would make this 4.
    expect(await cardFor('supervisor', ['fac-a', 'fac-b'])).toEqual({
      enrolled: 3,
      completion: 67,
    });
  });

  it('an org-wide role is unaffected — the whole organisation, no other tenant', async () => {
    expect(await cardFor('owner', [])).toEqual({ enrolled: 3, completion: 67 });
  });

  it('drops a retake-superseded enrolment, counting the retake in its place', async () => {
    rows = rows.map((row) => (row.id === 'e-bea' ? { ...row, status: 'locked' } : row));
    rows.push({
      id: 'e-bea-retake',
      courseId: 'c-1',
      status: 'completed',
      organizationUserId: 'ou-bea',
      facilityId: 'fac-b',
      retakeOf: 'e-bea',
    });

    expect(await cardFor('supervisor', ['fac-b'])).toEqual({ enrolled: 2, completion: 100 });
    expect(mockEnrollmentGroupBy.mock.calls[0][0].where.id).toEqual({ notIn: ['e-bea'] });
  });

  // Removed from the organisation (founder Q23 keeps their enrolments): the
  // dashboards count the current workforce only, and so do the cards.
  it('drops a deactivated member’s retained enrolment, for scoped and org-wide viewers alike', async () => {
    members = members.map((m) => (m.id === 'ou-bea' ? { ...m, active: false } : m));

    expect(await cardFor('supervisor', ['fac-b'])).toEqual({ enrolled: 1, completion: 100 });
    expect(await cardFor('owner', [])).toEqual({ enrolled: 2, completion: 100 });
  });

  it('adds no id exclusion when nothing was retaken', async () => {
    await cardFor('supervisor', ['fac-b']);

    expect(mockEnrollmentGroupBy.mock.calls[0][0].where.id).toBeUndefined();
  });
});

/**
 * BUG-17: the Courses list draws a video course from `thumbnail`, which must be
 * the access-checked route URL (never a storage URI) resolved in the same query
 * — one ordered lesson per course, no per-row lookups.
 */
describe('getCourses — video thumbnails', () => {
  const lessonUpdatedAt = new Date('2026-09-10T00:00:00.000Z');
  const videoRow = (id: string, type: string, poster: string | null) =>
    courseRow(id, {
      type,
      _count: { lessons: 1 },
      lessons: [{ videoPosterStorageUri: poster, updatedAt: lessonUpdatedAt }],
    });

  it('returns the route URL for a video course with a poster and null otherwise', async () => {
    mockCourseFindMany.mockResolvedValue([
      videoRow('video-1', 'video', 'gcs://lms/system/videos/posters/1.jpg'),
      videoRow('video-2', 'video', null),
      videoRow('reading-1', 'text', 'gcs://lms/system/videos/posters/2.jpg'),
    ]);

    const result = await getCourses();

    const thumbnails = Object.fromEntries(result.map((c) => [c.id, c.thumbnail]));
    expect(thumbnails).toEqual({
      'video-1': `/api/courses/video-1/thumbnail?v=${lessonUpdatedAt.getTime()}`,
      'video-2': null,
      'reading-1': null,
    });
  });

  it('selects one ordered lesson per course, own and adopted alike, in the single read', async () => {
    await getCourses();

    expect(mockCourseFindMany).toHaveBeenCalledTimes(1);
    expect(mockCourseFindMany.mock.calls[0][0].select.lessons).toEqual({
      orderBy: { order: 'asc' },
      take: 1,
      select: { videoPosterStorageUri: true, updatedAt: true },
    });
  });
});
