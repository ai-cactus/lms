/**
 * Unit tests for enrollUsers — specifically the course-ownership guard.
 *
 * enrollUsers previously blocked any enrollment where course.createdBy !== session.user.id.
 * After Task E2 the guard is relaxed: an org admin may also enroll staff into a
 * global course that their organization has offered (OrgCourseOffering row exists).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted runs before module resolution so these objects
// can be referenced safely inside vi.mock() factories.
// ---------------------------------------------------------------------------

const { prismaMock, mockAdminAuth, mockWorkerAuth } = vi.hoisted(() => {
  const prismaMock = {
    course: { findUnique: vi.fn() },
    // user.create is unused by the product code post fix/worker-invite (the
    // invite branch no longer creates an account) — kept as a harmless mock so
    // pre-existing "no account was created" regression assertions still hold.
    // user.count / invite.count back getSeatUsage's own usage accounting.
    user: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    profile: { upsert: vi.fn() },
    orgCourseOffering: { findUnique: vi.fn(), upsert: vi.fn() },
    courseAssignment: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    assignmentReminderStage: { upsert: vi.fn() },
    enrollment: { findFirst: vi.fn(), create: vi.fn() },
    // Added in facility split: enrollUsers looks up facilityId for new users.
    facility: { findFirst: vi.fn() },
    reminderLog: { create: vi.fn() },
    // Seat gate (F-022): enrollUsers now calls getSeatUsage(organizationId, ...)
    // unconditionally when the caller has an org — organization.findUnique
    // resolving null (default below) makes getSeatUsage return staffMax: null,
    // a no-op, so tests not focused on the seat gate need no further mocking.
    organization: { findUnique: vi.fn() },
    invite: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    inviteCourseAssignment: { upsert: vi.fn() },
  };
  const mockAdminAuth = vi.fn();
  const mockWorkerAuth = vi.fn();
  return { prismaMock, mockAdminAuth, mockWorkerAuth };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));

vi.mock('./notifications', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  notifyOrganizationAdmins: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/email', () => ({
  sendCourseInviteEmail: vi.fn().mockResolvedValue(undefined),
  sendCourseEnrollmentEmail: vi.fn().mockResolvedValue(undefined),
  // Phase 7 wires sendCourseLaunchEmail from the assign flow; the mock must
  // export it or the module-under-test throws at import time.
  sendCourseLaunchEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('hashed-password') },
  hash: vi.fn().mockResolvedValue('hashed-password'),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));

// ---------------------------------------------------------------------------
// Import the module under test AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------
import { enrollUsers } from './enrollment';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ADMIN_ID = 'admin-001';
const SYSTEM_USER_ID = 'system-user-id';
const ORG_ID = 'org-001';
const COURSE_ID = 'global-video-course-001';
const STAFF_EMAIL = 'staff@example.com';
const STAFF_USER_ID = 'staff-user-001';

const adminSession = { user: { id: ADMIN_ID } };

const globalVideoCourse = {
  id: COURSE_ID,
  title: 'Global Safety Training',
  createdBy: SYSTEM_USER_ID, // NOT the admin — created by the system user
  isGlobal: true,
  type: 'video',
  status: 'published', // active course — required by the Task 3 status guard
};

// Defect B (Phase-4 billing gate): enrollUsers now requires active, unpaused
// billing. Every fixture that reaches the billing check must carry a
// subscription that satisfies hasActiveBilling(), or the gate throws before
// the mocked `user.findUnique` queue is fully consumed — leaving a leftover
// once-value that leaks into (and pollutes) the next test.
const activeSubscription = { status: 'active', pausedAt: null };

const adminUser = {
  id: ADMIN_ID,
  // After RBAC migration: 'admin' is retired; 'owner' is the new admin-role equivalent.
  role: 'owner',
  organizationId: ORG_ID,
  organization: { id: ORG_ID, name: 'Acme Corp', subscription: activeSubscription },
};

const staffUser = {
  id: STAFF_USER_ID,
  email: STAFF_EMAIL,
  profile: { fullName: 'Jane Doe' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enrollUsers — course-ownership guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: admin auth returns a valid session; worker auth returns null.
    mockAdminAuth.mockResolvedValue(adminSession);
    mockWorkerAuth.mockResolvedValue(null);

    // Seat gate (F-022): no active subscription on this org → getSeatUsage
    // returns staffMax: null, a no-op — tests below aren't focused on it.
    prismaMock.organization.findUnique.mockResolvedValue(null);

    // Default: no existing enrollment (so we reach the create path).
    prismaMock.enrollment.findFirst.mockResolvedValue(null);
    prismaMock.enrollment.create.mockResolvedValue({});

    // Org-scoped enrollment now creates a CourseAssignment batch first.
    // No prior assignment for this (org, course) — upsertCourseAssignment takes the create branch.
    prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
    prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });
    // Role-target auto-enroll hook (fires for newly-invited users): no role-target
    // assignments in these fixtures, so it's a no-op.
    prismaMock.courseAssignment.findMany.mockResolvedValue([]);

    // Assigning a global catalog course upserts an OrgCourseOffering.
    prismaMock.orgCourseOffering.upsert.mockResolvedValue({ id: 'offering-001' });
  });

  // -------------------------------------------------------------------------
  // Happy-path: org admin enrolls staff into a GLOBAL video course offered by
  // the admin's org.  This is the core Task-E2 scenario.
  // -------------------------------------------------------------------------
  it('allows an org admin to enroll staff into a global video course their org offers', async () => {
    // Course lookup → the global video course (createdBy = system user, NOT admin)
    prismaMock.course.findUnique.mockResolvedValue(globalVideoCourse);

    // Admin user lookup and staff lookup
    prismaMock.user.findUnique
      .mockResolvedValueOnce(adminUser) // currentUser fetch
      .mockResolvedValueOnce(staffUser); // find staff by email

    // OrgCourseOffering lookup → org HAS offered this course
    prismaMock.orgCourseOffering.findUnique.mockResolvedValue({ id: 'offering-001' });

    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }]);

    // Enrollment should have been created without throwing.
    expect(prismaMock.enrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: STAFF_USER_ID,
          courseId: COURSE_ID,
          status: 'enrolled',
        }),
      }),
    );

    // The function should report the email as a success.
    expect(result.success).toContain(STAFF_EMAIL);
    expect(result.failed).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Catalog assignment: a global PUBLISHED course the org has not offered yet
  // is assignable straight from the catalog — enrollUsers creates the offering
  // as part of the assignment, then enrolls.
  // -------------------------------------------------------------------------
  it('offers and enrolls into a global published course the org has not offered yet', async () => {
    prismaMock.course.findUnique.mockResolvedValue(globalVideoCourse);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminUser).mockResolvedValueOnce(staffUser);

    // OrgCourseOffering lookup → org has NOT offered this course yet
    prismaMock.orgCourseOffering.findUnique.mockResolvedValue(null);

    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }]);

    // The org now has an offering for the catalog course...
    expect(prismaMock.orgCourseOffering.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_courseId: { organizationId: ORG_ID, courseId: COURSE_ID } },
        create: expect.objectContaining({
          organizationId: ORG_ID,
          courseId: COURSE_ID,
          addedByAdminId: ADMIN_ID,
        }),
      }),
    );
    // ...and the staff member is enrolled.
    expect(prismaMock.enrollment.create).toHaveBeenCalled();
    expect(result.success).toContain(STAFF_EMAIL);
  });

  // -------------------------------------------------------------------------
  // Existing behaviour preserved: admin can still enroll into their OWN course
  // (non-global, createdBy = admin).
  // -------------------------------------------------------------------------
  it('allows an admin to enroll staff into a course they created (original behaviour)', async () => {
    const ownCourse = {
      id: 'own-course-001',
      title: 'My Training',
      createdBy: ADMIN_ID, // admin IS the creator
      isGlobal: false,
      type: 'document',
    };

    prismaMock.course.findUnique.mockResolvedValue(ownCourse);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminUser).mockResolvedValueOnce(staffUser);
    prismaMock.enrollment.findFirst.mockResolvedValue(null);

    const result = await enrollUsers('own-course-001', [{ email: STAFF_EMAIL }]);

    expect(prismaMock.enrollment.create).toHaveBeenCalled();
    expect(result.success).toContain(STAFF_EMAIL);

    // OrgCourseOffering should NOT have been queried — the isOwnCourse path
    // short-circuits before we reach the offering check.
    expect(prismaMock.orgCourseOffering.findUnique).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Guard intact: completely unknown / nonexistent course.
  // -------------------------------------------------------------------------
  it('throws when the course does not exist', async () => {
    prismaMock.course.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminUser);

    await expect(enrollUsers('nonexistent-id', [{ email: STAFF_EMAIL }])).rejects.toThrow(
      'Course not found',
    );
  });

  // -------------------------------------------------------------------------
  // Unauthenticated caller → Unauthorized.
  // -------------------------------------------------------------------------
  it('throws Unauthorized when no session is present', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }])).rejects.toThrow('Unauthorized');
  });

  // -------------------------------------------------------------------------
  // Task 3 regression: inactive (soft-deleted) global course must be blocked
  // even when the org still has a valid OrgCourseOffering row.
  // -------------------------------------------------------------------------
  it('blocks enrollment into an inactive global course even when the org has an offering', async () => {
    const inactiveGlobalCourse = {
      ...globalVideoCourse,
      status: 'inactive', // soft-deleted / deactivated
    };

    prismaMock.course.findUnique.mockResolvedValue(inactiveGlobalCourse);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminUser);

    // OrgCourseOffering row EXISTS — the org was offered this course before
    // it was deactivated. The guard must still reject new enrollments.
    prismaMock.orgCourseOffering.findUnique.mockResolvedValue({ id: 'offering-001' });

    await expect(enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }])).rejects.toThrow(
      'Course not found',
    );

    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Confirm the complement: a published global course with an offering is
  // still allowed (regression guard for the happy path).
  // -------------------------------------------------------------------------
  it('allows enrollment into a published global course when the org has an offering', async () => {
    const publishedGlobalCourse = {
      ...globalVideoCourse,
      status: 'published',
    };

    prismaMock.course.findUnique.mockResolvedValue(publishedGlobalCourse);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminUser).mockResolvedValueOnce(staffUser);
    prismaMock.orgCourseOffering.findUnique.mockResolvedValue({ id: 'offering-001' });

    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }]);

    expect(prismaMock.enrollment.create).toHaveBeenCalled();
    expect(result.success).toContain(STAFF_EMAIL);
  });

  // -------------------------------------------------------------------------
  // Non-admin (worker) caller → Forbidden, even with a valid session.
  // -------------------------------------------------------------------------
  it('throws Forbidden when the caller is not an admin', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      id: 'own-course-001',
      title: 'My Training',
      createdBy: ADMIN_ID,
      isGlobal: false,
      type: 'document',
    });
    // currentUser fetch resolves a worker-role user
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: ADMIN_ID,
      role: 'worker',
      organizationId: ORG_ID,
      organization: { id: ORG_ID, name: 'Acme Corp' },
    });

    await expect(enrollUsers('own-course-001', [{ email: STAFF_EMAIL }])).rejects.toThrow(
      'Forbidden',
    );
    // No enrollment work should have happened.
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CSV bulk-import role mapping — StaffEntry.role is the coarse legacy
// 'admin' | 'worker' token from the CSV column; enrollUsers maps 'admin' to
// the RBAC successor `supervisor` for newly-created users (see the comment
// at src/app/actions/enrollment.ts ~L235-238). A regression here (e.g. the
// mapping silently reverting to writing the literal 'admin' DB role) would
// create users with a role value that no longer exists in the DB enum.
// ---------------------------------------------------------------------------

describe('enrollUsers — CSV role mapping (entry.role "admin" → DB role "supervisor")', () => {
  const ownCourse = {
    id: 'own-course-001',
    title: 'My Training',
    createdBy: ADMIN_ID,
    isGlobal: false,
    type: 'document',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminAuth.mockResolvedValue(adminSession);
    mockWorkerAuth.mockResolvedValue(null);
    prismaMock.organization.findUnique.mockResolvedValue(null);
    prismaMock.course.findUnique.mockResolvedValue(ownCourse);
    prismaMock.enrollment.findFirst.mockResolvedValue(null);
    prismaMock.enrollment.create.mockResolvedValue({});
    // No prior assignment for this (org, course) — upsertCourseAssignment takes the create branch.
    prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
    prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });
    // Role-target auto-enroll hook (fires for newly-invited users): no role-target
    // assignments in these fixtures, so it's a no-op.
    prismaMock.courseAssignment.findMany.mockResolvedValue([]);
    prismaMock.facility.findFirst.mockResolvedValue(null);
    // fix/worker-invite: an unknown email is now invited (not account-created).
    prismaMock.invite.findFirst.mockResolvedValue(null);
    prismaMock.inviteCourseAssignment.upsert.mockResolvedValue({});
  });

  it('maps CSV role "admin" to the invite role "supervisor" for an unknown email', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(adminUser) // currentUser fetch
      .mockResolvedValueOnce(null); // no existing user with this email → invite path
    prismaMock.invite.create.mockResolvedValue({
      id: 'invite-1',
      token: 'tok-1',
      email: 'newadmin@example.com',
    });

    const result = await enrollUsers('own-course-001', [
      { email: 'newadmin@example.com', firstName: 'New', lastName: 'Admin', role: 'admin' },
    ]);

    expect(prismaMock.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'supervisor' }) }),
    );
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(result.newInvited).toContain('newadmin@example.com');
  });

  it('maps CSV role "worker" to the invite role "front_desk_admin" (DEFAULT_SELF_SERVE_WORKER_ROLE) for an unknown email', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(adminUser).mockResolvedValueOnce(null);
    prismaMock.invite.create.mockResolvedValue({
      id: 'invite-2',
      token: 'tok-2',
      email: 'newworker@example.com',
    });

    await enrollUsers('own-course-001', [{ email: 'newworker@example.com', role: 'worker' }]);

    expect(prismaMock.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'front_desk_admin' }) }),
    );
  });

  it('defaults the invite role to "front_desk_admin" (DEFAULT_SELF_SERVE_WORKER_ROLE) when the CSV role column is omitted', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(adminUser).mockResolvedValueOnce(null);
    prismaMock.invite.create.mockResolvedValue({
      id: 'invite-3',
      token: 'tok-3',
      email: 'norole@example.com',
    });

    await enrollUsers('own-course-001', [{ email: 'norole@example.com' }]);

    expect(prismaMock.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'front_desk_admin' }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// fix/worker-invite: unified invite flow — an unknown/org-less email is
// invited (not account-created), and the batch is gated by the org's plan
// seat limit (only genuinely NEW emails cost a seat).
// ---------------------------------------------------------------------------

describe('enrollUsers — unified invite flow (fix/worker-invite)', () => {
  const ownCourse = {
    id: 'own-course-001',
    title: 'My Training',
    createdBy: ADMIN_ID,
    isGlobal: false,
    type: 'document',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminAuth.mockResolvedValue(adminSession);
    mockWorkerAuth.mockResolvedValue(null);
    prismaMock.course.findUnique.mockResolvedValue(ownCourse);
    prismaMock.enrollment.findFirst.mockResolvedValue(null);
    prismaMock.enrollment.create.mockResolvedValue({});
    prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
    prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });
    prismaMock.courseAssignment.findMany.mockResolvedValue([]);
    prismaMock.facility.findFirst.mockResolvedValue(null);
    prismaMock.invite.findFirst.mockResolvedValue(null);
    prismaMock.invite.create.mockResolvedValue({
      id: 'invite-x',
      token: 'tok-x',
      email: 'new@example.com',
    });
    prismaMock.inviteCourseAssignment.upsert.mockResolvedValue({});
    prismaMock.invite.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([]);
  });

  it('maps an "invited" outcome into the newInvited result bucket, unchanged UI contract', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null); // no seat limit to enforce
    prismaMock.user.findUnique.mockResolvedValueOnce(adminUser).mockResolvedValueOnce(null);

    const result = await enrollUsers('own-course-001', [{ email: 'new@example.com' }]);

    expect(result.newInvited).toEqual(['new@example.com']);
    expect(result.success).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it('rejects overflow emails into failed once the plan seat limit is reached, without creating an invite for them', async () => {
    // Active subscription on a staffMax: 10 plan, already at capacity.
    prismaMock.organization.findUnique.mockResolvedValue({
      subscription: { plan: 'starter', status: 'active' },
    });
    prismaMock.user.count.mockResolvedValue(10); // 10 active workers already
    prismaMock.invite.count.mockResolvedValue(0);
    // Only ONE queued value: the seat-rejected entry never reaches
    // createEnrollmentForUser's own user.findUnique lookup (it `continue`s
    // straight to `failed` before that call) — queuing a second value here
    // would leak into the NEXT test (vi.clearAllMocks() does not clear a
    // mockResolvedValueOnce queue, only mockReset()/resetAllMocks() does).
    prismaMock.user.findUnique.mockResolvedValueOnce(adminUser);

    const result = await enrollUsers('own-course-001', [{ email: 'overflow@example.com' }]);

    expect(result.failed).toContain('overflow@example.com');
    expect(result.newInvited).toHaveLength(0);
    expect(prismaMock.invite.create).not.toHaveBeenCalled();
  });

  it('does not consume a seat for an email that already belongs to an existing org member', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      subscription: { plan: 'starter', status: 'active' },
    });
    prismaMock.user.count.mockResolvedValue(9); // 1 seat remaining
    prismaMock.invite.count.mockResolvedValue(0);
    // Seat-gate's own dedup query: this email already belongs to a member.
    prismaMock.user.findMany.mockResolvedValue([{ email: 'existing-member@example.com' }]);
    prismaMock.user.findUnique
      .mockResolvedValueOnce(adminUser) // currentUser fetch
      .mockResolvedValueOnce({
        id: 'member-1',
        email: 'existing-member@example.com',
        organizationId: ORG_ID,
        profile: null,
      }); // createEnrollmentForUser's own lookup

    const result = await enrollUsers('own-course-001', [{ email: 'existing-member@example.com' }]);

    // Not rejected as an overflow — the seat-gate treats it as "known".
    expect(result.failed).not.toContain('existing-member@example.com');
    expect(result.success).toContain('existing-member@example.com');
  });

  it('does not consume a seat for an email with an already-pending invite', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      subscription: { plan: 'starter', status: 'active' },
    });
    prismaMock.user.count.mockResolvedValue(10); // no room for a NEW seat
    prismaMock.invite.count.mockResolvedValue(0);
    // Seat-gate's own dedup query: this email already has a pending invite.
    prismaMock.invite.findMany.mockResolvedValue([{ email: 'already-pending@example.com' }]);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminUser).mockResolvedValueOnce(null);
    prismaMock.invite.create.mockResolvedValue({
      id: 'invite-y',
      token: 'tok-y',
      email: 'already-pending@example.com',
    });

    const result = await enrollUsers('own-course-001', [{ email: 'already-pending@example.com' }]);

    expect(result.failed).not.toContain('already-pending@example.com');
    expect(result.newInvited).toContain('already-pending@example.com');
  });
});

// ---------------------------------------------------------------------------
// Defect B — billing-gated course assignment (defense in depth).
//
// enrollUsers must reject with the billing message BEFORE any enrollment
// write when the caller's org lacks active billing, and must otherwise
// proceed exactly as before. The gate sits after the auth/course-existence
// checks (course.findUnique) but before the CourseAssignment/enrollment
// writes — see src/app/actions/enrollment.ts ~L158-168.
// ---------------------------------------------------------------------------

describe('enrollUsers — billing gate (Defect B)', () => {
  const ownCourse = {
    id: 'own-course-001',
    title: 'My Training',
    createdBy: ADMIN_ID,
    isGlobal: false,
    type: 'document',
  };

  function adminWithSubscription(subscription: unknown) {
    return {
      ...adminUser,
      organization: { id: ORG_ID, name: 'Acme Corp', subscription },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminAuth.mockResolvedValue(adminSession);
    mockWorkerAuth.mockResolvedValue(null);
    prismaMock.organization.findUnique.mockResolvedValue(null);
    prismaMock.course.findUnique.mockResolvedValue(ownCourse);
    prismaMock.enrollment.findFirst.mockResolvedValue(null);
    prismaMock.enrollment.create.mockResolvedValue({});
    // No prior assignment for this (org, course) — upsertCourseAssignment takes the create branch.
    prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
    prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });
    // Role-target auto-enroll hook (fires for newly-invited users): no role-target
    // assignments in these fixtures, so it's a no-op.
    prismaMock.courseAssignment.findMany.mockResolvedValue([]);
  });

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
    prismaMock.user.findUnique.mockResolvedValueOnce(adminWithSubscription(sub));

    await expect(enrollUsers('own-course-001', [{ email: STAFF_EMAIL }])).rejects.toThrow(
      'Your organization needs an active subscription to assign courses.',
    );

    expect(prismaMock.courseAssignment.create).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });

  it.each([
    ['active and unpaused', { status: 'active', pausedAt: null }],
    ['trialing and unpaused', { status: 'trialing', pausedAt: null }],
  ])('succeeds when the subscription is %s', async (_desc, sub) => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(adminWithSubscription(sub))
      .mockResolvedValueOnce(staffUser);

    const result = await enrollUsers('own-course-001', [{ email: STAFF_EMAIL }]);

    expect(prismaMock.enrollment.create).toHaveBeenCalled();
    expect(result.success).toContain(STAFF_EMAIL);
  });
});
