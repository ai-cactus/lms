/**
 * Unit tests for assignCourseToUsers (src/app/actions/course.ts).
 *
 * Backs the courses-list "Assign to staff" modal. Covered here:
 *   - Defect B — billing-gated course assignment (defense in depth): refuse
 *     with the billing message BEFORE any enrollment write when the org lacks
 *     active billing, mirroring the gate enrollUsers() applies. The refusal is
 *     RETURNED, not thrown, so it survives production error redaction.
 *   - The authorization ruling: assigning requires `assignment.create` plus the
 *     course belonging to the caller's ORG — never creator-only, which locked
 *     admins/HR out of colleagues' courses (COU-004 family).
 *   - The optional completion deadline, persisted through the shared
 *     CourseAssignment upsert and stamped on each new enrollment.
 *   - Delegation to the shared enrollment machinery
 *     (`@/lib/enrollment/create`), which is what sends the launch email, raises
 *     the COURSE_ASSIGNED notification and seeds the INITIAL_LAUNCH reminder
 *     log. A bare `enrollment.createMany` here did none of the three, so an
 *     assigned course reached the learner silently and never nudged them.
 *
 * Kept in its own file (mirroring enrollment.assignment.test.ts) rather than
 * folded into course.test.ts, which mocks a narrower prisma surface
 * (course.findMany/enrollment.groupBy) for getDashboardData and doesn't wire
 * course.findUnique.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  mockAdminAuth,
  mockWorkerAuth,
  mockRevalidatePath,
  mockCreateEnrollmentForUser,
  mockCreateEnrollmentsForUsers,
} = vi.hoisted(() => {
  const prismaMock = {
    course: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    organizationUser: { findMany: vi.fn() },
    courseAssignment: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    assignmentReminderStage: { upsert: vi.fn() },
  };
  return {
    prismaMock,
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockRevalidatePath: vi.fn(),
    mockCreateEnrollmentForUser: vi.fn(),
    mockCreateEnrollmentsForUsers: vi.fn(),
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
vi.mock('@/lib/enrollment/create', () => ({
  createEnrollmentForUser: mockCreateEnrollmentForUser,
  createEnrollmentsForUsers: mockCreateEnrollmentsForUsers,
}));

import { assignCourseToUsers } from './course';

const ADMIN_ID = 'admin-001';
const ADMIN_ORG_USER_ID = 'ou-admin-001';
const ORG_ID = 'org-001';
const COURSE_ID = 'course-001';

// Assignment is gated on the caller's ORG owning the course, not on the caller
// having created it — an admin/HR must be able to assign a colleague's course.
const ownCourse = { title: 'My Training', creator: { organizationId: ORG_ID } };

function enrolled(email: string) {
  return { status: 'enrolled' as const, email, userId: `u-${email}`, enrollmentId: `e-${email}` };
}

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
  mockCreateEnrollmentForUser.mockImplementation((entry: { email: string }) =>
    Promise.resolve(enrolled(entry.email)),
  );
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

  // Exemplar changed from `supervisor` to `finance` 2026-08-25: supervisor now
  // HOLDS assignment.create (team QA 3.1 / C8). The rule under test is
  // unchanged — a role without the verb is refused before any course lookup.
  it('throws Forbidden for a role without assignment.create, before any course lookup', async () => {
    mockAdminAuth.mockResolvedValue(sessionFor({ role: 'finance' }));

    await expect(assignCourseToUsers(COURSE_ID, ['staff@acme.com'])).rejects.toThrow('Forbidden');

    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
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

    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('allows a same-org admin who did NOT create the course to assign it (COU-004)', async () => {
    mockAdminAuth.mockResolvedValue(
      sessionFor({ organizationUserId: 'ou-someone-else', role: 'admin' }),
    );

    const result = await assignCourseToUsers(COURSE_ID, ['staff@acme.com']);

    expect(result).toEqual({ success: true, count: 1, notFound: [], outOfScope: [] });
  });

  it('refuses when the caller has no organization', async () => {
    mockAdminAuth.mockResolvedValue(sessionFor({ organizationId: null }));

    const result = await assignCourseToUsers(COURSE_ID, ['staff@acme.com']);

    expect(result).toEqual({
      success: false,
      message: 'You must belong to an organization to assign courses',
      notFound: [],
      outOfScope: [],
    });
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
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
  ])('refuses with the billing message for %s, before any enrollment write', async (_desc, sub) => {
    prismaMock.organization.findUnique.mockResolvedValue(orgWithSubscription(sub));

    const result = await assignCourseToUsers(COURSE_ID, ['staff@acme.com']);

    expect(result).toEqual({
      success: false,
      message: 'Your organization needs an active subscription to assign courses.',
      notFound: [],
      outOfScope: [],
    });

    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it.each([
    ['active and unpaused', { status: 'active', pausedAt: null }],
    ['trialing and unpaused', { status: 'trialing', pausedAt: null }],
  ])('succeeds when the subscription is %s', async (_desc, sub) => {
    prismaMock.organization.findUnique.mockResolvedValue(orgWithSubscription(sub));

    const result = await assignCourseToUsers(COURSE_ID, ['staff@acme.com']);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'staff@acme.com' },
      expect.objectContaining({ courseId: COURSE_ID, organizationId: ORG_ID }),
    );
    expect(result).toEqual({ success: true, count: 1, notFound: [], outOfScope: [] });
  });
});

// ---------------------------------------------------------------------------
// Completion deadline — reuses the shared CourseAssignment persistence.
// ---------------------------------------------------------------------------

describe('assignCourseToUsers — completion deadline', () => {
  it('writes no CourseAssignment and passes no explicit deadline when no dueAt is given', async () => {
    await assignCourseToUsers(COURSE_ID, ['staff@acme.com']);

    expect(prismaMock.courseAssignment.create).not.toHaveBeenCalled();
    // A null `assignmentDueAt` leaves the deadline to the shared window rule in
    // computeDueAt, exactly as every other assign path does.
    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'staff@acme.com' },
      expect.objectContaining({ assignmentId: null, assignmentDueAt: null }),
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
    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'staff@acme.com' },
      expect.objectContaining({
        assignmentId: 'assignment-001',
        assignmentDueAt: new Date('2026-12-24'),
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

  it('refuses an unparseable deadline before any write', async () => {
    const result = await assignCourseToUsers(COURSE_ID, ['staff@acme.com'], 'not-a-date');

    expect(result).toMatchObject({
      success: false,
      message: "That completion deadline couldn't be read. Please pick the date again.",
    });

    expect(prismaMock.courseAssignment.create).not.toHaveBeenCalled();
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
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
    expect(result).toEqual({
      success: true,
      count: 1,
      notFound: ['ghost@acme.com'],
      outOfScope: [],
    });
  });

  it('returns every email as notFound when none resolve to a member', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([]);

    const result = await assignCourseToUsers(COURSE_ID, ['ghost@acme.com']);

    expect(result).toEqual({
      success: false,
      message: 'No valid users found to assign.',
      notFound: ['ghost@acme.com'],
      outOfScope: [],
    });
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Delegation to the shared enrollment machinery. Facility stamping, the
// INITIAL_LAUNCH seed and the launch email itself live in
// src/lib/enrollment/create.ts and are covered by its own suites; what this
// action owns is routing every matched member through it exactly once.
// ---------------------------------------------------------------------------

describe('assignCourseToUsers — delegation to the enrollment machinery', () => {
  it('enrolls every matched member through createEnrollmentForUser', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([
      { id: 'ou-staff-1', user: { email: 'staff1@acme.com' } },
      { id: 'ou-staff-2', user: { email: 'staff2@acme.com' } },
    ]);

    const result = await assignCourseToUsers(COURSE_ID, ['staff1@acme.com', 'staff2@acme.com']);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledTimes(2);
    expect(mockCreateEnrollmentForUser.mock.calls.map((call) => call[0])).toEqual([
      { email: 'staff1@acme.com' },
      { email: 'staff2@acme.com' },
    ]);
    expect(result).toEqual({ success: true, count: 2, notFound: [], outOfScope: [] });
  });

  it('refuses to invite: only confirmed members reach the machinery', async () => {
    await assignCourseToUsers(COURSE_ID, ['staff@acme.com']);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'staff@acme.com' },
      expect.objectContaining({ callerCanInvite: false }),
    );
  });

  it('counts only newly created enrollments — an already-enrolled member is not counted', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([
      { id: 'ou-staff-1', user: { email: 'staff1@acme.com' } },
      { id: 'ou-staff-2', user: { email: 'staff2@acme.com' } },
    ]);
    mockCreateEnrollmentForUser
      .mockResolvedValueOnce(enrolled('staff1@acme.com'))
      .mockResolvedValueOnce({ status: 'alreadyEnrolled', email: 'staff2@acme.com' });

    const result = await assignCourseToUsers(COURSE_ID, ['staff1@acme.com', 'staff2@acme.com']);

    expect(result).toEqual({ success: true, count: 1, notFound: [], outOfScope: [] });
  });

  it('uses the batched path only when the kill-switch is on', async () => {
    const previous = process.env.ENROLLMENT_BATCH_ENABLED;
    process.env.ENROLLMENT_BATCH_ENABLED = 'true';
    mockCreateEnrollmentsForUsers.mockResolvedValue([enrolled('staff@acme.com')]);

    try {
      const result = await assignCourseToUsers(COURSE_ID, ['staff@acme.com']);

      expect(mockCreateEnrollmentsForUsers).toHaveBeenCalledTimes(1);
      expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, count: 1, notFound: [], outOfScope: [] });
    } finally {
      if (previous === undefined) delete process.env.ENROLLMENT_BATCH_ENABLED;
      else process.env.ENROLLMENT_BATCH_ENABLED = previous;
    }
  });
});
