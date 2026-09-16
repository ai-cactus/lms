/**
 * The user-deletion impact preview must count ARCHIVED courses and documents.
 *
 * `deleteUserWithRelations` is a HARD delete. Writes are never intercepted by
 * the Q24 archive extension, so its `deleteMany` calls destroy archived rows
 * along with live ones — while the preview in front of it, and the `findMany`
 * that derives `courseIds` for the cascade, would read through the filtered
 * client and simply not see them.
 *
 * Two consequences, both silent:
 *   • the confirmation screen under-reports what the operator is about to
 *     destroy, on the one screen whose whole job is to report exactly that;
 *   • the cascade pass misses an archived course's enrollments and quiz
 *     attempts, which then block the delete on a foreign key.
 *
 * The two clients therefore get DIFFERENT spies here, with the filtered one
 * wired to the smaller "live rows only" answer — so a regression that swaps
 * them changes the numbers rather than merely re-routing the query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockVerifyCookie,
  mockRawCourseCount,
  mockRawCourseFindMany,
  mockRawDocumentCount,
  mockFilteredCourseCount,
  mockFilteredCourseFindMany,
  mockFilteredDocumentCount,
  mockUserFindUnique,
  mockOrgUserFindMany,
  mockCount,
} = vi.hoisted(() => ({
  mockVerifyCookie: vi.fn(),
  mockRawCourseCount: vi.fn(),
  mockRawCourseFindMany: vi.fn(),
  mockRawDocumentCount: vi.fn(),
  mockFilteredCourseCount: vi.fn(),
  mockFilteredCourseFindMany: vi.fn(),
  mockFilteredDocumentCount: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock('@/lib/system-auth', () => ({
  verifySystemAdminCookie: mockVerifyCookie,
  SYSTEM_ADMIN_COOKIE: 'system_admin',
}));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    user: { findUnique: mockUserFindUnique },
    organizationUser: { findMany: mockOrgUserFindMany },
    course: { count: mockFilteredCourseCount, findMany: mockFilteredCourseFindMany },
    document: { count: mockFilteredDocumentCount },
    enrollment: { count: mockCount },
    notification: { count: mockCount },
    job: { count: mockCount },
    invite: { count: mockCount },
    verificationToken: { count: mockCount },
    lesson: { count: mockCount },
    quiz: { count: mockCount },
    quizAttempt: { count: mockCount },
  };
  return { prisma, default: prisma };
});
vi.mock('@/db/index', () => ({
  rawPrisma: {
    course: { count: mockRawCourseCount, findMany: mockRawCourseFindMany },
    document: { count: mockRawDocumentCount },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('@/lib/audit', () => ({
  audit: vi.fn(),
  auditCritical: vi.fn(),
  getClientContext: () => ({}),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));

import { getUserDeletePreview } from './system-admin';

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCookie.mockResolvedValue(true);
  mockUserFindUnique.mockResolvedValue({
    id: 'u1',
    email: 'author@example.com',
    fullName: 'Ada Author',
  });
  mockOrgUserFindMany.mockResolvedValue([{ id: 'ou-1', role: 'admin' }]);
  mockCount.mockResolvedValue(0);
  // 3 courses and 2 documents exist; one course and one document are archived.
  mockRawCourseCount.mockResolvedValue(3);
  mockRawDocumentCount.mockResolvedValue(2);
  mockRawCourseFindMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }, { id: 'c-archived' }]);
  // What the archive-filtered client would report instead.
  mockFilteredCourseCount.mockResolvedValue(2);
  mockFilteredDocumentCount.mockResolvedValue(1);
  mockFilteredCourseFindMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
});

describe('getUserDeletePreview — counts what the hard delete actually destroys', () => {
  it('includes archived courses and documents in the impact counts', async () => {
    const preview = await getUserDeletePreview('u1');

    expect(preview?.counts.courses).toBe(3);
    expect(preview?.counts.documents).toBe(2);
    expect(mockFilteredCourseCount).not.toHaveBeenCalled();
    expect(mockFilteredDocumentCount).not.toHaveBeenCalled();
  });

  it('derives the cascade course ids from the archived set too', async () => {
    await getUserDeletePreview('u1');

    expect(mockRawCourseFindMany).toHaveBeenCalledTimes(1);
    expect(mockFilteredCourseFindMany).not.toHaveBeenCalled();
    // The lesson/quiz cascade counts are computed from those ids — an archived
    // course dropping out here is what leaves its rows behind at delete time.
    const lessonCall = mockCount.mock.calls.find(
      (args) => (args[0] as { where?: { courseId?: unknown } })?.where?.courseId !== undefined,
    );
    expect(lessonCall?.[0]).toMatchObject({
      where: { courseId: { in: ['c1', 'c2', 'c-archived'] } },
    });
  });
});
