/**
 * `enrollUsers` refuses an unparseable deadline (BUG-12.2).
 *
 * It used to do `new Date(assignmentSettings.dueAt)` with no `Number.isNaN`
 * guard, so an unparseable string became an Invalid Date written to the
 * organisation-wide CourseAssignment. `assignCourseToRoles` already refused it;
 * this pins the same refusal here — returned, never thrown, and before any
 * write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockWorkerAuth, prismaMock, mockCreateEnrollmentForUser } = vi.hoisted(() => {
  const prismaMock = {
    course: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    organizationUser: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    orgCourseOffering: { findUnique: vi.fn(), upsert: vi.fn() },
    courseAssignment: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    assignmentReminderStage: { upsert: vi.fn() },
    enrollment: { findFirst: vi.fn(), create: vi.fn() },
    facility: { findFirst: vi.fn().mockResolvedValue(null) },
    organizationUserFacility: { findFirst: vi.fn().mockResolvedValue(null) },
    reminderLog: { create: vi.fn() },
    organization: { findUnique: vi.fn() },
    invite: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  };
  return {
    prismaMock,
    mockAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockCreateEnrollmentForUser: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/notifications/create', () => ({
  createNotification: vi.fn(),
  notifyOrganizationAdmins: vi.fn(),
}));
vi.mock('@/lib/email', () => ({
  sendCourseInviteEmail: vi.fn(),
  sendCourseLaunchEmail: vi.fn(),
}));
vi.mock('@/lib/enrollment/create', () => ({
  createEnrollmentForUser: mockCreateEnrollmentForUser,
  createEnrollmentsForUsers: vi.fn(),
}));

import { enrollUsers } from './enrollment';

const ORG_ID = 'org-1';
const ADMIN_ORG_USER_ID = 'ou-admin-1';
const COURSE_ID = 'course-1';
const STAFF_EMAIL = 'staff@example.com';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ENROLLMENT_BATCH_ENABLED;
  mockAuth.mockResolvedValue({
    user: {
      id: 'user-1',
      organizationUserId: ADMIN_ORG_USER_ID,
      organizationId: ORG_ID,
      role: 'owner', // org-wide role — isolates the due-date path from the facility gate
    },
  });
  mockWorkerAuth.mockResolvedValue(null);
  prismaMock.course.findUnique.mockResolvedValue({
    id: COURSE_ID,
    title: 'Infection Control',
    createdByOrgUserId: ADMIN_ORG_USER_ID,
    creator: { organizationId: ORG_ID },
    isGlobal: false,
    status: 'published',
    reviewRequired: false,
  });
  prismaMock.organization.findUnique.mockResolvedValue({
    name: 'Acme Corp',
    subscription: { status: 'active', pausedAt: null },
  });
  prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
  prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });
  prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-staff-1' });
  prismaMock.organizationUser.findMany.mockResolvedValue([]);
  mockCreateEnrollmentForUser.mockImplementation(async (entry: { email: string }) => ({
    status: 'enrolled' as const,
    email: entry.email,
    userId: 'u-staff-1',
    enrollmentId: 'e-1',
  }));
});

describe('enrollUsers — unparseable dueAt (BUG-12.2)', () => {
  it('refuses the call by return and writes nothing', async () => {
    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }], {
      dueAt: 'not-a-real-date',
    });

    expect(result).toEqual({
      success: [],
      alreadyEnrolled: [],
      newInvited: [],
      failed: [],
      refusedReason: "That completion deadline couldn't be read. Please pick the date again.",
    });
    expect(prismaMock.orgCourseOffering.upsert).not.toHaveBeenCalled();
    expect(prismaMock.courseAssignment.create).not.toHaveBeenCalled();
    expect(prismaMock.courseAssignment.update).not.toHaveBeenCalled();
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('keeps the batched-caller shape: a deferred list is still returned', async () => {
    const result = await enrollUsers(
      COURSE_ID,
      [{ email: STAFF_EMAIL }],
      { dueAt: 'not-a-real-date' },
      { deferWorkerNotification: true, deadlineScope: 'enrollment' },
    );

    expect(result.refusedReason).toBeDefined();
    expect(result.deferred).toEqual([]);
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('still accepts a readable deadline', async () => {
    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }], {
      dueAt: '2099-01-01T23:59:00.000Z',
    });

    expect(result.refusedReason).toBeUndefined();
    expect(result.success).toContain(STAFF_EMAIL);
  });
});

/**
 * Q-32: the call is not refused for a date that has passed somewhere; each
 * learner is judged in their own zone, and those it had passed for are returned
 * so the admin is told, while everyone else is enrolled.
 */
describe('enrollUsers — per-learner "already past" (Q-32)', () => {
  it('reports the Kiritimati learner it skipped and enrols the Honolulu one', async () => {
    mockCreateEnrollmentForUser.mockImplementation(async (entry: { email: string }) =>
      entry.email === 'east@example.com'
        ? { status: 'deadlinePassed' as const, email: entry.email, timeZone: 'Pacific/Kiritimati' }
        : { status: 'enrolled' as const, email: entry.email, userId: 'u', enrollmentId: 'e' },
    );

    const result = await enrollUsers(
      COURSE_ID,
      [{ email: 'east@example.com' }, { email: 'west@example.com' }],
      { dueAt: '2099-09-30T23:59:00.000Z' },
    );

    expect(result.refusedReason).toBeUndefined();
    expect(result.success).toEqual(['west@example.com']);
    expect(result.deadlinePassed).toEqual([
      { email: 'east@example.com', timeZone: 'Pacific/Kiritimati' },
    ]);
    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ onPassedDeadline: 'skip' }),
    );
  });

  it('omits deadlinePassed when nobody was skipped', async () => {
    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }], {
      dueAt: '2099-09-30T23:59:00.000Z',
    });

    expect(result).not.toHaveProperty('deadlinePassed');
  });
});
