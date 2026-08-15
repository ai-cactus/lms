/**
 * Unit tests for assignCoursesToUser (src/app/actions/course.ts) — the
 * staff-profile "Assign Course" flow, which assigns MANY courses to ONE member.
 *
 * The action is an authorization + tenancy shell that fans out to
 * `assignCourseToUsers`, so the assertions here are about that shell: the
 * `assignment.create` gate, the same-org check on the target membership, and the
 * counting rule the success copy depends on — `assigned` counts only enrollments
 * this call newly created, with `createMany`'s `skipDuplicates` no-ops reported
 * as `alreadyAssigned`.
 *
 * The prisma surface mirrors course.assign-course-to-users.test.ts because the
 * fan-out target runs for real here rather than being mocked: that is the point
 * of the test — the staff-profile path must inherit the SAME org-ownership
 * ruling (COU-004) the courses-list assign modal uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth, mockWorkerAuth, mockRevalidatePath } = vi.hoisted(() => ({
  prismaMock: {
    course: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    organizationUser: { findUnique: vi.fn(), findMany: vi.fn() },
    organizationUserFacility: { findMany: vi.fn() },
    enrollment: { createMany: vi.fn() },
    courseAssignment: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    assignmentReminderStage: { upsert: vi.fn() },
  },
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/reminders/sweep', () => ({ resolveOnCompletion: vi.fn() }));

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
  prismaMock.organizationUserFacility.findMany.mockResolvedValue([]);
  prismaMock.enrollment.createMany.mockResolvedValue({ count: 1 });
  prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
  prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });
});

describe('assignCoursesToUser() — authorization', () => {
  it('rejects an unauthenticated caller', async () => {
    mockAdminAuth.mockResolvedValue(null);

    await expect(assignCoursesToUser(STAFF_ORG_USER_ID, ['c1'])).rejects.toThrow('Unauthorized');
    expect(prismaMock.enrollment.createMany).not.toHaveBeenCalled();
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

  it('rejects an empty selection', async () => {
    await expect(assignCoursesToUser(STAFF_ORG_USER_ID, [])).rejects.toThrow(
      'Select at least one course to assign',
    );
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
    expect(prismaMock.enrollment.createMany).not.toHaveBeenCalled();
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
    expect(prismaMock.enrollment.createMany).not.toHaveBeenCalled();
  });
});

describe('assignCoursesToUser() — fan-out and counting', () => {
  it("assigns a colleague's org-owned course, de-duplicating repeated ids", async () => {
    const result = await assignCoursesToUser(STAFF_ORG_USER_ID, ['c1', 'c2', 'c1']);

    expect(prismaMock.enrollment.createMany).toHaveBeenCalledTimes(2);
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
    expect(prismaMock.enrollment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ organizationUserId: STAFF_ORG_USER_ID, courseId: 'c1' })],
        skipDuplicates: true,
      }),
    );
  });

  it('counts a skipped duplicate as already assigned, not as newly assigned', async () => {
    prismaMock.enrollment.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

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
    expect(prismaMock.enrollment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ dueAt: new Date('2026-12-31') })],
      }),
    );
  });

  it('rejects an unparseable deadline', async () => {
    await expect(assignCoursesToUser(STAFF_ORG_USER_ID, ['c1'], 'not-a-date')).rejects.toThrow(
      'Invalid completion deadline',
    );
    expect(prismaMock.enrollment.createMany).not.toHaveBeenCalled();
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
    expect(prismaMock.enrollment.createMany).not.toHaveBeenCalled();
  });

  it('revalidates the staff profile so its trainings table reloads', async () => {
    await assignCoursesToUser(STAFF_ORG_USER_ID, ['c1']);

    expect(mockRevalidatePath).toHaveBeenCalledWith(`/dashboard/staff/${STAFF_ORG_USER_ID}`);
  });
});
