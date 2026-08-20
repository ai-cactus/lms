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
    // Post User/OrganizationUser split: the session carries the caller's own
    // role/org context directly (no "current user" DB fetch). `user.findUnique`
    // below is ONLY the staff-email lookup inside createEnrollmentForUser
    // (@/lib/enrollment/create). `user.create` is unused by the product code
    // post fix/worker-invite (the invite branch no longer creates an account) —
    // kept as a harmless mock so "no account was created" assertions still hold.
    user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    // Per-(user,org) membership — backs both the staff-email membership check
    // inside createEnrollmentForUser (findFirst) and enrollUsers' own seat-gate
    // existing-member dedup and role-holder queries (findMany/count).
    organizationUser: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    orgCourseOffering: { findUnique: vi.fn(), upsert: vi.fn() },
    courseAssignment: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    assignmentReminderStage: { upsert: vi.fn() },
    enrollment: { findFirst: vi.fn(), create: vi.fn() },
    // Added in facility split: enrollUsers looks up facilityId for new users.
    facility: { findFirst: vi.fn() },
    // Facility stamped on each created enrollment (resolveMemberFacilityId).
    organizationUserFacility: { findFirst: vi.fn().mockResolvedValue(null) },
    reminderLog: { create: vi.fn() },
    // Seat gate (F-022) + the outer billing gate both read from
    // organization.findUnique now (no more nested `currentUser.organization`).
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
const ADMIN_ORG_USER_ID = 'ou-admin-001';
const SYSTEM_ORG_USER_ID = 'ou-system-001';
const ORG_ID = 'org-001';
const COURSE_ID = 'global-video-course-001';
const STAFF_EMAIL = 'staff@example.com';
const STAFF_USER_ID = 'staff-user-001';
const STAFF_ORG_USER_ID = 'ou-staff-001';

// Post User/OrganizationUser split: the session itself carries the active
// membership id, org id and role directly — there is no separate `prisma.user`
// "current user" fetch. 'owner' is the admin-role-equivalent after the RBAC
// ruling bundled with this refactor.
const adminSession = {
  user: {
    id: ADMIN_ID,
    organizationUserId: ADMIN_ORG_USER_ID,
    organizationId: ORG_ID,
    role: 'owner',
  },
};

const globalVideoCourse = {
  id: COURSE_ID,
  title: 'Global Safety Training',
  createdByOrgUserId: SYSTEM_ORG_USER_ID, // NOT the admin — created by the system user
  isGlobal: true,
  type: 'video',
  status: 'published', // active course — required by the Task 3 status guard
};

// Defect B (Phase-4 billing gate): enrollUsers now requires active, unpaused
// billing. Every fixture that reaches the billing check must carry a
// subscription that satisfies hasActiveBilling(), or the gate throws before
// the mocked enrollment work is reached — leaving a leftover once-value that
// leaks into (and pollutes) the next test.
const activeSubscription = { status: 'active', pausedAt: null };

// No `plan` field — getSeatUsage's BILLING_PLANS lookup misses, so the seat
// gate resolves staffMax: null (a no-op). Tests focused on the seat gate
// itself supply their own `subscription.plan`.
const orgWithActiveBilling = { name: 'Acme Corp', subscription: activeSubscription };

const staffUser = {
  id: STAFF_USER_ID,
  firstName: null,
  lastName: null,
  fullName: 'Jane Doe',
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

    // Billing gate: active, unpaused subscription. No `plan` field -> the
    // seat gate (getSeatUsage) is a no-op, matching these tests' focus.
    prismaMock.organization.findUnique.mockResolvedValue(orgWithActiveBilling);

    // Default: no existing enrollment (so we reach the create path), and the
    // staff email resolves to an existing, active org member.
    prismaMock.enrollment.findFirst.mockResolvedValue(null);
    prismaMock.enrollment.create.mockResolvedValue({});
    prismaMock.user.findUnique.mockResolvedValue(staffUser);
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: STAFF_ORG_USER_ID });

    // Org-scoped enrollment now creates a CourseAssignment batch first.
    // No prior assignment for this (org, course) — upsertCourseAssignment takes the create branch.
    prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
    prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });

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

    // OrgCourseOffering lookup → org HAS offered this course
    prismaMock.orgCourseOffering.findUnique.mockResolvedValue({ id: 'offering-001' });

    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }]);

    // Enrollment should have been created without throwing, keyed by the
    // staff member's OrganizationUser id (not the raw User id).
    expect(prismaMock.enrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationUserId: STAFF_ORG_USER_ID,
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
  // (non-global, createdByOrgUserId = admin's membership).
  // -------------------------------------------------------------------------
  it('allows an admin to enroll staff into a course they created (original behaviour)', async () => {
    const ownCourse = {
      id: 'own-course-001',
      title: 'My Training',
      createdByOrgUserId: ADMIN_ORG_USER_ID, // admin IS the creator
      isGlobal: false,
      type: 'document',
    };

    prismaMock.course.findUnique.mockResolvedValue(ownCourse);
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
    prismaMock.orgCourseOffering.findUnique.mockResolvedValue({ id: 'offering-001' });

    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }]);

    expect(prismaMock.enrollment.create).toHaveBeenCalled();
    expect(result.success).toContain(STAFF_EMAIL);
  });

  // -------------------------------------------------------------------------
  // Non-admin (worker) caller → Forbidden, even with a valid session. The
  // isAdminRole gate runs immediately after session resolution — before any
  // course/prisma lookup — so no DB call happens at all.
  // -------------------------------------------------------------------------
  it('throws Forbidden when the caller is not an admin', async () => {
    mockAdminAuth.mockResolvedValue({
      user: {
        id: ADMIN_ID,
        organizationUserId: ADMIN_ORG_USER_ID,
        organizationId: ORG_ID,
        role: 'nurse', // a worker role — not in ADMIN_ROLES
      },
    });

    await expect(enrollUsers('own-course-001', [{ email: STAFF_EMAIL }])).rejects.toThrow(
      'Forbidden',
    );
    // No enrollment work should have happened.
    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CSV bulk-import role mapping — StaffEntry.role is the coarse legacy
// 'admin' | 'worker' token from the CSV column; enrollUsers maps 'admin' to
// the RBAC successor `supervisor` for newly-invited users (see the comment
// at src/lib/enrollment/create.ts's inviteRole derivation). A regression here
// (e.g. the mapping silently reverting to writing the literal 'admin' DB
// role) would create an invite with a role value that no longer exists in
// the DB enum.
// ---------------------------------------------------------------------------

describe('enrollUsers — CSV role mapping (entry.role "admin" → DB role "supervisor")', () => {
  const ownCourse = {
    id: 'own-course-001',
    title: 'My Training',
    createdByOrgUserId: ADMIN_ORG_USER_ID,
    isGlobal: false,
    type: 'document',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminAuth.mockResolvedValue(adminSession);
    mockWorkerAuth.mockResolvedValue(null);
    prismaMock.organization.findUnique.mockResolvedValue(orgWithActiveBilling);
    prismaMock.course.findUnique.mockResolvedValue(ownCourse);
    prismaMock.enrollment.findFirst.mockResolvedValue(null);
    prismaMock.enrollment.create.mockResolvedValue({});
    // No prior assignment for this (org, course) — upsertCourseAssignment takes the create branch.
    prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
    prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });
    // Every invite must name a facility — the org has one.
    prismaMock.facility.findFirst.mockResolvedValue({ id: 'facility-001' });
    // fix/worker-invite: an unknown email is now invited (not account-created).
    prismaMock.invite.findFirst.mockResolvedValue(null);
    prismaMock.inviteCourseAssignment.upsert.mockResolvedValue({});
  });

  it('maps CSV role "admin" to the invite role "supervisor" for an unknown email', async () => {
    // No existing user with this email → invite path.
    prismaMock.user.findUnique.mockResolvedValue(null);
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
    prismaMock.user.findUnique.mockResolvedValue(null);
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
    prismaMock.user.findUnique.mockResolvedValue(null);
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
    createdByOrgUserId: ADMIN_ORG_USER_ID,
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
    // Every invite must name a facility — the org has one.
    prismaMock.facility.findFirst.mockResolvedValue({ id: 'facility-001' });
    prismaMock.invite.findFirst.mockResolvedValue(null);
    prismaMock.invite.create.mockResolvedValue({
      id: 'invite-x',
      token: 'tok-x',
      email: 'new@example.com',
    });
    prismaMock.inviteCourseAssignment.upsert.mockResolvedValue({});
    prismaMock.invite.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
  });

  it('maps an "invited" outcome into the newInvited result bucket, unchanged UI contract', async () => {
    // Active billing, but no `plan` field -> no seat limit to enforce.
    prismaMock.organization.findUnique.mockResolvedValue(orgWithActiveBilling);
    prismaMock.user.findUnique.mockResolvedValue(null);

    const result = await enrollUsers('own-course-001', [{ email: 'new@example.com' }]);

    expect(result.newInvited).toEqual(['new@example.com']);
    expect(result.success).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it('rejects overflow emails into failed once the plan seat limit is reached, without creating an invite for them', async () => {
    // Active subscription on a staffMax: 10 plan, already at capacity.
    prismaMock.organization.findUnique.mockResolvedValue({
      name: 'Acme Corp',
      subscription: { plan: 'starter', status: 'active', pausedAt: null },
    });
    prismaMock.organizationUser.count.mockResolvedValue(10); // 10 active workers already
    prismaMock.invite.count.mockResolvedValue(0);
    // The seat-rejected entry never reaches createEnrollmentForUser's own
    // user.findUnique lookup (it `continue`s straight to `failed` before that
    // call) — so no user.findUnique mocking is needed for it.

    const result = await enrollUsers('own-course-001', [{ email: 'overflow@example.com' }]);

    expect(result.failed).toContain('overflow@example.com');
    expect(result.newInvited).toHaveLength(0);
    expect(prismaMock.invite.create).not.toHaveBeenCalled();
  });

  it('does not consume a seat for an email that already belongs to an existing org member', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      name: 'Acme Corp',
      subscription: { plan: 'starter', status: 'active', pausedAt: null },
    });
    prismaMock.organizationUser.count.mockResolvedValue(9); // 1 seat remaining
    prismaMock.invite.count.mockResolvedValue(0);
    // Seat-gate's own dedup query: this email already belongs to a member.
    prismaMock.organizationUser.findMany.mockResolvedValue([
      { user: { email: 'existing-member@example.com' } },
    ]);
    // createEnrollmentForUser's own lookup: existing user + active membership.
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: null,
      lastName: null,
      fullName: null,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-member-1' });

    const result = await enrollUsers('own-course-001', [{ email: 'existing-member@example.com' }]);

    // Not rejected as an overflow — the seat-gate treats it as "known".
    expect(result.failed).not.toContain('existing-member@example.com');
    expect(result.success).toContain('existing-member@example.com');
  });

  it('does not consume a seat for an email with an already-pending invite', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      name: 'Acme Corp',
      subscription: { plan: 'starter', status: 'active', pausedAt: null },
    });
    prismaMock.organizationUser.count.mockResolvedValue(10); // no room for a NEW seat
    prismaMock.invite.count.mockResolvedValue(0);
    // Seat-gate's own dedup query: this email already has a pending invite.
    prismaMock.invite.findMany.mockResolvedValue([{ email: 'already-pending@example.com' }]);
    prismaMock.user.findUnique.mockResolvedValue(null);
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
// writes — see src/app/actions/enrollment.ts ~L261-271.
// ---------------------------------------------------------------------------

describe('enrollUsers — billing gate (Defect B)', () => {
  const ownCourse = {
    id: 'own-course-001',
    title: 'My Training',
    createdByOrgUserId: ADMIN_ORG_USER_ID,
    isGlobal: false,
    type: 'document',
  };

  function orgWithSubscription(subscription: unknown) {
    return { name: 'Acme Corp', subscription };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminAuth.mockResolvedValue(adminSession);
    mockWorkerAuth.mockResolvedValue(null);
    prismaMock.course.findUnique.mockResolvedValue(ownCourse);
    prismaMock.enrollment.findFirst.mockResolvedValue(null);
    prismaMock.enrollment.create.mockResolvedValue({});
    // No prior assignment for this (org, course) — upsertCourseAssignment takes the create branch.
    prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
    prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });
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
    prismaMock.organization.findUnique.mockResolvedValue(orgWithSubscription(sub));

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
    prismaMock.organization.findUnique.mockResolvedValue(orgWithSubscription(sub));
    prismaMock.user.findUnique.mockResolvedValue(staffUser);
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: STAFF_ORG_USER_ID });

    const result = await enrollUsers('own-course-001', [{ email: STAFF_EMAIL }]);

    expect(prismaMock.enrollment.create).toHaveBeenCalled();
    expect(result.success).toContain(STAFF_EMAIL);
  });
});
