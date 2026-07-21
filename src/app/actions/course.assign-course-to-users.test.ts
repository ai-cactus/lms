/**
 * Unit tests for assignCourseToUsers (src/app/actions/course.ts).
 *
 * Defect B — billing-gated course assignment (defense in depth). This action
 * has zero live callers today, but it duplicates the same billing gate as
 * enrollUsers() and must be tested directly per the approved plan: reject
 * with the billing message BEFORE any enrollment write when the org lacks
 * active billing, and otherwise proceed exactly as before.
 *
 * Kept in its own file (mirroring enrollment.assignment.test.ts) rather than
 * folded into course.test.ts, which mocks a narrower prisma surface
 * (course.findMany/enrollment.groupBy) for getDashboardData and doesn't wire
 * course.findUnique / enrollment.createMany.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth, mockWorkerAuth, mockRevalidatePath } = vi.hoisted(() => {
  const prismaMock = {
    course: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    enrollment: { createMany: vi.fn() },
  };
  return {
    prismaMock,
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockRevalidatePath: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/reminders/sweep', () => ({ resolveOnCompletion: vi.fn() }));

import { assignCourseToUsers } from './course';

const ADMIN_ID = 'admin-001';
const ORG_ID = 'org-001';
const COURSE_ID = 'course-001';

const ownCourse = { createdBy: ADMIN_ID, title: 'My Training' };

function currentUserWithSubscription(subscription: unknown) {
  return {
    organizationId: ORG_ID,
    organization: { subscription },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue({ user: { id: ADMIN_ID } });
  mockWorkerAuth.mockResolvedValue(null);
  prismaMock.course.findUnique.mockResolvedValue(ownCourse);
  prismaMock.user.findMany.mockResolvedValue([{ id: 'staff-1', email: 'staff@acme.com' }]);
  prismaMock.enrollment.createMany.mockResolvedValue({ count: 1 });
});

describe('assignCourseToUsers — auth / ownership guards', () => {
  it('throws Unauthorized when there is no session', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(assignCourseToUsers(COURSE_ID, ['staff@acme.com'])).rejects.toThrow(
      'Unauthorized',
    );
  });

  it('throws when the course does not exist or is not owned by the caller', async () => {
    prismaMock.course.findUnique.mockResolvedValue(null);

    await expect(assignCourseToUsers(COURSE_ID, ['staff@acme.com'])).rejects.toThrow(
      'Course not found or unauthorized',
    );
  });

  it('throws when the caller has no organization', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ organizationId: null, organization: null });

    await expect(assignCourseToUsers(COURSE_ID, ['staff@acme.com'])).rejects.toThrow(
      'You must belong to an organization to assign courses',
    );
  });
});

// ---------------------------------------------------------------------------
// Defect B — billing gate matrix. Mirrors the matrix covered for enrollUsers.
// ---------------------------------------------------------------------------

describe('assignCourseToUsers — billing gate (Defect B)', () => {
  it.each([
    ['no subscription row at all', null],
    ['a canceled subscription', { status: 'canceled', pausedAt: null }],
    ['a past_due subscription', { status: 'past_due', pausedAt: null }],
    [
      'an active subscription that is currently paused',
      { status: 'active', pausedAt: new Date('2026-01-01T00:00:00Z') },
    ],
    [
      'a trialing subscription that is currently paused',
      { status: 'trialing', pausedAt: new Date('2026-01-01T00:00:00Z') },
    ],
  ])('rejects with the billing message for %s, before any enrollment write', async (_desc, sub) => {
    prismaMock.user.findUnique.mockResolvedValue(currentUserWithSubscription(sub));

    await expect(assignCourseToUsers(COURSE_ID, ['staff@acme.com'])).rejects.toThrow(
      'Your organization needs an active subscription to assign courses.',
    );

    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ['active and unpaused', { status: 'active', pausedAt: null }],
    ['trialing and unpaused', { status: 'trialing', pausedAt: null }],
  ])('succeeds when the subscription is %s', async (_desc, sub) => {
    prismaMock.user.findUnique.mockResolvedValue(currentUserWithSubscription(sub));

    const result = await assignCourseToUsers(COURSE_ID, ['staff@acme.com']);

    expect(prismaMock.enrollment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ userId: 'staff-1', courseId: COURSE_ID })],
        skipDuplicates: true,
      }),
    );
    expect(result).toEqual({ success: true, count: 1 });
  });
});
