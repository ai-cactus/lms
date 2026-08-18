/**
 * F-034: role checks on course and lesson mutators.
 *
 * Before this, these actions verified only that SOME session existed and that the
 * course's `createdBy` matched the caller. Ownership is not
 * authorization — every authenticated member of the org, a worker included, could
 * create, edit, delete and reorder course content.
 *
 * These tests pin the distinction: same org, same membership, insufficient role.
 * A test that only checked "logged out is denied" would have passed before the
 * fix and proves nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: {
    course: { findUnique: vi.fn(), update: vi.fn() },
    lesson: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { createLesson, updateLesson, deleteLesson, reorderLessons } from './lesson';

const OWNER_USER_ID = 'u-1';

/** A session in the SAME org that owns the course — only the role differs. */
function sessionWithRole(role: string) {
  return {
    user: { id: OWNER_USER_ID, role, organizationId: 'org-1' },
  };
}

const OWNED_COURSE = {
  id: 'course-1',
  createdBy: OWNER_USER_ID,
  lessons: [{ order: 1 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.course.findUnique.mockResolvedValue(OWNED_COURSE);
  prismaMock.lesson.findUnique.mockResolvedValue({
    id: 'lesson-1',
    courseId: 'course-1',
    course: OWNED_COURSE,
  });
  prismaMock.lesson.create.mockResolvedValue({ id: 'lesson-new' });
  prismaMock.lesson.update.mockResolvedValue({ id: 'lesson-1' });
  prismaMock.lesson.delete.mockResolvedValue({ id: 'lesson-1' });
  prismaMock.$transaction.mockResolvedValue([]);
});

describe('lesson mutators — deny a role without course.edit', () => {
  // therapist_clinician is a clinical/learner-tier role: a legitimate member of
  // the organization that owns the course, which is exactly the case ownership
  // checks alone could not catch.
  const LEARNER_ROLE = 'therapist_clinician';

  it('createLesson is denied', async () => {
    mockAuth.mockResolvedValue(sessionWithRole(LEARNER_ROLE));

    await expect(createLesson({ courseId: 'course-1', title: 'T', content: 'C' })).rejects.toThrow(
      'Insufficient permissions',
    );

    expect(prismaMock.lesson.create).not.toHaveBeenCalled();
  });

  it('updateLesson is denied', async () => {
    mockAuth.mockResolvedValue(sessionWithRole(LEARNER_ROLE));

    await expect(updateLesson('lesson-1', { title: 'T' })).rejects.toThrow(
      'Insufficient permissions',
    );

    expect(prismaMock.lesson.update).not.toHaveBeenCalled();
  });

  it('deleteLesson is denied', async () => {
    mockAuth.mockResolvedValue(sessionWithRole(LEARNER_ROLE));

    await expect(deleteLesson('lesson-1')).rejects.toThrow('Insufficient permissions');

    expect(prismaMock.lesson.delete).not.toHaveBeenCalled();
  });

  it('reorderLessons is denied', async () => {
    mockAuth.mockResolvedValue(sessionWithRole(LEARNER_ROLE));

    await expect(reorderLessons('course-1', [{ id: 'lesson-1', order: 2 }])).rejects.toThrow(
      'Insufficient permissions',
    );

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // The guard must run BEFORE the ownership lookup, so a denial cannot be
  // distinguished from a non-existent course by timing or by DB load.
  it('denies before touching the database', async () => {
    mockAuth.mockResolvedValue(sessionWithRole(LEARNER_ROLE));

    await expect(createLesson({ courseId: 'course-1', title: 'T', content: 'C' })).rejects.toThrow(
      'Insufficient permissions',
    );

    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
  });
});

describe('lesson mutators — allow a role with course.edit', () => {
  it('createLesson succeeds for an owner', async () => {
    mockAuth.mockResolvedValue(sessionWithRole('owner'));

    await expect(
      createLesson({ courseId: 'course-1', title: 'T', content: 'C' }),
    ).resolves.toMatchObject({ id: 'lesson-new' });

    expect(prismaMock.lesson.create).toHaveBeenCalledTimes(1);
  });
});

describe('lesson mutators — unauthenticated', () => {
  it('createLesson is denied with no session at all', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(createLesson({ courseId: 'course-1', title: 'T', content: 'C' })).rejects.toThrow(
      'Unauthorized',
    );
  });
});
