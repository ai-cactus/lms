/**
 * Pins a pre-existing gap in `enrollUsers`'s due-date handling, surfaced (not
 * fixed) by Phase 3 of the assign-surface consolidation (c42c6f9).
 *
 * `enrollUsers` does `new Date(assignmentSettings.dueAt)` with no
 * `Number.isNaN` guard — an unparseable deadline string silently becomes an
 * Invalid Date rather than a returned refusal. The retired courses-list
 * action (`assignCourseToUsers`) DID refuse it; that check was never carried
 * over when the surviving action (`enrollUsers`) picked up the same
 * responsibility, and this PR did not touch this code path.
 *
 * This test PINS current behaviour as a regression marker for whenever this
 * gap is fixed — it does not assert the Invalid Date is correct or desired.
 * When the guard is added, this test will need to be rewritten to assert a
 * returned refusal instead.
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

describe('enrollUsers — unparseable dueAt (pre-existing gap, not fixed here)', () => {
  it('does NOT refuse the call — it proceeds and writes an Invalid Date to the assignment', async () => {
    const result = await enrollUsers(
      COURSE_ID,
      [{ email: STAFF_EMAIL }],
      { dueAt: 'not-a-real-date' }, // unparseable deadline
    );

    // Pin: no refusal is returned for this input today.
    expect(result.refusedReason).toBeUndefined();
    expect(result.success).toContain(STAFF_EMAIL);

    // Pin: the value actually reaching persistence is an Invalid Date, not a
    // rejected/normalized one.
    expect(prismaMock.courseAssignment.create).toHaveBeenCalledTimes(1);
    const written = prismaMock.courseAssignment.create.mock.calls[0][0] as {
      data: { dueAt: Date };
    };
    expect(written.data.dueAt).toBeInstanceOf(Date);
    expect(Number.isNaN(written.data.dueAt.getTime())).toBe(true);
  });
});
