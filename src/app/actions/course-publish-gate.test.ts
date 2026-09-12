import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockWorkerAuth, mockCourseCreate, mockCourseFindUnique, mockCourseUpdate } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockCourseCreate: vi.fn(),
    mockCourseFindUnique: vi.fn(),
    mockCourseUpdate: vi.fn(),
  }));

vi.mock('@/lib/prisma', () => {
  const prisma = {
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

import { createFullCourse, publishCourse, updateCourse } from './course';

// Post User/OrganizationUser split: the session carries the active
// membership id directly (`organizationUserId`) — course ownership is
// checked against it, with no separate `prisma.user` lookup.
const ORG_USER_ID = 'ou-admin-1';

beforeEach(() => {
  vi.clearAllMocks();
  // Org/membership are read straight off the DB-revalidated session (see
  // createFullCourse in course.ts) rather than a separate user.findUnique.
  mockAuth.mockResolvedValue({
    // F-034: `role` is now load-bearing — publishCourse checks the registry for
    // `course.edit`. A real session always carries one; omitting it here made the
    // fixture less realistic than production, and the new guard exposed that.
    user: {
      id: 'admin-1',
      role: 'owner',
      organizationUserId: ORG_USER_ID,
      organizationId: 'org-1',
    },
  });
  mockWorkerAuth.mockResolvedValue(null);
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
      createdByOrgUserId: ORG_USER_ID,
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
      createdByOrgUserId: ORG_USER_ID,
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
      createdByOrgUserId: ORG_USER_ID,
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

/**
 * D8: persist who approved a course at publish time by writing the dormant
 * `approvedByOrgUserId`/`approvedAt` columns. The reviewer is always resolved
 * from the session — neither `createFullCourse` nor `publishCourse` accepts a
 * reviewer-shaped argument at all, so there is nothing a caller could pass to
 * override it.
 */
describe('D8 — reviewer attribution on publish', () => {
  it('createFullCourse: publishing directly (reviewRequired=false) records the session as approver', async () => {
    mockCourseCreate.mockResolvedValue({ id: 'course-approve-1', title: 'Compliant Course' });

    const result = await createFullCourse(healthyCourseData());

    expect(result.reviewRequired).toBe(false);
    const createArgs = mockCourseCreate.mock.calls[0][0];
    expect(createArgs.data.approvedByOrgUserId).toBe(ORG_USER_ID);
    expect(createArgs.data.approvedAt).toBeInstanceOf(Date);
  });

  it('createFullCourse: a course held back by the quality gate is left unattributed (keys absent, not merely null)', async () => {
    mockCourseCreate.mockResolvedValue({ id: 'course-approve-2', title: 'Degraded Course' });

    const result = await createFullCourse({
      ...healthyCourseData(),
      rawSlidesJson: { slides: [] }, // triggers reviewRequired
    });

    expect(result.reviewRequired).toBe(true);
    const createArgs = mockCourseCreate.mock.calls[0][0];
    expect(createArgs.data.status).toBe('draft');
    expect('approvedByOrgUserId' in createArgs.data).toBe(false);
    expect('approvedAt' in createArgs.data).toBe(false);
  });

  it('publishCourse: a plain draft publish records the session as approver', async () => {
    mockCourseFindUnique.mockResolvedValue({
      id: 'course-approve-3',
      createdByOrgUserId: ORG_USER_ID,
      reviewRequired: false,
      qualityWarnings: [],
    });
    mockCourseUpdate.mockResolvedValue({ id: 'course-approve-3', status: 'published' });

    await publishCourse('course-approve-3');

    const updateArgs = mockCourseUpdate.mock.calls[0][0];
    expect(updateArgs.data.approvedByOrgUserId).toBe(ORG_USER_ID);
    expect(updateArgs.data.approvedAt).toBeInstanceOf(Date);
  });

  it('publishCourse: the acknowledge-warnings replay attributes whoever cleared the gate', async () => {
    mockCourseFindUnique.mockResolvedValue({
      id: 'course-approve-4',
      createdByOrgUserId: ORG_USER_ID,
      reviewRequired: true,
      qualityWarnings: ['No slides were generated for this course.'],
    });
    mockCourseUpdate.mockResolvedValue({ id: 'course-approve-4', status: 'published' });

    await publishCourse('course-approve-4', { acknowledgeWarnings: true });

    const updateArgs = mockCourseUpdate.mock.calls[0][0];
    expect(updateArgs.data.approvedByOrgUserId).toBe(ORG_USER_ID);
    expect(updateArgs.data.approvedAt).toBeInstanceOf(Date);
  });

  it('the reviewer written always comes from the session, never from anything a caller could pass — proven by swapping the mocked session', async () => {
    const DIFFERENT_REVIEWER = 'ou-different-reviewer';
    mockAuth.mockResolvedValue({
      user: {
        id: 'admin-2',
        role: 'owner',
        organizationUserId: DIFFERENT_REVIEWER,
        organizationId: 'org-1',
      },
    });
    mockCourseFindUnique.mockResolvedValue({
      id: 'course-approve-5',
      createdByOrgUserId: DIFFERENT_REVIEWER,
      reviewRequired: false,
      qualityWarnings: [],
    });
    mockCourseUpdate.mockResolvedValue({ id: 'course-approve-5', status: 'published' });

    // publishCourse takes no reviewer-shaped argument — the only lever that
    // can move the persisted value is the session itself.
    await publishCourse('course-approve-5');

    const updateArgs = mockCourseUpdate.mock.calls[0][0];
    expect(updateArgs.data.approvedByOrgUserId).toBe(DIFFERENT_REVIEWER);
  });
});

/**
 * Regression guard: `updateCourse`'s `data` param is a closed object type
 * (title/description/thumbnail/duration only), so a post-publish edit cannot
 * accidentally null out who approved the course. The compile-time pin below
 * catches a future widening of that type before it ships.
 */
describe('updateCourse — never touches reviewer attribution', () => {
  it('data type stays closed to approvedByOrgUserId/approvedAt (compile-time pin)', () => {
    const widened: Parameters<typeof updateCourse>[1] = {
      title: 'New title',
      // @ts-expect-error — updateCourse's `data` param intentionally excludes
      // approvedByOrgUserId/approvedAt. If this stops erroring, the type has
      // been widened and a caller could silently overwrite who approved a
      // course through an unrelated edit.
      approvedByOrgUserId: 'ou-attacker',
    };
    expect(widened).toBeDefined();
  });

  it('a normal post-publish edit never writes approvedByOrgUserId/approvedAt at runtime', async () => {
    mockCourseFindUnique.mockResolvedValue({
      id: 'course-approve-6',
      createdByOrgUserId: ORG_USER_ID,
    });
    mockCourseUpdate.mockResolvedValue({ id: 'course-approve-6', title: 'New title' });

    await updateCourse('course-approve-6', { title: 'New title' });

    const updateArgs = mockCourseUpdate.mock.calls[0][0];
    expect(updateArgs.data).not.toHaveProperty('approvedByOrgUserId');
    expect(updateArgs.data).not.toHaveProperty('approvedAt');
  });
});
