import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockWorkerAuth,
  mockUserFindUnique,
  mockCourseCreate,
  mockCourseFindUnique,
  mockCourseUpdate,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockCourseCreate: vi.fn(),
  mockCourseFindUnique: vi.fn(),
  mockCourseUpdate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    user: { findUnique: mockUserFindUnique },
    course: {
      create: mockCourseCreate,
      findUnique: mockCourseFindUnique,
      update: mockCourseUpdate,
    },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { createFullCourse, publishCourse } from './course';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } });
  mockWorkerAuth.mockResolvedValue(null);
  mockUserFindUnique.mockResolvedValue({ organizationId: 'org-1' });
});

// A base v4.6 payload with no quality issues.
function healthyCourseData() {
  return {
    title: 'Compliant Course',
    description: 'A well-formed course',
    difficulty: 'moderate',
    duration: '60',
    modules: [{ title: 'M1', content: 'c', duration: '10 min' }],
    quiz: Array.from({ length: 10 }, (_, i) => ({
      question: `Q${i}`,
      options: ['a', 'b'],
      answer: 0,
    })),
    assignments: [],
    rawArticleMeta: { meta: { status: 'ok' } },
    rawSlidesJson: { slides: [{ slideId: 's1' }] },
    rawJudgeJson: { ambiguous: [], invalid: [] },
    rawQuizJson: { meta: { requestedQuestionCount: 10 } },
  };
}

describe('createFullCourse publish-review gate', () => {
  it('saves a degraded course as a draft, computing warnings server-side', async () => {
    mockCourseCreate.mockResolvedValue({ id: 'course-1', title: 'Compliant Course' });

    // Degrade every dimension: quiz short of requested, no slides, judge flags,
    // and needs_sources article meta.
    const result = await createFullCourse({
      ...healthyCourseData(),
      quiz: [
        { question: 'Q0', options: ['a', 'b'], answer: 0 },
        { question: 'Q1', options: ['a', 'b'], answer: 0 },
        { question: 'Q2', options: ['a', 'b'], answer: 0 },
      ],
      rawSlidesJson: { slides: [] },
      rawJudgeJson: { ambiguous: [{ questionId: 'q1' }], invalid: [{ questionId: 'q2' }] },
      rawArticleMeta: { meta: { status: 'needs_sources' } },
    });

    expect(result.success).toBe(true);
    expect(result.reviewRequired).toBe(true);

    const createArgs = mockCourseCreate.mock.calls[0][0];
    expect(createArgs.data.status).toBe('draft');
    expect(createArgs.data.reviewRequired).toBe(true);

    // One warning per degraded dimension, derived from the persisted artifacts.
    const warnings = createArgs.data.qualityWarnings as string[];
    expect(warnings).toHaveLength(4);
    expect(warnings.join(' ')).toContain('3 of the 10');
    expect(warnings.join(' ')).toContain('No slides');
    expect(warnings.join(' ')).toContain('2 questions');
    expect(warnings.join(' ')).toContain('enough content');
  });

  it('publishes a healthy course immediately without review', async () => {
    mockCourseCreate.mockResolvedValue({ id: 'course-2', title: 'Compliant Course' });

    const result = await createFullCourse(healthyCourseData());

    expect(result.reviewRequired).toBe(false);
    const createArgs = mockCourseCreate.mock.calls[0][0];
    expect(createArgs.data.status).toBe('published');
    expect(createArgs.data.reviewRequired).toBe(false);
    expect(createArgs.data.qualityWarnings).toEqual([]);
  });

  it('does not flag a non-v4.6 course lacking slides/judge/article artifacts', async () => {
    mockCourseCreate.mockResolvedValue({ id: 'course-3', title: 'Legacy Course' });

    const result = await createFullCourse({
      title: 'Legacy Course',
      description: 'v3.1 style',
      difficulty: 'moderate',
      duration: '30',
      modules: [{ title: 'M1', content: 'c', duration: '10 min' }],
      quiz: [{ question: 'Q0', options: ['a', 'b'], answer: 0 }],
      assignments: [],
      rawQuizJson: { meta: { requestedQuestionCount: 1 } },
    });

    expect(result.reviewRequired).toBe(false);
    const createArgs = mockCourseCreate.mock.calls[0][0];
    expect(createArgs.data.status).toBe('published');
    expect(createArgs.data.qualityWarnings).toEqual([]);
  });
});

describe('publishCourse publish-review gate', () => {
  it('blocks publishing a review-required course without acknowledgement', async () => {
    mockCourseFindUnique.mockResolvedValue({
      id: 'course-1',
      createdBy: 'admin-1',
      reviewRequired: true,
      qualityWarnings: ['No slides were generated for this course.'],
    });

    const result = await publishCourse('course-1');

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('requires review'),
      warnings: ['No slides were generated for this course.'],
    });
    expect(mockCourseUpdate).not.toHaveBeenCalled();
  });

  it('publishes and clears the gate when warnings are acknowledged', async () => {
    mockCourseFindUnique.mockResolvedValue({
      id: 'course-1',
      createdBy: 'admin-1',
      reviewRequired: true,
      qualityWarnings: ['No slides were generated for this course.'],
    });
    mockCourseUpdate.mockResolvedValue({ id: 'course-1', status: 'published' });

    const result = await publishCourse('course-1', { acknowledgeWarnings: true });

    expect(mockCourseUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockCourseUpdate.mock.calls[0][0];
    expect(updateArgs.data.status).toBe('published');
    expect(updateArgs.data.reviewRequired).toBe(false);
    expect(result).toMatchObject({ id: 'course-1', status: 'published' });
  });

  it('publishes a normal course without touching the review flag', async () => {
    mockCourseFindUnique.mockResolvedValue({
      id: 'course-3',
      createdBy: 'admin-1',
      reviewRequired: false,
      qualityWarnings: [],
    });
    mockCourseUpdate.mockResolvedValue({ id: 'course-3', status: 'published' });

    await publishCourse('course-3');

    const updateArgs = mockCourseUpdate.mock.calls[0][0];
    expect(updateArgs.data.status).toBe('published');
    expect(updateArgs.data.reviewRequired).toBeUndefined();
  });
});
