/**
 * `getEnrollmentWithResults` backs the admin-side quiz-results page and returns
 * question-by-question answers alongside the CORRECT answers. Its entire gate
 * was `isEnrolledUser || isCourseCreator`.
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

  it('holding assessment.read without authorship is still refused — the fix narrows, it never widens', async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: 'u-x',
        role: 'owner',
        organizationId: ORG_ID,
        organizationUserId: 'ou-bystander',
      },
    });
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getEnrollmentWithResults('enr-1')).rejects.toThrow('Access denied');
    expect(mockEnrollmentFindFirst).not.toHaveBeenCalled();
  });

  it('an unknown/stale role key is denied', async () => {
    setCreatorSession('not_a_real_role');

    await expect(getEnrollmentWithResults('enr-1')).rejects.toThrow('Access denied');
  });
});

describe('getEnrollmentWithResults — tenancy and facility scope', () => {
  it('states cross-tenant isolation outright instead of relying on the authorship coincidence', async () => {
    setCreatorSession('owner');
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
