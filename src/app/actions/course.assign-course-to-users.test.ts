/**
 * Unit tests for assignCourseToUsers (src/app/actions/course.ts).
 *
 * Backs the courses-list "Assign to staff" modal. Covered here:
 *   - Defect B — billing-gated course assignment (defense in depth): reject
 *     with the billing message BEFORE any enrollment write when the org lacks
 *     active billing, mirroring the gate enrollUsers() applies.
 *   - The authorization ruling: assigning requires `assignment.create` plus the
 *     course belonging to the caller's ORG — never creator-only, which locked
 *     admins/HR out of colleagues' courses (COU-004 family).
 *   - The optional completion deadline, persisted through the shared
 *     CourseAssignment upsert and stamped on each new enrollment.
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
    courseAssignment: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    assignmentReminderStage: { upsert: vi.fn() },
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

// Assignment is gated on the caller's ORG owning the course, not on the caller
// having created it — an admin/HR must be able to assign a colleague's course.
const ownCourse = { title: 'My Training', creator: { organizationId: ORG_ID } };

function orgWithSubscription(subscription: unknown) {
  return { subscription };
}

function sessionFor(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: ADMIN_ID,
      organizationUserId: ADMIN_ORG_USER_ID,
      organizationId: ORG_ID,
      role: 'owner',
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The session carries organizationUserId/organizationId directly — no
  // separate `prisma.user` lookup enriches it post-refactor.
  mockAdminAuth.mockResolvedValue(sessionFor());
  mockWorkerAuth.mockResolvedValue(null);
  prismaMock.course.findUnique.mockResolvedValue(ownCourse);
  prismaMock.organizationUser.findMany.mockResolvedValue([
    { id: 'ou-staff-1', user: { email: 'staff@acme.com' } },
  ]);
  prismaMock.organizationUserFacility.findMany.mockResolvedValue([]);
  prismaMock.enrollment.createMany.mockResolvedValue({ count: 1 });
  prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
  prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });
  prismaMock.organization.findUnique.mockResolvedValue(
    orgWithSubscription({ status: 'active', pausedAt: null }),
  );
});

describe('assignCourseToUsers — auth / tenancy guards', () => {
  it('throws Unauthorized when there is no session', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(assignCourseToUsers(COURSE_ID, ['staff@acme.com'])).rejects.toThrow(
      'Unauthorized',
    );
  });

  it('throws Forbidden for a role without assignment.create, before any course lookup', async () => {
    mockAdminAuth.mockResolvedValue(sessionFor({ role: 'supervisor' }));

    await expect(assignCourseToUsers(COURSE_ID, ['staff@acme.com'])).rejects.toThrow('Forbidden');

    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.createMany).not.toHaveBeenCalled();
  });

  it('throws when the course does not exist', async () => {
    prismaMock.course.findUnique.mockResolvedValue(null);

    await expect(assignCourseToUsers(COURSE_ID, ['staff@acme.com'])).rejects.toThrow(
      'Course not found or unauthorized',
    );
  });

  it('throws when the course belongs to another organization', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      title: 'Their Training',
      creator: { organizationId: 'org-other' },
    });

    await expect(assignCourseToUsers(COURSE_ID, ['staff@acme.com'])).rejects.toThrow(
      'Course not found or unauthorized',
    );

    expect(prismaMock.enrollment.createMany).not.toHaveBeenCalled();
  });

  it('allows a same-org admin who did NOT create the course to assign it (COU-004)', async () => {
    mockAdminAuth.mockResolvedValue(
      sessionFor({ organizationUserId: 'ou-someone-else', role: 'admin' }),
    );

    const result = await assignCourseToUsers(COURSE_ID, ['staff@acme.com']);

    expect(result).toEqual({ success: true, count: 1, notFound: [] });
  });

  it('throws when the caller has no organization', async () => {
    mockAdminAuth.mockResolvedValue(sessionFor({ organizationId: null }));

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
    expect(result).toEqual({ success: true, count: 1, notFound: [] });
  });
});

// ---------------------------------------------------------------------------
// Completion deadline — reuses the shared CourseAssignment persistence.
// ---------------------------------------------------------------------------

describe('assignCourseToUsers — completion deadline', () => {
  it('writes no CourseAssignment and leaves enrollments deadline-free when no dueAt is passed', async () => {
    await assignCourseToUsers(COURSE_ID, ['staff@acme.com']);

    expect(prismaMock.courseAssignment.create).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ assignmentId: null, dueAt: null })],
      }),
    );
  });

  it('creates a CourseAssignment carrying the deadline and stamps it on each enrollment', async () => {
    await assignCourseToUsers(COURSE_ID, ['staff@acme.com'], '2026-12-24');

    expect(prismaMock.courseAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          courseId: COURSE_ID,
          assignedByAdminId: ADMIN_ID,
          dueAt: new Date('2026-12-24'),
          scheduleAt: null,
        }),
      }),
    );
    expect(prismaMock.enrollment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            assignmentId: 'assignment-001',
            dueAt: new Date('2026-12-24'),
          }),
        ],
      }),
    );
  });

  it('reuses the org’s existing CourseAssignment row rather than creating a second one', async () => {
    prismaMock.courseAssignment.findFirst.mockResolvedValue({ id: 'assignment-existing' });

    await assignCourseToUsers(COURSE_ID, ['staff@acme.com'], new Date('2027-01-15'));

    expect(prismaMock.courseAssignment.create).not.toHaveBeenCalled();
    expect(prismaMock.courseAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'assignment-existing' },
        data: expect.objectContaining({ dueAt: new Date('2027-01-15') }),
      }),
    );
    // An individual assignment must never clear a course's role targeting.
    expect(prismaMock.courseAssignment.update.mock.calls[0][0].data).not.toHaveProperty(
      'targetRole',
    );
  });

  it('rejects an unparseable deadline before any write', async () => {
    await expect(assignCourseToUsers(COURSE_ID, ['staff@acme.com'], 'not-a-date')).rejects.toThrow(
      'Invalid completion deadline',
    );

    expect(prismaMock.courseAssignment.create).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.createMany).not.toHaveBeenCalled();
  });
});

describe('assignCourseToUsers — unmatched emails', () => {
  it('normalises case/whitespace and reports emails with no active membership', async () => {
    const result = await assignCourseToUsers(COURSE_ID, [
      '  Staff@Acme.com ',
      'ghost@acme.com',
      'staff@acme.com',
    ]);

    expect(prismaMock.organizationUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: { email: { in: ['staff@acme.com', 'ghost@acme.com'] } },
        }),
      }),
    );
    expect(result).toEqual({ success: true, count: 1, notFound: ['ghost@acme.com'] });
  });

  it('returns every email as notFound when none resolve to a member', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([]);

    const result = await assignCourseToUsers(COURSE_ID, ['ghost@acme.com']);

    expect(result).toEqual({
      success: false,
      message: 'No valid users found to assign.',
      notFound: ['ghost@acme.com'],
    });
    expect(prismaMock.enrollment.createMany).not.toHaveBeenCalled();
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
