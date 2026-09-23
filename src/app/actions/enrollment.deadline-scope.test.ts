/**
 * BUG-20: `EnrollUsersOptions.deadlineScope`.
 *
 * The `CourseAssignment` row is shared by the whole organisation, so a surface
 * whose deadline control is per-person (the staff-profile assign modal) must
 * not restate its date over everyone already enrolled. `'enrollment'` scope
 * omits `dueAt` from the shared row entirely and routes the submitted date
 * into the new enrollee's own deadline instead; the default `'assignment'`
 * scope keeps the org-wide write every other surface relies on.
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
  maskEmail: (email: string) => email,
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
import type { CreateEnrollmentContext } from '@/lib/enrollment/create';

const ORG_ID = 'org-1';
const ADMIN_ORG_USER_ID = 'ou-admin-1';
const COURSE_ID = 'course-1';
const STAFF_EMAIL = 'staff@example.com';
const ASSIGNMENT_ID = 'assignment-001';

/** The org-wide deadline already in force, far enough out to never be "past". */
const SHARED_DUE_AT = new Date('2099-01-01T00:00:00.000Z');
/** The per-person deadline the staff-profile modal submits. */
const PICKED_DUE_AT = new Date('2027-09-23T00:00:00.000Z');
const PAST_DUE_AT = new Date('2020-01-01T00:00:00.000Z');

const SHARED_WINDOW_DAYS = 45;

function enrollmentContext(): CreateEnrollmentContext {
  expect(mockCreateEnrollmentForUser).toHaveBeenCalledTimes(1);
  return mockCreateEnrollmentForUser.mock.calls[0][1] as CreateEnrollmentContext;
}

function assignmentUpdateData(): Record<string, unknown> {
  expect(prismaMock.courseAssignment.update).toHaveBeenCalledTimes(1);
  const call = prismaMock.courseAssignment.update.mock.calls[0][0] as {
    data: Record<string, unknown>;
  };
  return call.data;
}

/** Seed the org's existing shared assignment row, as `upsertCourseAssignment` reads it back. */
function seedExistingAssignment(dueAt: Date | null = SHARED_DUE_AT): void {
  prismaMock.courseAssignment.findFirst.mockResolvedValue({ id: ASSIGNMENT_ID, dueAt });
  prismaMock.courseAssignment.update.mockImplementation(
    async (args: { data: { dueAt?: Date | null } }) => ({
      id: ASSIGNMENT_ID,
      dueAt: args.data.dueAt !== undefined ? args.data.dueAt : dueAt,
      dueWindowDays: SHARED_WINDOW_DAYS,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ENROLLMENT_BATCH_ENABLED;
  mockAuth.mockResolvedValue({
    user: {
      id: 'user-1',
      organizationUserId: ADMIN_ORG_USER_ID,
      organizationId: ORG_ID,
      role: 'owner', // org-wide role — isolates the deadline path from the facility gate
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
  seedExistingAssignment();
  prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-staff-1' });
  prismaMock.organizationUser.findMany.mockResolvedValue([]);
  mockCreateEnrollmentForUser.mockImplementation(async (entry: { email: string }) => ({
    status: 'enrolled' as const,
    email: entry.email,
    userId: 'u-staff-1',
    enrollmentId: 'e-1',
  }));
});

describe("enrollUsers — deadlineScope: 'enrollment'", () => {
  it('leaves the shared assignment deadline out of the write entirely', async () => {
    const result = await enrollUsers(
      COURSE_ID,
      [{ email: STAFF_EMAIL }],
      {
        dueAt: PICKED_DUE_AT,
      },
      { deadlineScope: 'enrollment' },
    );

    expect(result.refusedReason).toBeUndefined();
    expect(result.success).toContain(STAFF_EMAIL);
    // `undefined` is not enough — the key must be ABSENT, or Prisma writes null.
    expect(assignmentUpdateData()).not.toHaveProperty('dueAt');
  });

  it("carries the submitted deadline into the enrollee's own dueAt", async () => {
    await enrollUsers(
      COURSE_ID,
      [{ email: STAFF_EMAIL }],
      { dueAt: PICKED_DUE_AT },
      {
        deadlineScope: 'enrollment',
      },
    );

    expect(enrollmentContext().assignmentDueAt).toEqual(PICKED_DUE_AT);
  });

  it("inherits the shared row's window so a per-person deadline costs nothing else", async () => {
    await enrollUsers(
      COURSE_ID,
      [{ email: STAFF_EMAIL }],
      { dueAt: PICKED_DUE_AT },
      {
        deadlineScope: 'enrollment',
      },
    );

    expect(enrollmentContext().assignmentWindowDays).toBe(SHARED_WINDOW_DAYS);
  });

  it("falls back to the shared row's deadline when this surface picked none", async () => {
    await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }], undefined, {
      deadlineScope: 'enrollment',
    });

    expect(assignmentUpdateData()).not.toHaveProperty('dueAt');
    expect(enrollmentContext().assignmentDueAt).toEqual(SHARED_DUE_AT);
  });

  it('refuses a past deadline even when it matches the one already in force', async () => {
    // The late-joiner exemption is about the org-wide row; a brand-new
    // enrollment's own deadline is always a change, so a past date is refused.
    seedExistingAssignment(PAST_DUE_AT);

    const result = await enrollUsers(
      COURSE_ID,
      [{ email: STAFF_EMAIL }],
      {
        dueAt: PAST_DUE_AT,
      },
      { deadlineScope: 'enrollment' },
    );

    expect(result.refusedReason).toBe('The deadline must be in the future.');
    expect(prismaMock.courseAssignment.update).not.toHaveBeenCalled();
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });
});

describe("enrollUsers — default deadlineScope ('assignment')", () => {
  it('still writes the submitted deadline through to the shared row', async () => {
    await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }], { dueAt: PICKED_DUE_AT });

    expect(assignmentUpdateData().dueAt).toEqual(PICKED_DUE_AT);
    expect(enrollmentContext().assignmentDueAt).toEqual(PICKED_DUE_AT);
  });

  it('behaves identically when the scope is passed explicitly', async () => {
    await enrollUsers(
      COURSE_ID,
      [{ email: STAFF_EMAIL }],
      { dueAt: PICKED_DUE_AT },
      {
        deadlineScope: 'assignment',
      },
    );

    expect(assignmentUpdateData().dueAt).toEqual(PICKED_DUE_AT);
  });

  it('admits a late joiner on a past deadline that matches the stored one', async () => {
    seedExistingAssignment(PAST_DUE_AT);

    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }], { dueAt: PAST_DUE_AT });

    expect(result.refusedReason).toBeUndefined();
    expect(result.success).toContain(STAFF_EMAIL);
  });

  it('refuses a past deadline that would move the stored one', async () => {
    seedExistingAssignment(SHARED_DUE_AT);

    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }], { dueAt: PAST_DUE_AT });

    expect(result.refusedReason).toBe('The deadline must be in the future.');
    expect(prismaMock.courseAssignment.update).not.toHaveBeenCalled();
  });
});
