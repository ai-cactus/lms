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
    organization: { findUnique: vi.fn() },
    organizationUser: { findMany: vi.fn() },
    organizationUserFacility: { findMany: vi.fn() },
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
const ADMIN_ORG_USER_ID = 'ou-admin-001';
const ORG_ID = 'org-001';
const COURSE_ID = 'course-001';

// Post User/OrganizationUser split: course ownership is keyed by the
// creator's OrganizationUser id, not the raw User id.
const ownCourse = { createdByOrgUserId: ADMIN_ORG_USER_ID, title: 'My Training' };

function orgWithSubscription(subscription: unknown) {
  return { subscription };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The session carries organizationUserId/organizationId directly — no
  // separate `prisma.user` lookup enriches it post-refactor.
  mockAdminAuth.mockResolvedValue({
    user: { id: ADMIN_ID, organizationUserId: ADMIN_ORG_USER_ID, organizationId: ORG_ID },
  });
  mockWorkerAuth.mockResolvedValue(null);
  prismaMock.course.findUnique.mockResolvedValue(ownCourse);
  prismaMock.organizationUser.findMany.mockResolvedValue([
    { id: 'ou-staff-1', user: { email: 'staff@acme.com' } },
  ]);
  prismaMock.organizationUserFacility.findMany.mockResolvedValue([]);
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
    mockAdminAuth.mockResolvedValue({
      user: { id: ADMIN_ID, organizationUserId: ADMIN_ORG_USER_ID, organizationId: null },
    });

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
    prismaMock.organization.findUnique.mockResolvedValue(orgWithSubscription(sub));

    await expect(assignCourseToUsers(COURSE_ID, ['staff@acme.com'])).rejects.toThrow(
      'Your organization needs an active subscription to assign courses.',
    );

    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ['active and unpaused', { status: 'active', pausedAt: null }],
    ['trialing and unpaused', { status: 'trialing', pausedAt: null }],
  ])('succeeds when the subscription is %s', async (_desc, sub) => {
    prismaMock.organization.findUnique.mockResolvedValue(orgWithSubscription(sub));

    const result = await assignCourseToUsers(COURSE_ID, ['staff@acme.com']);

    expect(prismaMock.enrollment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ organizationUserId: 'ou-staff-1', courseId: COURSE_ID })],
        skipDuplicates: true,
      }),
    );
    expect(result).toEqual({ success: true, count: 1 });
  });
});

describe('assignCourseToUsers — facility stamping', () => {
  it("stamps each enrollment with its member's own active facility assignment", async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([
      { id: 'ou-staff-1', user: { email: 'staff1@acme.com' } },
      { id: 'ou-staff-2', user: { email: 'staff2@acme.com' } },
    ]);
    prismaMock.organizationUserFacility.findMany.mockResolvedValue([
      { organizationUserId: 'ou-staff-1', facilityId: 'fac-1' },
      { organizationUserId: 'ou-staff-2', facilityId: 'fac-2' },
    ]);

    await assignCourseToUsers(COURSE_ID, ['staff1@acme.com', 'staff2@acme.com']);

    expect(prismaMock.enrollment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ organizationUserId: 'ou-staff-1', facilityId: 'fac-1' }),
          expect.objectContaining({ organizationUserId: 'ou-staff-2', facilityId: 'fac-2' }),
        ],
      }),
    );
  });

  it('stamps facilityId: null for a member with no active facility assignment', async () => {
    prismaMock.organizationUserFacility.findMany.mockResolvedValue([]);

    await assignCourseToUsers(COURSE_ID, ['staff@acme.com']);

    expect(prismaMock.enrollment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ organizationUserId: 'ou-staff-1', facilityId: null })],
      }),
    );
  });
});
