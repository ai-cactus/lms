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
vi.mock('./notifications', () => ({ notifyOrganizationAdmins: vi.fn() }));
vi.mock('./enrollment', () => ({ enrollUsers: vi.fn(), assignCourseToRoles: vi.fn() }));
vi.mock('@/lib/documents/phiGate', () => ({ assertNoPhi: mockAssertNoPhi }));

import { createFullCourse, updateQuizQuestions, updateLessonContent } from './course';

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
  creator: { organizationId: ORG },
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
  mockAdminAuth.mockResolvedValue(session('owner'));
  prismaMock.course.findUnique.mockResolvedValue(colleaguesCourse);
  prismaMock.course.create.mockResolvedValue({ id: 'course-1', lessons: [] });
  prismaMock.lesson.findUnique.mockResolvedValue({
    id: 'lesson-1',
    courseId: 'course-1',
    title: 'Lesson 1',
    course: { id: 'course-1', creator: { organizationId: ORG } },
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

describe('updateQuizQuestions — requires course.edit', () => {
  it.each(DENIED_ROLES)('%s is denied before the database is touched', async (role) => {
    mockAdminAuth.mockResolvedValue(session(role));

    await expect(updateQuizQuestions('course-1', [])).rejects.toThrow('Insufficient permissions');

    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.question.deleteMany).not.toHaveBeenCalled();
  });

  it('COU-004: a colleague’s course in the caller’s own org is editable', async () => {
    await expect(updateQuizQuestions('course-1', [])).resolves.toMatchObject({ success: true });
  });

  it('a course owned by another organisation is refused', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      ...colleaguesCourse,
      creator: { organizationId: OTHER_ORG },
    });

    await expect(updateQuizQuestions('course-1', [])).rejects.toThrow(
      'Unauthorized or Course not found',
    );
    expect(prismaMock.question.deleteMany).not.toHaveBeenCalled();
  });
});

describe('updateLessonContent — requires course.edit', () => {
  it.each(DENIED_ROLES)('%s is denied before the database is touched', async (role) => {
    mockAdminAuth.mockResolvedValue(session(role));

    await expect(updateLessonContent('lesson-1', 'new content')).rejects.toThrow(
      'Insufficient permissions',
    );

    expect(prismaMock.lesson.findUnique).not.toHaveBeenCalled();
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
      course: { id: 'course-1', creator: { organizationId: OTHER_ORG } },
    });

    await expect(updateLessonContent('lesson-1', 'new content')).rejects.toThrow(
      'Unauthorized or Lesson not found',
    );
    expect(prismaMock.lesson.update).not.toHaveBeenCalled();
  });

  // The role gate runs ahead of the PHI scan, so a caller who may not edit
  // anything never gets the rich-text body scanned (or logged) on their behalf.
  it('denies before the PHI gate runs', async () => {
    mockAdminAuth.mockResolvedValue(session('finance'));

    await expect(updateLessonContent('lesson-1', 'new content')).rejects.toThrow(
      'Insufficient permissions',
    );
    expect(mockAssertNoPhi).not.toHaveBeenCalled();
  });
});
