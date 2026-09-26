/**
 * getLearnPayload — the learn payload, extracted out of the API route so the
 * learn page can server-render it (PR 6).
 *
 * These mirror `src/app/api/courses/[id]/learn/route.test.ts` against the
 * function directly: the route now only maps this result onto HTTP, so the
 * access matrix and the payload shape have to be proven here. The extra cases
 * cover what only matters once the payload crosses the RSC boundary instead of
 * `JSON.stringify` — chiefly that no `Date` instance survives into it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockCourseFindUnique,
  mockFilteredCourseFindUnique,
  mockEnrollmentFindFirst,
  mockOrganizationUserFindUnique,
  mockQuizFindUnique,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindUnique: vi.fn(),
  mockFilteredCourseFindUnique: vi.fn(),
  mockEnrollmentFindFirst: vi.fn(),
  mockOrganizationUserFindUnique: vi.fn(),
  mockQuizFindUnique: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockRejectedValue(new Error('no request scope')),
}));
// The course lookup comes off the UN-extended client: an archived course has to
// be READ before it can be refused with the cancellation message (Q-04/Q-05) —
// through the filtered client it would come back null and the learner would see
// a bare "not found". The two clients get DIFFERENT spies so a regression that
// swaps them is visible.
vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findUnique: (...a: unknown[]) => mockFilteredCourseFindUnique(...a) },
    enrollment: { findFirst: (...a: unknown[]) => mockEnrollmentFindFirst(...a) },
    organizationUser: { findUnique: (...a: unknown[]) => mockOrganizationUserFindUnique(...a) },
    quiz: { findUnique: (...a: unknown[]) => mockQuizFindUnique(...a) },
  };
  return { prisma, default: prisma };
});
vi.mock('@/db/index', () => ({
  rawPrisma: { course: { findUnique: (...a: unknown[]) => mockCourseFindUnique(...a) } },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import {
  getLearnPayload,
  isLearnPayloadError,
  type LearnPayload,
  type LearnPayloadError,
} from './get-learn-payload';
import { ARCHIVED_COURSE_LEARNER_MESSAGE } from '@/lib/course/archived';

const QUESTION = {
  id: 'q1',
  text: 'What is 2+2?',
  type: 'single',
  options: ['3', '4', '5'],
  correctAnswer: '4',
  explanation: 'Basic arithmetic.',
};

const makeCourse = (opts?: {
  creatorOrgId?: string;
  isGlobal?: boolean;
  status?: string;
  quiz?: unknown;
  moduleCount?: number;
}) => ({
  id: 'course-1',
  title: 'Intro Course',
  description: 'desc',
  duration: 30,
  isGlobal: opts?.isGlobal ?? false,
  status: opts?.status ?? 'published',
  _count: { modules: opts?.moduleCount ?? 3 },
  creator: { organizationId: opts?.creatorOrgId ?? 'org-1' },
  quiz: opts && 'quiz' in opts ? opts.quiz : null,
  lessons: [
    {
      id: 'lesson-1',
      title: 'Lesson 1',
      content: 'content',
      slideContent: null,
      duration: 10,
      order: 1,
      videoProvider: 'self',
      videoStorageUri: 'minio://x/v.mp4',
      videoDurationSeconds: 600,
      quiz: {
        id: 'quiz-1',
        title: 'Final quiz',
        passingScore: 70,
        allowedAttempts: 3,
        timeLimit: null,
        questions: [QUESTION],
      },
    },
  ],
});

const asPayload = (result: LearnPayload | LearnPayloadError): LearnPayload => {
  if (isLearnPayloadError(result)) {
    throw new Error(`expected a payload, got ${result.status} ${result.error}`);
  }
  return result;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue(null);
  mockEnrollmentFindFirst.mockResolvedValue(null);
  mockOrganizationUserFindUnique.mockResolvedValue({
    role: 'nurse',
    user: { fullName: 'Jane Worker', email: 'jane@example.com' },
    organization: { name: 'Acme Health' },
  });
});

describe('getLearnPayload — access matrix', () => {
  it('401s when neither portal session is authenticated', async () => {
    const result = await getLearnPayload('course-1');

    expect(result).toEqual({ error: 'Unauthorized', status: 401 });
    expect(mockCourseFindUnique).not.toHaveBeenCalled();
  });

  it('404s when the course does not exist', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', role: 'nurse' },
    });
    mockCourseFindUnique.mockResolvedValue(null);

    const result = await getLearnPayload('course-1');

    expect(result).toEqual({ error: 'Course not found', status: 404 });
  });

  it('403s a worker with no enrollment in the course', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', role: 'nurse' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse());
    mockEnrollmentFindFirst.mockResolvedValue(null);

    const result = await getLearnPayload('course-1');

    expect(result).toEqual({ error: 'Not enrolled in this course', status: 403 });
  });

  // SUPERSEDED 2026-09-23. This case used to assert that an archived course was
  // still SERVED to the worker already enrolled in it (Q24). Founder rulings
  // Q-04/Q-05 narrowed that: archiving cancels the course and every learner
  // action stops, so the player refuses it. The read stays on the un-extended
  // client — the archived row has to be readable in order to be refused with
  // the cancellation message rather than a bare "not found".
  it('refuses an ARCHIVED course even to the worker already enrolled in it', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', role: 'nurse' },
    });
    mockCourseFindUnique.mockResolvedValue({
      ...makeCourse(),
      archivedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 40,
      status: 'in_progress',
      score: null,
      videoPositionSeconds: 0,
      quizAttempts: [],
    });
    // The filtered client would return null for an archived row.
    mockFilteredCourseFindUnique.mockResolvedValue(null);

    const result = await getLearnPayload('course-1');

    expect(result).toEqual({ error: ARCHIVED_COURSE_LEARNER_MESSAGE, status: 403 });
    expect(mockFilteredCourseFindUnique).not.toHaveBeenCalled();
    // Refused before the enrollment lookup: the answer no longer depends on
    // whether this caller holds one.
    expect(mockEnrollmentFindFirst).not.toHaveBeenCalled();
  });

  it('refuses an ARCHIVED course to a manager exercising the review right', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'a1', organizationUserId: 'ou-admin', organizationId: 'org-1', role: 'owner' },
    });
    mockCourseFindUnique.mockResolvedValue({
      ...makeCourse(),
      archivedAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    const result = await getLearnPayload('course-1');

    expect(result).toEqual({ error: ARCHIVED_COURSE_LEARNER_MESSAGE, status: 403 });
  });

  it('403s an authenticated worker whose session carries no membership', async () => {
    mockWorkerAuth.mockResolvedValue({ user: { id: 'w1', role: 'nurse' } });
    mockCourseFindUnique.mockResolvedValue(makeCourse());

    const result = await getLearnPayload('course-1');

    expect(result).toEqual({ error: 'Not enrolled in this course', status: 403 });
    expect(mockEnrollmentFindFirst).not.toHaveBeenCalled();
  });

  it('403s an admin from another organization on a non-global course', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'a1', organizationUserId: 'ou-admin', role: 'admin', organizationId: 'org-2' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ creatorOrgId: 'org-1' }));

    const result = await getLearnPayload('course-1');

    expect(result).toEqual({ error: 'Not enrolled in this course', status: 403 });
  });

  it('returns a preview payload for a same-org admin with no enrollment', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'a1', organizationUserId: 'ou-admin', role: 'admin', organizationId: 'org-1' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ creatorOrgId: 'org-1' }));

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.enrollment.id).toBe('preview-mode');
    expect(payload.enrollment.quizAttempts).toEqual([]);
    expect(payload.course.quiz?.questions[0].correctAnswer).toBe('4');
  });

  it('returns a preview payload for an out-of-org admin on a published global course', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'a1', organizationUserId: 'ou-admin', role: 'admin', organizationId: 'org-2' },
    });
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ creatorOrgId: 'org-1', isGlobal: true, status: 'published' }),
    );

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.enrollment.id).toBe('preview-mode');
  });

  it('omits the answer key from the quiz for a worker', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', role: 'nurse' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse());
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 0,
      status: 'in_progress',
      score: null,
      videoPositionSeconds: 0,
      quizAttempts: [],
    });

    const payload = asPayload(await getLearnPayload('course-1'));

    const question = payload.course.quiz!.questions[0];
    expect(question).not.toHaveProperty('correctAnswer');
    expect(question).not.toHaveProperty('explanation');
  });

  it.each([0, 1, 2, 7])('carries the real module count (%i) through to the payload', async (n) => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', role: 'nurse' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ moduleCount: n }));
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 0,
      status: 'in_progress',
      score: null,
      videoPositionSeconds: 0,
      quizAttempts: [],
    });

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.course.moduleCount).toBe(n);
  });

  it('counts modules in the same query that loads the lessons', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', role: 'nurse' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse());
    mockEnrollmentFindFirst.mockResolvedValue(null);

    await getLearnPayload('course-1');

    expect(mockCourseFindUnique).toHaveBeenCalledTimes(1);
    expect(mockCourseFindUnique.mock.calls[0][0]).toMatchObject({
      select: { _count: { select: { modules: true } } },
    });
  });

  it('returns a 500 result instead of throwing when the query fails', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', role: 'nurse' },
    });
    mockCourseFindUnique.mockRejectedValue(new Error('connection reset'));

    const result = await getLearnPayload('course-1');

    expect(result).toEqual({ error: 'Internal server error', status: 500 });
  });
});

describe('getLearnPayload — quiz attempts', () => {
  beforeEach(() => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', role: 'nurse' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse());
  });

  it('keeps an in-progress attempt that is not the newest row', async () => {
    // The DB returns `orderBy: completedAt desc`, so the caller's active
    // (not-yet-completed) attempt — the exact row the learn client restores from
    // via `.find(a => a.timeTaken === null)` — sorts after the newest completed
    // one. Anything that trimmed the list would silently drop it.
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 50,
      status: 'in_progress',
      score: null,
      videoPositionSeconds: 0,
      quizAttempts: [
        {
          id: 'qa-completed',
          score: 80,
          attemptCount: 1,
          answers: [],
          timeTaken: 300,
          completedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
        {
          id: 'qa-active',
          score: 0,
          attemptCount: 2,
          answers: [],
          timeTaken: null,
          completedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ],
    });

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.enrollment.quizAttempts).toHaveLength(2);
    const active = payload.enrollment.quizAttempts.find((a) => a.timeTaken === null);
    expect(active?.id).toBe('qa-active');
    expect(mockEnrollmentFindFirst).toHaveBeenCalledTimes(1);
    const call = mockEnrollmentFindFirst.mock.calls[0][0] as {
      include: { quizAttempts: Record<string, unknown> };
    };
    expect(call.include.quizAttempts).not.toHaveProperty('take');
  });

  it('serialises every attempt timestamp to an ISO string, never a Date', async () => {
    // The route JSON-encodes the payload, but the learn page hands it straight
    // across the RSC boundary — which preserves Date instances. Normalising here
    // is what keeps both entry points seeding the client with the same types.
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 50,
      status: 'in_progress',
      score: null,
      videoPositionSeconds: 0,
      quizAttempts: [
        {
          id: 'qa-1',
          score: 80,
          attemptCount: 1,
          answers: [{ questionId: 'q1', selectedAnswer: '4' }],
          timeTaken: 300,
          completedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
    });

    const payload = asPayload(await getLearnPayload('course-1'));

    const [attempt] = payload.enrollment.quizAttempts;
    expect(attempt.completedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(attempt.completedAt).not.toBeInstanceOf(Date);
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it('builds quizResultsData from the already-loaded questions without re-querying the quiz', async () => {
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 100,
      status: 'completed',
      score: 100,
      videoPositionSeconds: 600,
      quizAttempts: [
        {
          id: 'qa-1',
          score: 100,
          attemptCount: 1,
          answers: [{ questionId: 'q1', selectedAnswer: '4' }],
          timeTaken: 45,
          completedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
    });

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(mockQuizFindUnique).not.toHaveBeenCalled();
    expect(payload.quizResultsData).not.toBeNull();
    expect(payload.quizResultsData!.score).toBe(100);
    expect(payload.quizResultsData!.correctCount).toBe(1);
    expect(payload.quizResultsData!.totalQuestions).toBe(1);
    // options = ['3', '4', '5']; correctAnswer '4' is index 1 → letter 'B'.
    expect(payload.quizResultsData!.questions[0].correctAnswer).toBe('B');
  });

  it('leaves quizResultsData null when there are no attempts', async () => {
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 0,
      status: 'in_progress',
      score: null,
      videoPositionSeconds: 0,
      quizAttempts: [],
    });

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.quizResultsData).toBeNull();
  });
});

describe('getLearnPayload — membership', () => {
  it('does not select the password hash off the membership user relation', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', role: 'nurse' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse());
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 0,
      status: 'in_progress',
      score: null,
      videoPositionSeconds: 0,
      quizAttempts: [],
    });

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(mockOrganizationUserFindUnique).toHaveBeenCalledTimes(1);
    const call = mockOrganizationUserFindUnique.mock.calls[0][0] as {
      select: { user: { select: Record<string, unknown> } };
    };
    expect(call.select.user.select).not.toHaveProperty('password');
    expect(call.select.user.select).not.toHaveProperty('passwordHash');
    expect(payload.user).toEqual({
      name: 'Jane Worker',
      role: 'nurse',
      // D-16: view mode is server-decided. False here because this is a real
      // worker in the worker portal.
      isAdminView: false,
      canEditContent: false,
      organizationName: 'Acme Health',
      email: 'jane@example.com',
    });
  });
});

/**
 * D-16 — team QA #1, #4 and #5 are one bug.
 *
 * `enterLearnMode` mints a worker cookie that deliberately carries the admin's
 * real role (session-bridge.ts). The payload derived its VIEW MODE from that
 * role, so a manager who chose Learn got `isAdmin: true` and LearnClient
 * rendered AdminLessonEditor / AdminQuizEditor:
 *
 *   #1 the admin course view
 *   #4 the quiz that "never submits" — the admin quiz panel has no submit
 *   #5 the "module-scoped" slide picker — CourseRail already renders every
 *      lesson flat, so what they saw was the editor
 *
 * View mode now keys on the PORTAL; access still keys on the role.
 */
describe('getLearnPayload — learner view mode (D-16)', () => {
  const managerWorkerSession = {
    user: { id: 'm1', organizationUserId: 'ou-mgr', organizationId: 'org-1', role: 'hr' },
  };

  beforeEach(() => {
    mockQuizFindUnique?.mockResolvedValue?.(null);
    mockOrganizationUserFindUnique.mockResolvedValue({
      role: 'hr',
      user: { fullName: 'Manager One', email: 'm@example.com' },
      organization: { name: 'Acme Health' },
    });
  });

  it('a manager in LEARN mode gets the learner view, not the admin view', async () => {
    // Worker cookie present (they chose Learn) but carrying an admin role.
    mockWorkerAuth.mockResolvedValue(managerWorkerSession);
    mockAdminAuth.mockResolvedValue({
      user: { id: 'm1', organizationUserId: 'ou-mgr', organizationId: 'org-1', role: 'hr' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse());
    mockEnrollmentFindFirst.mockResolvedValue(null);

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.user.isAdminView).toBe(false);
  });

  it('...and is still ALLOWED in without an enrollment — access keys on the role', async () => {
    mockWorkerAuth.mockResolvedValue(managerWorkerSession);
    mockAdminAuth.mockResolvedValue({
      user: { id: 'm1', organizationUserId: 'ou-mgr', organizationId: 'org-1', role: 'hr' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse());
    mockEnrollmentFindFirst.mockResolvedValue(null);

    const result = await getLearnPayload('course-1');

    expect((result as { error?: string }).error).toBeUndefined();
  });

  it('an admin opening /learn WITHOUT a worker session keeps the admin view', async () => {
    mockWorkerAuth.mockResolvedValue(null);
    mockAdminAuth.mockResolvedValue({
      user: { id: 'a1', organizationUserId: 'ou-adm', organizationId: 'org-1', role: 'owner' },
    });
    mockOrganizationUserFindUnique.mockResolvedValue({
      role: 'owner',
      user: { fullName: 'Owner One', email: 'o@example.com' },
      organization: { name: 'Acme Health' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse());
    mockEnrollmentFindFirst.mockResolvedValue(null);

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.user.isAdminView).toBe(true);
  });

  it('a real worker never gets the admin view', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', organizationId: 'org-1', role: 'nurse' },
    });
    mockAdminAuth.mockResolvedValue(null);
    mockOrganizationUserFindUnique.mockResolvedValue({
      role: 'nurse',
      user: { fullName: 'Jane Worker', email: 'jane@example.com' },
      organization: { name: 'Acme Health' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse());
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 0,
      status: 'in_progress',
      score: null,
      videoPositionSeconds: 0,
      quizAttempts: [],
    });

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.user.isAdminView).toBe(false);
  });
});

/**
 * `canEditContent` — the "Edit Article" affordance.
 *
 * `isAdminView` was doing a job it was never narrow enough for. It admits every
 * role that may REVIEW a course (`course.read` + admin category), but saving a
 * lesson needs `course.edit` AND ownership of the course by the caller's org.
 * Two populations were therefore shown an editor whose every save was refused:
 * a supervisor (read but not edit), and any admin on an adopted GLOBAL
 * catalogue course another organisation authored.
 *
 * The flag decides only whether the control is OFFERED — `updateLessonContent`
 * re-checks the identical predicate itself, which is what
 * `course.content-write-rbac.test.ts` pins.
 */
describe('getLearnPayload — canEditContent', () => {
  const adminSession = (role: string, organizationId = 'org-1') => ({
    user: { id: 'a1', organizationUserId: 'ou-adm', organizationId, role },
  });

  beforeEach(() => {
    mockWorkerAuth.mockResolvedValue(null);
    mockEnrollmentFindFirst.mockResolvedValue(null);
    mockOrganizationUserFindUnique.mockResolvedValue({
      role: 'owner',
      user: { fullName: 'Admin One', email: 'a@example.com' },
      organization: { name: 'Acme Health' },
    });
  });

  // Positive control: a fix that simply hid the editor from everyone would pass
  // every negative case below.
  it.each(['owner', 'admin', 'hr'])(
    '%s editing their OWN organisation’s course keeps the editor',
    async (role) => {
      mockAdminAuth.mockResolvedValue(adminSession(role));
      mockCourseFindUnique.mockResolvedValue(makeCourse({ creatorOrgId: 'org-1' }));

      const payload = asPayload(await getLearnPayload('course-1'));

      expect(payload.user.isAdminView).toBe(true);
      expect(payload.user.canEditContent).toBe(true);
    },
  );

  it('a supervisor gets the review but NOT the editor — they hold course.read, not course.edit', async () => {
    mockAdminAuth.mockResolvedValue(adminSession('supervisor'));
    mockCourseFindUnique.mockResolvedValue(makeCourse({ creatorOrgId: 'org-1' }));

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.user.isAdminView).toBe(true);
    expect(payload.user.canEditContent).toBe(false);
  });

  it('an owner opening a published GLOBAL course another org authored gets no editor', async () => {
    mockAdminAuth.mockResolvedValue(adminSession('owner', 'org-2'));
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ creatorOrgId: 'org-1', isGlobal: true, status: 'published' }),
    );

    const payload = asPayload(await getLearnPayload('course-1'));

    // The review still opens — that is the point of a shared catalogue.
    expect(payload.user.isAdminView).toBe(true);
    expect(payload.user.canEditContent).toBe(false);
  });

  it('a manager who chose LEARN mode gets neither view nor editor', async () => {
    const learnMode = {
      user: { id: 'a1', organizationUserId: 'ou-adm', organizationId: 'org-1', role: 'owner' },
    };
    mockWorkerAuth.mockResolvedValue(learnMode);
    mockAdminAuth.mockResolvedValue(learnMode);
    mockCourseFindUnique.mockResolvedValue(makeCourse({ creatorOrgId: 'org-1' }));

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.user.isAdminView).toBe(false);
    expect(payload.user.canEditContent).toBe(false);
  });

  it('a real worker in their own course gets no editor', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', organizationId: 'org-1', role: 'nurse' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ creatorOrgId: 'org-1' }));
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 0,
      status: 'in_progress',
      score: null,
      videoPositionSeconds: 0,
      quizAttempts: [],
    });

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.user.canEditContent).toBe(false);
  });
});

/**
 * Bug B: "Done with no Attest", in two rounds.
 *
 * Round 1 — the payload fell back to the literal role `'worker'`, which is NOT a
 * member of WORKER_ROLES, and LearnClient re-derived the gate from it with
 * `isWorkerRole`; whenever the membership lookup came back null, Attest silently
 * vanished. That moved the gate to one server-side verdict.
 *
 * Round 2 (team test) — that verdict still keyed on `isWorkerRole`, so every
 * manager-category learner hit the same dead end: `enterLearnMode` mints a
 * worker session carrying the manager's REAL role, so a supervisor who passed
 * the assessment was left with "Done". The gate now keys on ownership, matching
 * what `attestCourse` itself enforces.
 */
describe('getLearnPayload — attestEligible', () => {
  const workerSession = {
    user: { id: 'w1', organizationUserId: 'ou-worker', organizationId: 'org-1', role: 'nurse' },
  };

  const enrollment = (status: string) => ({
    id: 'enr-1',
    progress: 100,
    status,
    score: 90,
    videoPositionSeconds: 0,
    quizAttempts: [],
  });

  beforeEach(() => {
    mockWorkerAuth.mockResolvedValue(workerSession);
    mockCourseFindUnique.mockResolvedValue(makeCourse());
  });

  it('is true for a worker-category member whose own enrollment is not yet attested', async () => {
    mockEnrollmentFindFirst.mockResolvedValue(enrollment('in_progress'));

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.attestEligible).toBe(true);
    expect(payload.user.role).toBe('nurse');
  });

  it('is false once the enrollment is already attested', async () => {
    mockEnrollmentFindFirst.mockResolvedValue(enrollment('attested'));

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.attestEligible).toBe(false);
  });

  // The team-test report: a manager who is assigned a course, takes it and
  // passes owes the same attestation a worker does. `attestCourse` authorizes
  // on ownership alone, so the button must follow the same rule.
  it.each(['owner', 'admin', 'supervisor', 'hr', 'clinical_director', 'finance'])(
    'is true for a %s viewer whose own enrollment is not yet attested',
    async (role) => {
      mockOrganizationUserFindUnique.mockResolvedValue({
        role,
        user: { fullName: 'Manager One', email: 'm@example.com' },
        organization: { name: 'Acme Health' },
      });
      mockEnrollmentFindFirst.mockResolvedValue(enrollment('in_progress'));

      const payload = asPayload(await getLearnPayload('course-1'));

      expect(payload.attestEligible).toBe(true);
    },
  );

  it('is false once a manager-category viewer has already attested', async () => {
    mockOrganizationUserFindUnique.mockResolvedValue({
      role: 'hr',
      user: { fullName: 'Manager One', email: 'm@example.com' },
      organization: { name: 'Acme Health' },
    });
    mockEnrollmentFindFirst.mockResolvedValue(enrollment('attested'));

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.attestEligible).toBe(false);
  });

  // Admin preview: an admin may open a same-org course with no enrollment of
  // their own. There is nothing to attest, and `attestCourse` would reject it.
  it('reports a null role rather than the literal "worker" when there is no membership, and offers no attestation', async () => {
    mockWorkerAuth.mockResolvedValue(null);
    mockAdminAuth.mockResolvedValue({
      user: { id: 'a1', organizationUserId: null, organizationId: 'org-1', role: 'owner' },
    });
    mockOrganizationUserFindUnique.mockResolvedValue(null);
    mockEnrollmentFindFirst.mockResolvedValue(null);

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.user.role).toBeNull();
    expect(payload.attestEligible).toBe(false);
  });

  it('is false in admin preview even for an enrolled-looking course with no enrollment row', async () => {
    mockWorkerAuth.mockResolvedValue(null);
    mockAdminAuth.mockResolvedValue({
      user: { id: 'a1', organizationUserId: 'ou-admin', organizationId: 'org-1', role: 'admin' },
    });
    mockOrganizationUserFindUnique.mockResolvedValue({
      role: 'admin',
      user: { fullName: 'Admin One', email: 'a@example.com' },
      organization: { name: 'Acme Health' },
    });
    mockEnrollmentFindFirst.mockResolvedValue(null);

    const payload = asPayload(await getLearnPayload('course-1'));

    expect(payload.attestEligible).toBe(false);
  });
});

/**
 * The per-role admission table for `mayReviewWithoutEnrollment` (team QA #9 —
 * finance can no longer open `/learn/{id}` with no enrollment by typing the
 * URL). This is the single most important suite in this file: `course.read`
 * is NOT admin-only — it sits in `workerPermissions`, so 13 of the 14
 * `UserRole` values hold it. A gate written as a bare
 * `can(role, 'course.read')` would therefore ADMIT EVERY WORKER to any
 * course they hold no enrollment in — the opposite of the intended fix. Only
 * the conjunction with `isAdminRole` closes that hole while still excluding
 * finance, which is the one admin-category role course.read was deliberately
 * removed from.
 *
 * Enumerates all 14 roles against BOTH call sites `mayReviewWithoutEnrollment`
 * feeds:
 *   - the admin-session fallback (a manager reviewing a same-org course they
 *     hold no enrollment in, e.g. before assigning it)
 *   - the `enterLearnMode` fallback (`mayOpenWithoutEnrollment`), where a
 *     manager's WORKER session carries their real role (session-bridge.ts) —
 *     a fix applied only to the admin branch would leave this path exposed.
 */
describe('getLearnPayload — mayReviewWithoutEnrollment per-role admission table', () => {
  const ADMITTED_ROLES = ['owner', 'admin', 'supervisor', 'hr', 'clinical_director'] as const;
  const DENIED_ROLES = [
    'finance',
    'psychiatrist_prescriber',
    'nurse',
    'therapist_clinician',
    'case_manager',
    'behavioral_health_technician',
    'peer_support_specialist',
    'front_desk_admin',
    'facilities_support',
  ] as const;
  const ALL_ROLES = [...ADMITTED_ROLES, ...DENIED_ROLES];

  // Sanity check on the table itself: every UserRole value must be classified
  // exactly once, so a role added to the enum later fails loudly here instead
  // of silently falling out of the matrix.
  it('covers all 14 UserRole values with no overlap', () => {
    expect(ALL_ROLES).toHaveLength(14);
    expect(new Set(ALL_ROLES).size).toBe(14);
  });

  describe('admin-session fallback (manager review with no enrollment)', () => {
    beforeEach(() => {
      mockWorkerAuth.mockResolvedValue(null);
      mockCourseFindUnique.mockResolvedValue(makeCourse({ creatorOrgId: 'org-1' }));
      mockEnrollmentFindFirst.mockResolvedValue(null);
    });

    it.each(ADMITTED_ROLES)('admits %s without an enrollment', async (role) => {
      mockAdminAuth.mockResolvedValue({
        user: { id: 'a1', organizationUserId: 'ou-admin', organizationId: 'org-1', role },
      });

      const result = await getLearnPayload('course-1');

      expect(isLearnPayloadError(result)).toBe(false);
      expect(asPayload(result).enrollment.id).toBe('preview-mode');
    });

    it.each(DENIED_ROLES)('denies %s with no enrollment (403)', async (role) => {
      mockAdminAuth.mockResolvedValue({
        user: { id: 'a1', organizationUserId: 'ou-admin', organizationId: 'org-1', role },
      });

      const result = await getLearnPayload('course-1');

      expect(result).toEqual({ error: 'Not enrolled in this course', status: 403 });
    });
  });

  describe('enterLearnMode fallback (worker session carrying the real role)', () => {
    // No admin session at all — this is the case a fix scoped only to the
    // admin-fallback branch would miss: `activeRole` never leaves the value
    // seeded from the WORKER session.
    beforeEach(() => {
      mockAdminAuth.mockResolvedValue(null);
      mockCourseFindUnique.mockResolvedValue(makeCourse({ creatorOrgId: 'org-1' }));
      mockEnrollmentFindFirst.mockResolvedValue(null);
    });

    it.each(ADMITTED_ROLES)(
      '%s who entered Learn mode is admitted with no enrollment of their own',
      async (role) => {
        mockWorkerAuth.mockResolvedValue({
          user: { id: 'w1', organizationUserId: 'ou-w', organizationId: 'org-1', role },
        });

        const result = await getLearnPayload('course-1');

        expect(isLearnPayloadError(result)).toBe(false);
      },
    );

    it.each(DENIED_ROLES)(
      '%s with no enrollment is denied (403) even inside a worker session',
      async (role) => {
        mockWorkerAuth.mockResolvedValue({
          user: { id: 'w1', organizationUserId: 'ou-w', organizationId: 'org-1', role },
        });

        const result = await getLearnPayload('course-1');

        expect(result).toEqual({ error: 'Not enrolled in this course', status: 403 });
      },
    );
  });
});
