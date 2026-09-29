/**
 * `createFullCourse`, `updateQuizQuestions` and `updateLessonContent` are
 * POST-invocable Server Actions that checked only record ownership — never
 * role. `src/proxy.ts` splits traffic into administrative vs worker and does no
 * module-level check, so every admin-tier role reached all three, Finance and
 * Facility Supervisor included.
 *
 * `lesson.rbac.test.ts` pinned the same distinction for the lesson mutators in
 * `lesson.ts`; these are the three that were missed. As there, the tests are
 * built so that ownership is SATISFIED and only the role differs — a test that
 * merely proved "logged out is denied" would have passed before the fix.
 *
 * The ownership test itself also moves from author-equality to org ownership
 * (COU-004, as in `deleteCourse`): a colleague's course belongs to the same
 * organisation and must be editable by a colleague who holds the verb.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth, mockAssertNoPhi } = vi.hoisted(() => ({
  prismaMock: {
    course: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    lesson: { findUnique: vi.fn(), update: vi.fn() },
    question: { deleteMany: vi.fn(), createMany: vi.fn() },
    document: { findMany: vi.fn().mockResolvedValue([]) },
    documentVersion: { findMany: vi.fn().mockResolvedValue([]) },
    courseModule: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    courseVersion: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
  mockAdminAuth: vi.fn(),
  mockAssertNoPhi: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('@/lib/notifications/create', () => ({ notifyOrganizationAdmins: vi.fn() }));
vi.mock('./enrollment', () => ({ enrollUsers: vi.fn(), assignCourseToRoles: vi.fn() }));
// The REAL `PhiBlockedError` is kept: `updateLessonContent` catches it by
// `instanceof`, so a stand-in class would let that branch rot undetected.
vi.mock('@/lib/documents/phiGate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/documents/phiGate')>()),
  assertNoPhi: mockAssertNoPhi,
}));

import { PhiBlockedError } from '@/lib/documents/phiGate';
import {
  createFullCourse,
  updateQuizQuestions,
  updateLessonContent,
  updateLessonSlideContent,
  updateCourse,
} from './course';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const CALLER_OU = 'ou-caller';
const COLLEAGUE_OU = 'ou-colleague';

/** Roles with no course write verbs that route protection nevertheless admits. */
const DENIED_ROLES = ['finance', 'supervisor', 'therapist_clinician'];

function session(role: string) {
  return { user: { id: 'u1', role, organizationId: ORG, organizationUserId: CALLER_OU } };
}

/** Authored by SOMEONE ELSE in the caller's org — the COU-004 scenario. */
const colleaguesCourse = {
  id: 'course-1',
  createdByOrgUserId: COLLEAGUE_OU,
  organizationId: ORG,
  isGlobal: false,
  lessons: [{ id: 'lesson-1', quiz: { id: 'quiz-1' } }],
};

const courseInput = {
  title: 'Infection Control',
  description: 'desc',
  difficulty: 'beginner',
  duration: '30',
  modules: [{ title: 'Module 1', content: 'content', duration: '10 min' }],
  quiz: [],
  assignments: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` clears calls but keeps implementations, so a rejection set
  // by one PHI test would leak into every test after it.
  mockAssertNoPhi.mockReset();
  mockAdminAuth.mockResolvedValue(session('owner'));
  prismaMock.course.findUnique.mockResolvedValue(colleaguesCourse);
  prismaMock.course.create.mockResolvedValue({ id: 'course-1', lessons: [] });
  prismaMock.lesson.findUnique.mockResolvedValue({
    id: 'lesson-1',
    courseId: 'course-1',
    title: 'Lesson 1',
    course: { id: 'course-1', organizationId: ORG, isGlobal: false },
  });
  prismaMock.lesson.update.mockResolvedValue({ id: 'lesson-1' });
  prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prismaMock) : [],
  );
});

describe('createFullCourse — requires course.create', () => {
  it.each(DENIED_ROLES)('%s is denied, and no course is written', async (role) => {
    mockAdminAuth.mockResolvedValue(session(role));

    await expect(createFullCourse(courseInput)).rejects.toThrow('Insufficient permissions');

    expect(prismaMock.course.create).not.toHaveBeenCalled();
  });

  it('a role holding course.create is admitted', async () => {
    mockAdminAuth.mockResolvedValue(session('hr'));

    await expect(createFullCourse(courseInput)).resolves.toMatchObject({ success: true });
  });
});

/**
 * `updateQuizQuestions` RETURNS its refusals (production redacts a thrown
 * Server Action message to React #441), so `resolves` is load-bearing here.
 */
describe('updateQuizQuestions — requires course.edit', () => {
  it.each(DENIED_ROLES)('%s is denied before the database is touched', async (role) => {
    mockAdminAuth.mockResolvedValue(session(role));

    await expect(updateQuizQuestions('course-1', [])).resolves.toEqual({
      success: false,
      error: 'Your role does not have permission to edit course content.',
    });

    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.question.deleteMany).not.toHaveBeenCalled();
  });

  it('an unauthenticated caller is told so rather than throwing', async () => {
    mockAdminAuth.mockResolvedValue(null);

    const result = await updateQuizQuestions('course-1', []);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
  });

  it('BUG-11: a colleague’s course in the caller’s own org is editable', async () => {
    await expect(updateQuizQuestions('course-1', [])).resolves.toEqual({ success: true });
  });

  it('a course owned by another organisation is refused', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      ...colleaguesCourse,
      organizationId: OTHER_ORG,
    });

    await expect(updateQuizQuestions('course-1', [])).resolves.toEqual({
      success: false,
      error: 'Course not found.',
    });
    expect(prismaMock.question.deleteMany).not.toHaveBeenCalled();
  });

  // Authorship buys nothing: the caller wrote this course, but another
  // organisation owns it now.
  it('a course the caller authored but another organisation owns is refused', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      ...colleaguesCourse,
      createdByOrgUserId: CALLER_OU,
      organizationId: OTHER_ORG,
    });

    const result = await updateQuizQuestions('course-1', []);

    expect(result.success).toBe(false);
    expect(prismaMock.question.deleteMany).not.toHaveBeenCalled();
  });

  it('a global catalogue course is refused even in the organisation that owns it', async () => {
    prismaMock.course.findUnique.mockResolvedValue({ ...colleaguesCourse, isGlobal: true });

    const result = await updateQuizQuestions('course-1', []);

    expect(result).toEqual({ success: false, error: 'Course not found.' });
    expect(prismaMock.question.deleteMany).not.toHaveBeenCalled();
  });

  it('a course with no quiz is refused by return, not thrown', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      ...colleaguesCourse,
      lessons: [{ id: 'lesson-1', quiz: null }],
    });

    const result = await updateQuizQuestions('course-1', []);

    expect(result.success).toBe(false);
    expect(prismaMock.question.deleteMany).not.toHaveBeenCalled();
  });
});

/**
 * BUG-30: an `answer` index outside `options` made `findIndex` return -1 and
 * `correctAnswer` undefined, which Prisma rejected INSIDE the transaction that
 * had already begun replacing the question set. The index is now validated up
 * front and refused before anything is read or written.
 */
describe('updateQuizQuestions — BUG-30 correct-answer index validation', () => {
  const question = (answer: number, options = ['A', 'B', 'C', 'D']) => ({
    question: 'Q?',
    options,
    answer,
  });

  it.each([
    ['past the last option', 4],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
  ])('an answer index that is %s is refused before any database access', async (_label, answer) => {
    const result = await updateQuizQuestions('course-1', [question(0), question(answer)]);

    expect(result).toEqual({
      success: false,
      error:
        'Question 2 has no valid correct answer. Mark one of its options as correct and save again.',
    });
    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.question.deleteMany).not.toHaveBeenCalled();
  });

  it('a question with no options is refused', async () => {
    const result = await updateQuizQuestions('course-1', [question(0, [])]);

    expect(result.success).toBe(false);
    expect(prismaMock.question.deleteMany).not.toHaveBeenCalled();
  });

  it('a non-array payload is refused rather than throwing', async () => {
    const result = await updateQuizQuestions(
      'course-1',
      'not-an-array' as unknown as Parameters<typeof updateQuizQuestions>[1],
    );

    expect(result.success).toBe(false);
    expect(prismaMock.question.deleteMany).not.toHaveBeenCalled();
  });

  // Positive control: every in-range index saves, and the stored correct
  // answer is the TEXT of the option the author marked, whatever the shuffle.
  it.each([0, 3])('an in-range index (%i) saves the marked option as correct', async (answer) => {
    const result = await updateQuizQuestions('course-1', [question(answer)]);

    expect(result).toEqual({ success: true });
    const rows = prismaMock.question.createMany.mock.calls[0][0].data;
    expect(rows[0].correctAnswer).toBe(['A', 'B', 'C', 'D'][answer]);
  });
});

/**
 * `updateLessonContent` RETURNS its refusals rather than throwing them.
 *
 * React redacts a thrown Server Action message to error #441 in production, so
 * every refusal below used to reach the user as `alert('Failed to save
 * changes')` with no reason at all. The gate itself is unchanged — what changed
 * is that the caller can now say WHY. `rejects.toThrow` is therefore the wrong
 * assertion here, and `resolves` is load-bearing: a regression back to `throw`
 * must redden these.
 */
describe('updateLessonContent — requires course.edit', () => {
  it.each(DENIED_ROLES)('%s is refused before the database is touched', async (role) => {
    mockAdminAuth.mockResolvedValue(session(role));

    await expect(updateLessonContent('lesson-1', 'new content')).resolves.toEqual({
      success: false,
      error: 'Your role does not have permission to edit course content.',
    });

    expect(prismaMock.lesson.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.lesson.update).not.toHaveBeenCalled();
  });

  // The population the "Edit Article" affordance was lying to: supervisor holds
  // course.read (so the admin review opens) but not course.edit.
  it('a supervisor is still refused when the action is called directly', async () => {
    mockAdminAuth.mockResolvedValue(session('supervisor'));

    const result = await updateLessonContent('lesson-1', 'new content');

    expect(result.success).toBe(false);
    expect(prismaMock.lesson.update).not.toHaveBeenCalled();
  });

  it('COU-004: a colleague’s lesson in the caller’s own org is editable', async () => {
    await expect(updateLessonContent('lesson-1', 'new content')).resolves.toMatchObject({
      success: true,
    });
  });

  it('a lesson whose course belongs to another organisation is refused', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({
      id: 'lesson-1',
      courseId: 'course-1',
      title: 'Lesson 1',
      course: { id: 'course-1', organizationId: OTHER_ORG, isGlobal: false },
    });

    await expect(updateLessonContent('lesson-1', 'new content')).resolves.toEqual({
      success: false,
      error: 'This lesson could not be found in your organization, so it cannot be edited here.',
    });
    expect(prismaMock.lesson.update).not.toHaveBeenCalled();
  });

  // An adopted GLOBAL catalogue course is readable by every org (the learn
  // payload grants the review), but it is owned by whoever authored it — so an
  // owner with the verb is still refused, and used to be refused silently.
  it('an owner is refused on a global catalogue course another org authored', async () => {
    mockAdminAuth.mockResolvedValue(session('owner'));
    prismaMock.lesson.findUnique.mockResolvedValue({
      id: 'lesson-1',
      courseId: 'course-1',
      title: 'Lesson 1',
      course: { id: 'course-1', organizationId: OTHER_ORG, isGlobal: true },
    });

    const result = await updateLessonContent('lesson-1', 'new content');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(prismaMock.lesson.update).not.toHaveBeenCalled();
  });

  it('an unauthenticated caller is told so rather than throwing', async () => {
    mockAdminAuth.mockResolvedValue(null);

    const result = await updateLessonContent('lesson-1', 'new content');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(prismaMock.lesson.findUnique).not.toHaveBeenCalled();
  });

  // PhiBlockedError already carries a user-safe message — the one refusal where
  // the wording is the entire value of the gate.
  it('surfaces the PHI gate’s own message instead of losing it to redaction', async () => {
    mockAssertNoPhi.mockRejectedValue(new PhiBlockedError('This content appears to contain PHI.'));

    await expect(updateLessonContent('lesson-1', 'Jane Doe, DOB 1/1/80')).resolves.toEqual({
      success: false,
      error: 'This content appears to contain PHI.',
    });
    expect(prismaMock.lesson.update).not.toHaveBeenCalled();
  });

  // Only EXPECTED refusals are returned. An unexpected failure has nothing
  // actionable to tell the user, so it still propagates.
  it('rethrows an unexpected failure from the PHI gate', async () => {
    mockAssertNoPhi.mockRejectedValue(new Error('vertex unreachable'));

    await expect(updateLessonContent('lesson-1', 'new content')).rejects.toThrow(
      'vertex unreachable',
    );
  });

  // The role gate runs ahead of the PHI scan, so a caller who may not edit
  // anything never gets the rich-text body scanned (or logged) on their behalf.
  it('denies before the PHI gate runs', async () => {
    mockAdminAuth.mockResolvedValue(session('finance'));

    await expect(updateLessonContent('lesson-1', 'new content')).resolves.toMatchObject({
      success: false,
    });
    expect(mockAssertNoPhi).not.toHaveBeenCalled();
  });
});

/**
 * `updateLessonSlideContent` is the slide editor's save path — the same gates as
 * `updateLessonContent` over a different column, plus the `slideContentEditedAt`
 * stamp that records the slides are no longer purely AI output.
 *
 * `canEditContent` on the learn payload decides only whether the editor is
 * OFFERED. These tests call the action directly, exactly as a tampered client
 * would, so every gate must hold on its own.
 */
describe('updateLessonSlideContent — requires course.edit', () => {
  const SLIDES = '<div class="rich-slide"><h2>Hand Hygiene</h2></div>';

  it.each(DENIED_ROLES)('%s is refused before the database is touched', async (role) => {
    mockAdminAuth.mockResolvedValue(session(role));

    await expect(updateLessonSlideContent('lesson-1', SLIDES)).resolves.toEqual({
      success: false,
      error: 'Your role does not have permission to edit course content.',
    });

    expect(prismaMock.lesson.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.lesson.update).not.toHaveBeenCalled();
    expect(mockAssertNoPhi).not.toHaveBeenCalled();
  });

  it('an unauthenticated caller is told so rather than throwing', async () => {
    mockAdminAuth.mockResolvedValue(null);

    const result = await updateLessonSlideContent('lesson-1', SLIDES);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(prismaMock.lesson.findUnique).not.toHaveBeenCalled();
  });

  // Positive control: without this, a gate that refused EVERYONE would pass
  // every test above.
  it.each(['owner', 'hr'])(
    '%s saves a colleague’s lesson in their own organisation',
    async (role) => {
      mockAdminAuth.mockResolvedValue(session(role));

      await expect(updateLessonSlideContent('lesson-1', SLIDES)).resolves.toEqual({
        success: true,
      });
      expect(prismaMock.lesson.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lesson-1' },
          data: expect.objectContaining({ slideContent: SLIDES }),
        }),
      );
    },
  );

  // The stamp is the only durable "a human changed these slides" signal, so a
  // save that writes the markup without it would silently defeat the audit
  // trail and any future regeneration guard.
  it('stamps slideContentEditedAt with the time of the save', async () => {
    const before = Date.now();

    await updateLessonSlideContent('lesson-1', SLIDES);

    const { data } = prismaMock.lesson.update.mock.calls[0][0];
    expect(data.slideContentEditedAt).toBeInstanceOf(Date);
    expect(data.slideContentEditedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.slideContentEditedAt.getTime()).toBeLessThanOrEqual(Date.now());
    // The lesson body is a separate editor with its own action; this one must
    // not touch it.
    expect(data).not.toHaveProperty('content');
  });

  // Missing and foreign are deliberately indistinguishable: a different answer
  // would confirm to another tenant that a lesson id exists.
  it('a lesson whose course belongs to another organisation is refused', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({
      id: 'lesson-1',
      courseId: 'course-1',
      title: 'Lesson 1',
      course: { id: 'course-1', organizationId: OTHER_ORG, isGlobal: false },
    });

    await expect(updateLessonSlideContent('lesson-1', SLIDES)).resolves.toEqual({
      success: false,
      error: 'This lesson could not be found in your organization, so it cannot be edited here.',
    });
    expect(prismaMock.lesson.update).not.toHaveBeenCalled();
  });

  it('a lesson that does not exist is refused in exactly the same words', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(null);

    await expect(updateLessonSlideContent('missing-lesson', SLIDES)).resolves.toEqual({
      success: false,
      error: 'This lesson could not be found in your organization, so it cannot be edited here.',
    });
    expect(prismaMock.lesson.update).not.toHaveBeenCalled();
  });

  it('scans the slide markup through the PHI gate before writing', async () => {
    await updateLessonSlideContent('lesson-1', SLIDES);

    expect(mockAssertNoPhi).toHaveBeenCalledWith(
      expect.objectContaining({ text: SLIDES, source: 'lesson_slide_edit' }),
    );
  });

  it('surfaces the PHI gate’s own message instead of losing it to redaction', async () => {
    mockAssertNoPhi.mockRejectedValue(new PhiBlockedError('This content appears to contain PHI.'));

    await expect(
      updateLessonSlideContent('lesson-1', '<h2>Jane Doe, DOB 1/1/80</h2>'),
    ).resolves.toEqual({
      success: false,
      error: 'This content appears to contain PHI.',
    });
    expect(prismaMock.lesson.update).not.toHaveBeenCalled();
  });

  it('rethrows an unexpected failure from the PHI gate', async () => {
    mockAssertNoPhi.mockRejectedValue(new Error('vertex unreachable'));

    await expect(updateLessonSlideContent('lesson-1', SLIDES)).rejects.toThrow(
      'vertex unreachable',
    );
  });
});

/**
 * BUG-11: `updateCourse` required AUTHORSHIP, so a colleague who could assign,
 * withdraw and archive a course could not rename it. It is now authorised by
 * `course.edit` plus ownership by the caller's organisation, excluding the
 * global catalogue — and, like the content writers above, it RETURNS refusals.
 */
describe('updateCourse — course.edit + organisation ownership', () => {
  beforeEach(() => {
    prismaMock.course.update.mockResolvedValue({ id: 'course-1' });
  });

  it.each(['owner', 'hr'])('%s renames a colleague’s course in their own org', async (role) => {
    mockAdminAuth.mockResolvedValue(session(role));

    await expect(updateCourse('course-1', { title: 'Renamed' })).resolves.toEqual({
      success: true,
    });
    expect(prismaMock.course.update).toHaveBeenCalledWith({
      where: { id: 'course-1' },
      data: { title: 'Renamed' },
    });
  });

  it.each(DENIED_ROLES)('%s is refused before the database is touched', async (role) => {
    mockAdminAuth.mockResolvedValue(session(role));

    await expect(updateCourse('course-1', { title: 'Renamed' })).resolves.toEqual({
      success: false,
      error: 'Your role does not have permission to edit courses.',
    });
    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it('a course owned by another organisation is refused, even one the caller authored', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      ...colleaguesCourse,
      createdByOrgUserId: CALLER_OU,
      organizationId: OTHER_ORG,
    });

    await expect(updateCourse('course-1', { title: 'Renamed' })).resolves.toEqual({
      success: false,
      error: 'Course not found.',
    });
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it('a global catalogue course is refused', async () => {
    prismaMock.course.findUnique.mockResolvedValue({ ...colleaguesCourse, isGlobal: true });

    await expect(updateCourse('course-1', { title: 'Renamed' })).resolves.toEqual({
      success: false,
      error: 'Course not found.',
    });
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it('a missing course is refused in exactly the same words as a foreign one', async () => {
    prismaMock.course.findUnique.mockResolvedValue(null);

    await expect(updateCourse('missing', { title: 'Renamed' })).resolves.toEqual({
      success: false,
      error: 'Course not found.',
    });
  });

  it('an unauthenticated caller is told so rather than throwing', async () => {
    mockAdminAuth.mockResolvedValue(null);

    const result = await updateCourse('course-1', { title: 'Renamed' });

    expect(result.success).toBe(false);
    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
  });
});
