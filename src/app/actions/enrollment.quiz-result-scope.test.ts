/**
 * `getEnrollmentWithResults` backs the admin-side quiz-results page and returns
 * question-by-question answers alongside the CORRECT answers. Its entire gate
 * was once `isEnrolledUser || isCourseCreator`.
 *
 * Cross-tenant was closed only by accident — both sides of the authorship test
 * compare against the caller's own `organizationUserId`, so no other tenant's
 * membership id could ever match. Nothing was closed by design, and nothing at
 * all narrowed by facility: whoever authored a course saw every participant's
 * answers, in any facility.
 *
 * The verb is `assessment.read`, not `enrollment.read`. `enrollment` is the
 * assignment and its progress, which every worker and Finance may read;
 * `assessment` is defined in the registry as "Quizzes, questions &
 * question-by-question attempt logs" — exactly this payload.
 *
 * Authorship was retired as a condition on 2026-09-17 (staging QA ISSUE-4). It
 * closed nothing the org and facility checks do not, and it made founder ruling
 * Q6 ("HR can build quizzes and view results") unreachable: HR authors almost no
 * courses, so HR held the verb and was still refused every real results page.
 * What governs now is ownership of the RECORD — the caller's own organisation —
 * which is what the sibling `getEnrollmentQuizResult` (staff.ts) has always
 * used for the same payload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockWorkerAuth,
  mockEnrollmentFindUnique,
  mockEnrollmentFindFirst,
  mockListAccessibleFacilities,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockEnrollmentFindUnique: vi.fn(),
  mockEnrollmentFindFirst: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    enrollment: { findUnique: mockEnrollmentFindUnique, findFirst: mockEnrollmentFindFirst },
    course: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    organizationUser: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    quiz: { findUnique: vi.fn() },
    quizAttempt: { create: vi.fn(), findMany: vi.fn() },
    courseAssignment: { create: vi.fn(), findFirst: vi.fn() },
    assignmentReminderStage: { upsert: vi.fn() },
    invite: { findMany: vi.fn(), count: vi.fn() },
    organization: { findUnique: vi.fn() },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('./notifications', () => ({
  createNotification: vi.fn(),
  notifyOrganizationAdmins: vi.fn(),
}));
vi.mock('@/lib/email', () => ({
  sendCourseInviteEmail: vi.fn(),
  sendCourseLaunchEmail: vi.fn(),
}));
// isOrgWideFacilityRole stays real so the org-wide vs facility-bound split is genuine.
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { getEnrollmentWithResults } from './enrollment';

const ORG_ID = 'org-1';
const OTHER_ORG_ID = 'org-2';
const LEARNER_OU = 'ou-learner';
const CREATOR_OU = 'ou-creator';

function enrollmentFixture(overrides: { organizationId?: string } = {}) {
  return {
    id: 'enr-1',
    organizationUserId: LEARNER_OU,
    organizationUser: {
      organizationId: overrides.organizationId ?? ORG_ID,
      user: { fullName: 'Dana Learner', email: 'dana@example.com' },
      organization: { name: 'Org One' },
    },
    course: {
      id: 'course-1',
      title: 'Infection Control',
      createdByOrgUserId: CREATOR_OU,
      lessons: [],
    },
    quizAttempts: [],
  };
}

/** The course creator — i.e. the caller the old authorship gate admitted. */
function setCreatorSession(role: string, organizationId: string | null = ORG_ID) {
  mockAuth.mockResolvedValue({
    user: { id: 'u-creator', role, organizationId, organizationUserId: CREATOR_OU },
  });
  mockWorkerAuth.mockResolvedValue(null);
}

/**
 * A same-org administrator who authored NOTHING — the caller the retired
 * authorship gate refused, and the one every real HR user is.
 */
function setNonAuthorSession(role: string, organizationId: string | null = ORG_ID) {
  mockAuth.mockResolvedValue({
    user: { id: 'u-bystander', role, organizationId, organizationUserId: 'ou-bystander' },
  });
  mockWorkerAuth.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnrollmentFindUnique.mockResolvedValue(enrollmentFixture());
  mockEnrollmentFindFirst.mockResolvedValue({ id: 'enr-1' });
  mockListAccessibleFacilities.mockResolvedValue([]);
});

describe('getEnrollmentWithResults — the learner', () => {
  it('reads their own results without any permission or facility resolution', async () => {
    mockAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w-1', role: 'nurse', organizationId: ORG_ID, organizationUserId: LEARNER_OU },
    });

    await expect(getEnrollmentWithResults('enr-1')).resolves.toMatchObject({ id: 'enr-1' });

    expect(mockListAccessibleFacilities).not.toHaveBeenCalled();
    expect(mockEnrollmentFindFirst).not.toHaveBeenCalled();
  });
});

describe('getEnrollmentWithResults — permission gate', () => {
  it('THE FIX: a course creator WITHOUT assessment.read is refused their own course’s results', async () => {
    // Finance authored nothing in practice, but the old gate asked only "is
    // this your membership id" — so proving the verb is what refuses, with
    // authorship satisfied, is the whole point.
    setCreatorSession('finance');

    await expect(getEnrollmentWithResults('enr-1')).rejects.toThrow('Access denied');
    expect(mockEnrollmentFindFirst).not.toHaveBeenCalled();
  });

  it('ISSUE-4: a manager holding assessment.read reads results for a course they did NOT author', async () => {
    // The exact shape that was broken on staging: the caller's membership id is
    // not the course's `createdByOrgUserId`. Under the retired authorship gate
    // this threw, and the page turned it into a 404 for every course an
    // administrator had not personally created.
    setNonAuthorSession('owner');

    await expect(getEnrollmentWithResults('enr-1')).resolves.toMatchObject({ id: 'enr-1' });
  });

  it('an unknown/stale role key is denied', async () => {
    setCreatorSession('not_a_real_role');

    await expect(getEnrollmentWithResults('enr-1')).rejects.toThrow('Access denied');
  });

  /**
   * The `isAdminRole` half is genuinely load-bearing HERE, unlike on the
   * admin-fenced `getEnrollmentQuizResult`: this action takes `resolveSession()`,
   * which falls back to the WORKER instance, so these are sessions a nurse can
   * really hold. Every worker role holds `assessment.read` so it can read its
   * OWN attempt, so the verb alone does not separate "my answers" from "theirs"
   * and would admit all eight to this id-addressed action.
   */
  it.each(['nurse', 'therapist_clinician', 'front_desk_admin'])(
    '%s holds assessment.read but is still denied someone else’s answers',
    async (role) => {
      // The WORKER instance, and authorship satisfied, so the tier check is the
      // only thing left that can refuse. Staging this on the admin instance
      // would model a session the decode fence invalidates.
      mockAuth.mockResolvedValue(null);
      mockWorkerAuth.mockResolvedValue({
        user: { id: 'w-1', role, organizationId: ORG_ID, organizationUserId: CREATOR_OU },
      });

      await expect(getEnrollmentWithResults('enr-1')).rejects.toThrow('Access denied');
      expect(mockEnrollmentFindFirst).not.toHaveBeenCalled();
    },
  );

  /**
   * Inverted twice. HR was first denied because the registry withheld
   * `assessment.read`; the founder's ruling on the Quiz row — "HR can build
   * quizzes and view results" (docs/local/RBAC_for_multi-tenancy-updated.md) —
   * granted the verb, and HR was STILL denied, because the gate also demanded
   * authorship of the course. This is the case staging QA proved broken, so it
   * is asserted on a course HR did not author: anything else re-passes for the
   * wrong reason.
   */
  it('ISSUE-4: HR reads results for a course HR did not author — the founder Q6 ruling, delivered', async () => {
    setNonAuthorSession('hr');

    await expect(getEnrollmentWithResults('enr-1')).resolves.toMatchObject({ id: 'enr-1' });
  });

  it('clinical_director — the registry’s assessment-oversight role — is admitted without authorship', async () => {
    setNonAuthorSession('clinical_director');

    await expect(getEnrollmentWithResults('enr-1')).resolves.toMatchObject({ id: 'enr-1' });
  });

  it('finance is still refused a course it did not author — the verb, not authorship, is the gate', async () => {
    setNonAuthorSession('finance');

    await expect(getEnrollmentWithResults('enr-1')).rejects.toThrow('Access denied');
    expect(mockEnrollmentFindFirst).not.toHaveBeenCalled();
  });
});

describe('getEnrollmentWithResults — tenancy and facility scope', () => {
  it('states cross-tenant isolation outright instead of relying on the authorship coincidence', async () => {
    setNonAuthorSession('owner');
    mockEnrollmentFindUnique.mockResolvedValue(enrollmentFixture({ organizationId: OTHER_ORG_ID }));

    await expect(getEnrollmentWithResults('enr-1')).rejects.toThrow('Access denied');
    expect(mockEnrollmentFindFirst).not.toHaveBeenCalled();
  });

  it('THE FIX: a facility-bound creator is refused results for a learner outside their facilities', async () => {
    setCreatorSession('supervisor');
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);
    // What the scoped query genuinely yields for an out-of-facility learner.
    mockEnrollmentFindFirst.mockResolvedValue(null);

    await expect(getEnrollmentWithResults('enr-1')).rejects.toThrow('Access denied');
  });

  it('narrows the scoped re-read to the caller’s accessible facilities', async () => {
    setCreatorSession('supervisor');
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);

    await getEnrollmentWithResults('enr-1');

    const where = mockEnrollmentFindFirst.mock.calls[0][0].where;
    expect(where.id).toBe('enr-1');
    expect(where.organizationUser.is.facilities).toEqual({
      some: { facilityId: { in: ['fac-1'] }, active: true },
    });
  });

  it('FAIL-CLOSED: no accessible facilities narrows to `in: []`, never to the whole org', async () => {
    setCreatorSession('supervisor');
    mockListAccessibleFacilities.mockResolvedValue([]);

    await getEnrollmentWithResults('enr-1');

    const where = mockEnrollmentFindFirst.mock.calls[0][0].where;
    expect(where.organizationUser.is.facilities).toEqual({
      some: { facilityId: { in: [] }, active: true },
    });
  });

  it('an ORG-WIDE creator (owner) applies no facility predicate and reads the results', async () => {
    setCreatorSession('owner');

    await expect(getEnrollmentWithResults('enr-1')).resolves.toMatchObject({ id: 'enr-1' });

    const where = mockEnrollmentFindFirst.mock.calls[0][0].where;
    expect(where.organizationUser.is.facilities).toBeUndefined();
  });
});
