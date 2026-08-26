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
  mockEnrollmentFindFirst,
  mockOrganizationUserFindUnique,
  mockQuizFindUnique,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindUnique: vi.fn(),
  mockEnrollmentFindFirst: vi.fn(),
  mockOrganizationUserFindUnique: vi.fn(),
  mockQuizFindUnique: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockRejectedValue(new Error('no request scope')),
}));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findUnique: (...a: unknown[]) => mockCourseFindUnique(...a) },
    enrollment: { findFirst: (...a: unknown[]) => mockEnrollmentFindFirst(...a) },
    organizationUser: { findUnique: (...a: unknown[]) => mockOrganizationUserFindUnique(...a) },
    quiz: { findUnique: (...a: unknown[]) => mockQuizFindUnique(...a) },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import {
  getLearnPayload,
  isLearnPayloadError,
  type LearnPayload,
  type LearnPayloadError,
} from './get-learn-payload';

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
}) => ({
  id: 'course-1',
  title: 'Intro Course',
  description: 'desc',
  duration: 30,
  isGlobal: opts?.isGlobal ?? false,
  status: opts?.status ?? 'published',
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
    jobTitle: 'RN',
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
      organizationName: 'Acme Health',
      email: 'jane@example.com',
      jobTitle: 'RN',
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
      jobTitle: 'HR Lead',
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
      jobTitle: 'Owner',
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
      jobTitle: 'RN',
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
