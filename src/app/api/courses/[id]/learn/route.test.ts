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
    // Intentionally present but unused by a correct implementation — the
    // `latestAttempt` branch must reuse `quizData.questions` from the course
    // query rather than re-fetching. If product code regresses to calling
    // this, tests below assert it was never invoked.
    quiz: { findUnique: (...a: unknown[]) => mockQuizFindUnique(...a) },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { GET } from './route';

const params = Promise.resolve({ id: 'course-1' });
const makeReq = () => new Request('http://localhost/api/courses/course-1/learn') as never;

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

describe('GET /api/courses/[id]/learn — auth resolution', () => {
  it('401 when neither portal session is authenticated', async () => {
    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(401);
    expect(mockCourseFindUnique).not.toHaveBeenCalled();
  });

  it('200 for a worker-only session enrolled in the course', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', role: 'nurse' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse());
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 50,
      status: 'in_progress',
      score: null,
      videoPositionSeconds: 120,
      quizAttempts: [],
    });

    const res = await GET(makeReq(), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrollment.id).toBe('enr-1');
  });

  it('200 for an admin-only session with matching org (no enrollment required)', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'a1', organizationUserId: 'ou-admin', role: 'admin', organizationId: 'org-1' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ creatorOrgId: 'org-1' }));

    const res = await GET(makeReq(), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrollment.id).toBe('preview-mode');
  });
});

describe('GET /api/courses/[id]/learn — quizAttempts: full history, no take:1 regression', () => {
  beforeEach(() => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', role: 'nurse' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse());
  });

  it('does not limit the quizAttempts query to a single row (no take:1)', async () => {
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 100,
      status: 'completed',
      score: 90,
      videoPositionSeconds: 600,
      quizAttempts: [],
    });

    await GET(makeReq(), { params });

    expect(mockEnrollmentFindFirst).toHaveBeenCalledTimes(1);
    const call = mockEnrollmentFindFirst.mock.calls[0][0] as {
      include: { quizAttempts: Record<string, unknown> };
    };
    expect(call.include.quizAttempts).not.toHaveProperty('take');
  });

  it('keeps an in-progress attempt (timeTaken === null) in the response even when it is not the newest row', async () => {
    // Simulates the DB's `orderBy: completedAt desc` result: the most recently
    // completed attempt sorts first, and the caller's currently-active
    // (not-yet-completed) attempt — the exact row the learn client looks up via
    // `.find(a => a.timeTaken === null)` — sorts after it. A `take: 1` here
    // would silently drop the active attempt from the payload.
    const completedAttempt = {
      id: 'qa-completed',
      score: 80,
      attemptCount: 1,
      answers: [],
      timeTaken: 300,
      completedAt: '2026-08-01T00:00:00.000Z',
    };
    const activeAttempt = {
      id: 'qa-active',
      score: null,
      attemptCount: 2,
      answers: [],
      timeTaken: null,
      completedAt: null,
    };
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 50,
      status: 'in_progress',
      score: null,
      videoPositionSeconds: 0,
      quizAttempts: [completedAttempt, activeAttempt],
    });

    const res = await GET(makeReq(), { params });
    const body = await res.json();

    expect(body.enrollment.quizAttempts).toHaveLength(2);
    const active = body.enrollment.quizAttempts.find(
      (a: { timeTaken: number | null }) => a.timeTaken === null,
    );
    expect(active).toBeDefined();
    expect(active.id).toBe('qa-active');
  });
});

describe('GET /api/courses/[id]/learn — latestAttempt reuses quizData.questions', () => {
  beforeEach(() => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', role: 'nurse' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse());
  });

  it('builds quizResultsData from the already-loaded course quiz questions without re-querying prisma.quiz', async () => {
    const attempt = {
      id: 'qa-1',
      score: 100,
      attemptCount: 1,
      answers: [{ questionId: 'q1', selectedAnswer: '4' }],
      timeTaken: 45,
      completedAt: '2026-08-01T00:00:00.000Z',
    };
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 100,
      status: 'completed',
      score: 100,
      videoPositionSeconds: 600,
      quizAttempts: [attempt],
    });

    const res = await GET(makeReq(), { params });
    const body = await res.json();

    expect(mockQuizFindUnique).not.toHaveBeenCalled();
    expect(body.quizResultsData).not.toBeNull();
    expect(body.quizResultsData.score).toBe(100);
    expect(body.quizResultsData.correctCount).toBe(1);
    expect(body.quizResultsData.totalQuestions).toBe(1);
    expect(body.quizResultsData.questions).toHaveLength(1);
    // options = ['3', '4', '5']; correctAnswer '4' is index 1 → letter 'B'.
    expect(body.quizResultsData.questions[0].correctAnswer).toBe('B');
  });
});

describe('GET /api/courses/[id]/learn — quiz answer-key gating', () => {
  beforeEach(() => {
    mockCourseFindUnique.mockResolvedValue(makeCourse());
  });

  it('omits correctAnswer/explanation from the quiz payload for a worker', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-worker', role: 'nurse' },
    });
    mockEnrollmentFindFirst.mockResolvedValue({
      id: 'enr-1',
      progress: 0,
      status: 'in_progress',
      score: null,
      videoPositionSeconds: 0,
      quizAttempts: [],
    });

    const res = await GET(makeReq(), { params });
    const body = await res.json();

    const question = body.course.quiz.questions[0];
    expect(question).not.toHaveProperty('correctAnswer');
    expect(question).not.toHaveProperty('explanation');
  });

  it('includes correctAnswer/explanation in the quiz payload for an admin', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'a1', organizationUserId: 'ou-admin', role: 'admin', organizationId: 'org-1' },
    });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ creatorOrgId: 'org-1' }));

    const res = await GET(makeReq(), { params });
    const body = await res.json();

    const question = body.course.quiz.questions[0];
    expect(question.correctAnswer).toBe('4');
    expect(question.explanation).toBe('Basic arithmetic.');
  });
});

describe('GET /api/courses/[id]/learn — activeMembership select', () => {
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

    await GET(makeReq(), { params });

    expect(mockOrganizationUserFindUnique).toHaveBeenCalledTimes(1);
    const call = mockOrganizationUserFindUnique.mock.calls[0][0] as {
      select: { user: { select: Record<string, unknown> } };
    };
    expect(call.select.user.select).not.toHaveProperty('password');
    expect(call.select.user.select).not.toHaveProperty('passwordHash');
  });
});
