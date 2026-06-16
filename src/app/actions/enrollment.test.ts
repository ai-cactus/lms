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
    user: { findUnique: vi.fn(), create: vi.fn() },
    profile: { upsert: vi.fn() },
    orgCourseOffering: { findUnique: vi.fn() },
    courseAssignment: { create: vi.fn() },
    enrollment: { findFirst: vi.fn(), create: vi.fn() },
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
}));

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('hashed-password') },
  hash: vi.fn().mockResolvedValue('hashed-password'),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

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

const adminUser = {
  id: ADMIN_ID,
  role: 'admin',
  organizationId: ORG_ID,
  organization: { id: ORG_ID, name: 'Acme Corp' },
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

    // Default: no existing enrollment (so we reach the create path).
    prismaMock.enrollment.findFirst.mockResolvedValue(null);
    prismaMock.enrollment.create.mockResolvedValue({});

    // Org-scoped enrollment now creates a CourseAssignment batch first.
    prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });
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
  // Guard intact: global course NOT offered by the admin's org → should throw.
  // -------------------------------------------------------------------------
  it('blocks enrollment into a global course not offered by the admin org', async () => {
    prismaMock.course.findUnique.mockResolvedValue(globalVideoCourse);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminUser);

    // OrgCourseOffering lookup → org has NOT offered this course
    prismaMock.orgCourseOffering.findUnique.mockResolvedValue(null);

    await expect(enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }])).rejects.toThrow(
      'Course not found',
    );

    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
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
