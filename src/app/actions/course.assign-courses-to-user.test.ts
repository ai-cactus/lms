/**
 * Unit tests for assignCoursesToUser (src/app/actions/course.ts), which assigns
 * MANY courses to ONE member.
 *
 * DEPRECATED PATH: the staff-profile "Assign Course" flow now calls
 * `assignCoursesToStaffMember` (src/app/actions/staff.ts) so the whole batch is
 * announced in ONE email — see staff.assign-courses.test.ts. These tests are
 * retained while the action still exists.
 *
 * The action is an authorization + tenancy shell that fans out to
 * `assignCourseToUsers`, so the assertions here are about that shell: the
 * `assignment.create` gate, the same-org check on the target membership, and the
 * counting rule — `assigned` counts only enrollments this call newly created,
 * with an already-held course reported as `alreadyAssigned`.
 *
 * The prisma surface mirrors course.assign-course-to-users.test.ts because the
 * fan-out target runs for real here rather than being mocked: that is the point
 * of the test — this path must inherit the SAME org-ownership ruling (COU-004)
 * the courses-list assign modal uses. Only the enrollment machinery underneath
 * (`@/lib/enrollment/create`) is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  mockAdminAuth,
  mockWorkerAuth,
  mockRevalidatePath,
  mockCreateEnrollmentForUser,
  mockCreateEnrollmentsForUsers,
} = vi.hoisted(() => ({
  prismaMock: {
    course: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    organizationUser: { findUnique: vi.fn(), findMany: vi.fn() },
    courseAssignment: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    assignmentReminderStage: { upsert: vi.fn() },
  },
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockCreateEnrollmentForUser: vi.fn(),
  mockCreateEnrollmentsForUsers: vi.fn(),
}));

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

import { assignCoursesToUser } from './course';

const ADMIN_ID = 'admin-001';
const ORG_ID = 'org-001';
const STAFF_ORG_USER_ID = 'ou-staff-001';
const STAFF_EMAIL = 'staff@acme.com';

/** Created by a COLLEAGUE, not the caller — the COU-004 shape. */
const colleagueCourse = { title: 'HIPAA Privacy', creator: { organizationId: ORG_ID } };

function sessionFor(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: ADMIN_ID,
      organizationUserId: 'ou-admin-001',
      organizationId: ORG_ID,
      role: 'owner',
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(sessionFor());
  mockWorkerAuth.mockResolvedValue(null);
  prismaMock.organizationUser.findUnique.mockResolvedValue({
    organizationId: ORG_ID,
    user: { email: STAFF_EMAIL },
  });
  prismaMock.course.findUnique.mockResolvedValue(colleagueCourse);
  prismaMock.organization.findUnique.mockResolvedValue({
    subscription: { status: 'active', pausedAt: null },
  });
  prismaMock.organizationUser.findMany.mockResolvedValue([
    { id: STAFF_ORG_USER_ID, user: { email: STAFF_EMAIL } },
  ]);
  mockCreateEnrollmentForUser.mockResolvedValue({
    status: 'enrolled',
    email: STAFF_EMAIL,
    userId: 'u-staff-001',
    enrollmentId: 'e-001',
  });
  prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
  prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });
});

describe('assignCoursesToUser() — authorization', () => {
  it('rejects an unauthenticated caller', async () => {
    mockAdminAuth.mockResolvedValue(null);

    await expect(assignCoursesToUser(STAFF_ORG_USER_ID, ['c1'])).rejects.toThrow('Unauthorized');
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('rejects a role without assignment.create before touching the database', async () => {
    mockAdminAuth.mockResolvedValue(sessionFor({ role: 'finance' }));

    await expect(assignCoursesToUser(STAFF_ORG_USER_ID, ['c1'])).rejects.toThrow('Forbidden');
    expect(prismaMock.organizationUser.findUnique).not.toHaveBeenCalled();
  });

  it('allows a role that holds assignment.create without user.edit', async () => {
    mockAdminAuth.mockResolvedValue(sessionFor({ role: 'clinical_director' }));

    await expect(assignCoursesToUser(STAFF_ORG_USER_ID, ['c1'])).resolves.toEqual({
      assigned: 1,
      alreadyAssigned: 0,
      failed: 0,
    });
  });

  it('refuses an empty selection', async () => {
    const result = await assignCoursesToUser(STAFF_ORG_USER_ID, []);

    expect(result).toEqual({
      assigned: 0,
      alreadyAssigned: 0,
      failed: 0,
      error: 'Select at least one course to assign',
    });
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });
});

describe('assignCoursesToUser() — tenancy', () => {
  it('refuses a member of another organization', async () => {
    prismaMock.organizationUser.findUnique.mockResolvedValue({
      organizationId: 'org-other',
      user: { email: 'intruder@other.com' },
    });

    await expect(assignCoursesToUser(STAFF_ORG_USER_ID, ['c1'])).rejects.toThrow(
      'Staff member not found or unauthorized',
    );
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('refuses an unknown membership with the same not-found message', async () => {
    prismaMock.organizationUser.findUnique.mockResolvedValue(null);

    await expect(assignCoursesToUser(STAFF_ORG_USER_ID, ['c1'])).rejects.toThrow(
      'Staff member not found or unauthorized',
    );
  });

  it('reports a course owned by another tenant as failed without enrolling', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      title: 'Someone Else’s Course',
      creator: { organizationId: 'org-other' },
    });

    const result = await assignCoursesToUser(STAFF_ORG_USER_ID, ['c1']);

    expect(result).toEqual({
      assigned: 0,
      alreadyAssigned: 0,
      failed: 1,
      error: 'Course not found or unauthorized',
    });
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });
});

describe('assignCoursesToUser() — fan-out and counting', () => {
  it("assigns a colleague's org-owned course, de-duplicating repeated ids", async () => {
    const result = await assignCoursesToUser(STAFF_ORG_USER_ID, ['c1', 'c2', 'c1']);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ assigned: 2, alreadyAssigned: 0, failed: 0 });
  });

  it('enrolls the target member only, never the whole roster', async () => {
    await assignCoursesToUser(STAFF_ORG_USER_ID, ['c1']);

    expect(prismaMock.organizationUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
          active: true,
          user: { email: { in: [STAFF_EMAIL] } },
        }),
      }),
    );
    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: STAFF_EMAIL },
      expect.objectContaining({ courseId: 'c1', organizationId: ORG_ID }),
    );
  });

  it('counts an already-held course as already assigned, not as newly assigned', async () => {
    mockCreateEnrollmentForUser
      .mockResolvedValueOnce({
        status: 'enrolled',
        email: STAFF_EMAIL,
        userId: 'u-staff-001',
        enrollmentId: 'e-001',
      })
      .mockResolvedValueOnce({ status: 'alreadyEnrolled', email: STAFF_EMAIL });

    const result = await assignCoursesToUser(STAFF_ORG_USER_ID, ['c1', 'c2']);

    expect(result).toEqual({ assigned: 1, alreadyAssigned: 1, failed: 0 });
  });

  it('stamps the completion deadline on the enrollment and its assignment', async () => {
    await assignCoursesToUser(STAFF_ORG_USER_ID, ['c1'], '2026-12-31');

    expect(prismaMock.courseAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dueAt: new Date('2026-12-31') }),
      }),
    );
    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: STAFF_EMAIL },
      expect.objectContaining({ assignmentDueAt: new Date('2026-12-31') }),
    );
  });

  it('refuses an unparseable deadline', async () => {
    const result = await assignCoursesToUser(STAFF_ORG_USER_ID, ['c1'], 'not-a-date');

    expect(result).toEqual({
      assigned: 0,
      alreadyAssigned: 0,
      failed: 0,
      error: "That completion deadline couldn't be read. Please pick the date again.",
    });
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('keeps assigning after one course fails and surfaces its message', async () => {
    prismaMock.course.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(colleagueCourse);

    const result = await assignCoursesToUser(STAFF_ORG_USER_ID, ['c1', 'c2']);

    expect(result).toEqual({
      assigned: 1,
      alreadyAssigned: 0,
      failed: 1,
      error: 'Course not found or unauthorized',
    });
  });

  it('blocks the whole batch when the organization lacks active billing', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({ subscription: null });

    const result = await assignCoursesToUser(STAFF_ORG_USER_ID, ['c1']);

    expect(result.assigned).toBe(0);
    expect(result.error).toBe('Your organization needs an active subscription to assign courses.');
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('revalidates the staff profile so its trainings table reloads', async () => {
    await assignCoursesToUser(STAFF_ORG_USER_ID, ['c1']);

    expect(mockRevalidatePath).toHaveBeenCalledWith(`/dashboard/staff/${STAFF_ORG_USER_ID}`);
  });
});
