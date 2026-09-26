/**
 * The user-deletion impact preview must see ARCHIVED courses and documents.
 *
 * Deleting a user transfers custody of the courses they authored and the
 * documents they uploaded (BUG-09) rather than destroying them — and Q24-archived
 * rows have to move too, or `Course.creator`'s Restrict blocks the delete and a
 * document's Cascade destroys a row that was meant to be retained. Read through
 * the archive-filtered client, those rows are simply invisible: the confirmation
 * screen under-reports what changes hands, on the one screen whose whole job is
 * to report exactly that.
 *
 * The two clients therefore get DIFFERENT spies here, with the filtered one
 * wired to the smaller "live rows only" answer — so a regression that swaps
 * them changes the numbers rather than merely re-routing the query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockVerifyCookie,
  mockRawCourseFindMany,
  mockRawDocumentFindMany,
  mockRawOrgUserFindMany,
  mockFilteredCourseFindMany,
  mockFilteredDocumentFindMany,
  mockUserFindUnique,
  mockOrgUserFindMany,
  mockEnrollmentCount,
  mockCount,
} = vi.hoisted(() => ({
  mockVerifyCookie: vi.fn(),
  mockRawCourseFindMany: vi.fn(),
  mockRawDocumentFindMany: vi.fn(),
  mockRawOrgUserFindMany: vi.fn(),
  mockFilteredCourseFindMany: vi.fn(),
  mockFilteredDocumentFindMany: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
  mockEnrollmentCount: vi.fn(),
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
    course: { findMany: mockFilteredCourseFindMany },
    document: { findMany: mockFilteredDocumentFindMany },
    enrollment: { count: mockEnrollmentCount },
    certificate: { count: mockCount },
    notification: { count: mockCount },
    job: { count: mockCount },
    invite: { count: mockCount },
    verificationToken: { count: mockCount },
    quizAttempt: { count: mockCount },
  };
  return { prisma, default: prisma };
});
vi.mock('@/db/index', () => ({
  rawPrisma: {
    course: { findMany: mockRawCourseFindMany },
    document: { findMany: mockRawDocumentFindMany },
    organizationUser: { findMany: mockRawOrgUserFindMany },
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
  mockOrgUserFindMany.mockResolvedValue([
    {
      id: 'ou-1',
      role: 'admin',
      organizationId: 'org-1',
      organization: { name: 'Northside Clinic' },
    },
  ]);
  mockCount.mockResolvedValue(0);
  mockEnrollmentCount.mockResolvedValue(0);
  // 3 courses and 2 documents exist; one course and one document are archived.
  mockRawCourseFindMany.mockResolvedValue([
    { id: 'c1', createdByOrgUserId: 'ou-1' },
    { id: 'c2', createdByOrgUserId: 'ou-1' },
    { id: 'c-archived', createdByOrgUserId: 'ou-1' },
  ]);
  mockRawDocumentFindMany.mockResolvedValue([
    { organizationUserId: 'ou-1' },
    { organizationUserId: 'ou-1' },
  ]);
  mockRawOrgUserFindMany.mockResolvedValue([
    { id: 'ou-owner', role: 'owner', active: true, joinedAt: new Date('2026-01-01') },
  ]);
  // What the archive-filtered client would report instead.
  mockFilteredCourseFindMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
  mockFilteredDocumentFindMany.mockResolvedValue([{ organizationUserId: 'ou-1' }]);
});

describe('getUserDeletePreview — reports what the delete really does', () => {
  it('includes archived courses and documents in the retained counts', async () => {
    const preview = await getUserDeletePreview('u1');

    expect(preview?.retained.courses).toBe(3);
    expect(preview?.retained.documents).toBe(2);
    expect(mockFilteredCourseFindMany).not.toHaveBeenCalled();
    expect(mockFilteredDocumentFindMany).not.toHaveBeenCalled();
  });

  it('derives the affected-enrollment lookup from the archived set too', async () => {
    await getUserDeletePreview('u1');

    expect(mockRawCourseFindMany).toHaveBeenCalledTimes(1);
    const byCourse = mockEnrollmentCount.mock.calls.find(
      (args) => (args[0] as { where?: { courseId?: unknown } })?.where?.courseId !== undefined,
    );
    expect(byCourse?.[0]).toMatchObject({
      where: {
        courseId: { in: ['c1', 'c2', 'c-archived'] },
        organizationUserId: { notIn: ['ou-1'] },
      },
    });
  });

  it('flags an organization with assets but no surviving member to inherit them', async () => {
    mockRawOrgUserFindMany.mockResolvedValue([]);

    const preview = await getUserDeletePreview('u1');

    expect(preview?.retained.organizationsWithoutCustodian).toEqual(['Northside Clinic']);
  });

  it('does not look for a custodian when the account holds no org assets', async () => {
    mockRawCourseFindMany.mockResolvedValue([]);
    mockRawDocumentFindMany.mockResolvedValue([]);

    const preview = await getUserDeletePreview('u1');

    expect(preview?.retained.organizationsWithoutCustodian).toEqual([]);
    expect(mockRawOrgUserFindMany).not.toHaveBeenCalled();
  });
});
