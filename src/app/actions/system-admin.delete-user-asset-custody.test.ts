/**
 * BUG-09: deleting a user must not delete the organization's courses.
 *
 * `deleteUserWithRelations` used to run `tx.course.deleteMany` over every course
 * the account had authored, with no `isGlobal` guard and no archive step — so
 * deleting a platform author took Theraptly's global courses with it, together
 * with every other tenant's enrollments, quiz attempts and certificates in them.
 * It also contradicted Q24 (archive, never destroy) and Q25 (courses and
 * documents belong to the ORGANIZATION; `createdByOrgUserId` records authorship
 * only).
 *
 * The rule these tests pin:
 *   • a course is NEVER hard-deleted, and never archived either, as a side
 *     effect of deleting its author — global and org-owned alike;
 *   • custody of authored courses and uploaded documents moves to the most
 *     senior surviving member of the same organization;
 *   • other members' enrollments, attempts and certificates are never touched;
 *   • with no surviving member to inherit them, the delete is REFUSED rather
 *     than destroying the assets.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockVerifyCookie, mockUserFindUnique, mockTransaction } = vi.hoisted(() => ({
  mockVerifyCookie: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('@/lib/system-auth', () => ({
  verifySystemAdminCookie: mockVerifyCookie,
  SYSTEM_ADMIN_COOKIE: 'system_admin',
}));
vi.mock('@/lib/prisma', () => {
  const prisma = { user: { findUnique: mockUserFindUnique } };
  return { prisma, default: prisma };
});
vi.mock('@/db/index', () => ({
  rawPrisma: { $transaction: mockTransaction },
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

import { deleteUserWithRelations } from './system-admin';

type Membership = { id: string; organizationId: string };
type Candidate = { id: string; role: string; active: boolean; joinedAt: Date };

interface TxMock {
  organizationUser: { findMany: ReturnType<typeof vi.fn> };
  course: {
    count: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  document: {
    count: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  certificate: { count: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  quizAttempt: { deleteMany: ReturnType<typeof vi.fn> };
  enrollment: { deleteMany: ReturnType<typeof vi.fn> };
  notification: { deleteMany: ReturnType<typeof vi.fn> };
  job: { deleteMany: ReturnType<typeof vi.fn> };
  invite: { deleteMany: ReturnType<typeof vi.fn> };
  verificationToken: { deleteMany: ReturnType<typeof vi.fn> };
  user: { delete: ReturnType<typeof vi.fn> };
}

/**
 * A transaction client whose destructive methods all resolve normally, so a
 * regression that calls one fails on the `not.toHaveBeenCalled()` assertion
 * rather than on an unrelated crash inside the action's catch block.
 */
function buildTx(options: {
  memberships: Membership[];
  survivors: Candidate[];
  courses: number;
  documents: number;
}): TxMock {
  const tx: TxMock = {
    organizationUser: {
      findMany: vi.fn(async (args: { where: { userId?: string } }) =>
        args.where.userId !== undefined ? options.memberships : options.survivors,
      ),
    },
    course: {
      count: vi.fn().mockResolvedValue(options.courses),
      updateMany: vi.fn().mockResolvedValue({ count: options.courses }),
      deleteMany: vi.fn().mockResolvedValue({ count: options.courses }),
    },
    document: {
      count: vi.fn().mockResolvedValue(options.documents),
      updateMany: vi.fn().mockResolvedValue({ count: options.documents }),
      deleteMany: vi.fn().mockResolvedValue({ count: options.documents }),
    },
    certificate: {
      count: vi.fn().mockResolvedValue(3),
      deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
    },
    quizAttempt: { deleteMany: vi.fn().mockResolvedValue({ count: 4 }) },
    enrollment: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    notification: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    job: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    invite: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    verificationToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    user: { delete: vi.fn().mockResolvedValue({ id: 'u1' }) },
  };

  mockTransaction.mockImplementation(async (fn: (client: TxMock) => Promise<unknown>) => fn(tx));
  return tx;
}

const OWNER: Candidate = {
  id: 'ou-owner',
  role: 'owner',
  active: true,
  joinedAt: new Date('2026-01-01'),
};
const HR: Candidate = { id: 'ou-hr', role: 'hr', active: true, joinedAt: new Date('2025-01-01') };
const WORKER: Candidate = {
  id: 'ou-worker',
  role: 'nurse',
  active: true,
  joinedAt: new Date('2024-01-01'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCookie.mockResolvedValue(true);
  mockUserFindUnique.mockResolvedValue({ id: 'u1', email: 'author@example.com' });
});

describe('deleteUserWithRelations — courses survive their author', () => {
  it('never deletes or archives the courses the account authored, global ones included', async () => {
    const tx = buildTx({
      // Two courses: one Theraptly global, one org-owned. Neither may be
      // destroyed, so the action never filters on `isGlobal` — it filters on
      // nothing, because nothing is deleted.
      memberships: [{ id: 'ou-author', organizationId: 'org-1' }],
      survivors: [OWNER],
      courses: 2,
      documents: 0,
    });

    const result = await deleteUserWithRelations('u1');

    expect(result.success).toBe(true);
    expect(tx.course.deleteMany).not.toHaveBeenCalled();
    expect(tx.course.updateMany).toHaveBeenCalledWith({
      where: { createdByOrgUserId: 'ou-author' },
      data: { createdByOrgUserId: 'ou-owner' },
    });
    // Archiving would withdraw the course from every list; losing the author is
    // not a reason to stop offering the org's training.
    for (const call of tx.course.updateMany.mock.calls) {
      expect(call[0]).not.toHaveProperty('data.archivedAt');
    }
    expect(result.transferredCounts).toMatchObject({ courses: 2 });
  });

  it('transfers custody of uploaded documents instead of letting the cascade destroy them', async () => {
    const tx = buildTx({
      memberships: [{ id: 'ou-author', organizationId: 'org-1' }],
      survivors: [OWNER],
      courses: 0,
      documents: 5,
    });

    const result = await deleteUserWithRelations('u1');

    expect(result.success).toBe(true);
    expect(tx.document.deleteMany).not.toHaveBeenCalled();
    expect(tx.document.updateMany).toHaveBeenCalledWith({
      where: { organizationUserId: 'ou-author' },
      data: { organizationUserId: 'ou-owner' },
    });
    expect(result.transferredCounts).toMatchObject({ documents: 5 });
  });

  it('leaves other members’ enrollments, attempts and certificates alone', async () => {
    const tx = buildTx({
      memberships: [{ id: 'ou-author', organizationId: 'org-1' }],
      survivors: [OWNER],
      courses: 2,
      documents: 0,
    });

    await deleteUserWithRelations('u1');

    // Every destructive query must be keyed to THIS identity's memberships. A
    // `courseId` predicate is the old bug: it reached other tenants' learning
    // history through the courses this person happened to author.
    expect(tx.enrollment.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.enrollment.deleteMany).toHaveBeenCalledWith({
      where: { organizationUserId: { in: ['ou-author'] } },
    });
    expect(tx.quizAttempt.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.quizAttempt.deleteMany).toHaveBeenCalledWith({
      where: { enrollment: { organizationUserId: { in: ['ou-author'] } } },
    });
    expect(tx.certificate.deleteMany).not.toHaveBeenCalled();
  });

  it('picks the most senior surviving member as custodian', async () => {
    const tx = buildTx({
      memberships: [{ id: 'ou-author', organizationId: 'org-1' }],
      // Deliberately out of seniority order, and the worker joined first, so a
      // naive "first row" or "oldest membership" pick would choose wrongly.
      survivors: [WORKER, HR, OWNER],
      courses: 1,
      documents: 0,
    });

    await deleteUserWithRelations('u1');

    expect(tx.course.updateMany).toHaveBeenCalledWith({
      where: { createdByOrgUserId: 'ou-author' },
      data: { createdByOrgUserId: 'ou-owner' },
    });
    // The account's own memberships can never inherit from themselves.
    const custodianQuery = tx.organizationUser.findMany.mock.calls.at(-1)?.[0];
    expect(custodianQuery).toMatchObject({
      where: { organizationId: 'org-1', id: { notIn: ['ou-author'] } },
    });
  });

  it('refuses the delete when no member survives to inherit the assets', async () => {
    const tx = buildTx({
      memberships: [{ id: 'ou-author', organizationId: 'org-1' }],
      survivors: [],
      courses: 1,
      documents: 0,
    });

    const result = await deleteUserWithRelations('u1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no other member to inherit/i);
    expect(tx.course.deleteMany).not.toHaveBeenCalled();
    expect(tx.course.updateMany).not.toHaveBeenCalled();
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it('deletes an account that holds no org assets without looking for a custodian', async () => {
    const tx = buildTx({
      memberships: [{ id: 'ou-worker', organizationId: 'org-1' }],
      survivors: [],
      courses: 0,
      documents: 0,
    });

    const result = await deleteUserWithRelations('u1');

    expect(result.success).toBe(true);
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(tx.organizationUser.findMany).toHaveBeenCalledTimes(1);
  });
});
