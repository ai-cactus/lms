/**
 * Regression guard for the F-051 publish-review gate on the DIRECT assign paths.
 *
 * `createFullCourse` and `publishCourse` (src/app/actions/course.ts) defer
 * enrollment/email until a review-required draft is explicitly acknowledged
 * (see course.deferred-assignment.test.ts). But `enrollUsers` and the
 * role-target assign actions — the same functions `publishCourse` calls to
 * replay the deferred intent — are also reachable DIRECTLY from
 * `/dashboard/training/courses/[id]/assign` (AssignPublishClient.tsx), and from
 * the staff profile. Without their own gate an admin could create a course
 * flagged `reviewRequired: true` (still `status: 'draft'`), navigate straight
 * to its Assign page, and enroll — and EMAIL — learners about an unreviewed
 * course, reaching the Issue #14 scenario through a second door.
 *
 * The gate refuses by RETURN VALUE rather than by throwing: Next.js redacts
 * errors thrown from a Server Action in production, so a thrown message reaches
 * the browser as an opaque React error (#441) instead of the reason. These
 * tests pin both halves — the reason is communicated, and the refusal is
 * fail-closed (no assignment, enrollment, invite or email is written).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth, mockWorkerAuth } = vi.hoisted(() => {
  const prismaMock = {
    course: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    organizationUser: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    orgCourseOffering: { findUnique: vi.fn(), upsert: vi.fn() },
    courseAssignment: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    assignmentReminderStage: { upsert: vi.fn() },
    enrollment: { findFirst: vi.fn(), create: vi.fn() },
    facility: { findFirst: vi.fn() },
    organizationUserFacility: { findFirst: vi.fn().mockResolvedValue(null) },
    reminderLog: { create: vi.fn() },
    organization: { findUnique: vi.fn() },
    invite: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    inviteCourseAssignment: { upsert: vi.fn() },
  };
  const mockAdminAuth = vi.fn();
  const mockWorkerAuth = vi.fn();
  return { prismaMock, mockAdminAuth, mockWorkerAuth };
});

const mockSendCourseInviteEmail = vi.fn().mockResolvedValue(undefined);
const mockSendCourseLaunchEmail = vi.fn().mockResolvedValue(undefined);

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
  sendCourseInviteEmail: mockSendCourseInviteEmail,
  sendCourseLaunchEmail: mockSendCourseLaunchEmail,
}));
vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('hashed-password') },
  hash: vi.fn().mockResolvedValue('hashed-password'),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));

import { assignCourseToRole, enrollUsers } from './enrollment';

const ADMIN_ID = 'admin-001';
const ADMIN_ORG_USER_ID = 'ou-admin-001';
const ORG_ID = 'org-001';
const COURSE_ID = 'held-course-001';
const STAFF_EMAIL = 'staff@example.com';

/** The exact copy the assign UI (and its e2e guard) shows the admin. */
const REFUSAL_MESSAGE =
  'This course has quality warnings and requires review before it can be assigned.';

const adminSession = {
  user: {
    id: ADMIN_ID,
    organizationUserId: ADMIN_ORG_USER_ID,
    organizationId: ORG_ID,
    role: 'owner',
  },
};

// A course the F-051 gate is holding back: still a draft, flagged for review,
// with an intent already parked in pendingAssignment by createFullCourse —
// exactly the state Issue #14 introduced to prevent enrollment/email.
const reviewRequiredCourse = {
  id: COURSE_ID,
  title: 'Degraded Course',
  createdByOrgUserId: ADMIN_ORG_USER_ID,
  isGlobal: false,
  type: 'document',
  status: 'draft',
  reviewRequired: true,
  qualityWarnings: ['No slides were generated for this course.'],
  pendingAssignment: { mode: 'email', emails: [STAFF_EMAIL], dueAt: null },
};

/** Nothing that could reach a learner may have been written. */
function expectNoAssignmentSideEffects() {
  expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  expect(prismaMock.courseAssignment.create).not.toHaveBeenCalled();
  expect(prismaMock.courseAssignment.update).not.toHaveBeenCalled();
  expect(prismaMock.invite.create).not.toHaveBeenCalled();
  expect(prismaMock.user.create).not.toHaveBeenCalled();
  expect(mockSendCourseInviteEmail).not.toHaveBeenCalled();
  expect(mockSendCourseLaunchEmail).not.toHaveBeenCalled();
}

describe('F-051 review gate — the direct assign paths refuse a held draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminAuth.mockResolvedValue(adminSession);
    mockWorkerAuth.mockResolvedValue(null);

    prismaMock.organization.findUnique.mockResolvedValue({
      name: 'Acme Corp',
      subscription: { status: 'active', pausedAt: null },
    });
    prismaMock.enrollment.findFirst.mockResolvedValue(null);
    prismaMock.enrollment.create.mockResolvedValue({});
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'staff-user-001',
      firstName: null,
      lastName: null,
      fullName: 'Jane Doe',
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-staff-001' });
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
    prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });
    prismaMock.course.findUnique.mockResolvedValue(reviewRequiredCourse);
  });

  it('enrollUsers returns the refusal reason instead of throwing it', async () => {
    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }]);

    // Returned, not thrown: a thrown Server Action error is redacted in
    // production, so the admin would see React error #441 rather than this.
    expect(result.refusedReason).toBe(REFUSAL_MESSAGE);
    expect(result).toMatchObject({
      success: [],
      alreadyEnrolled: [],
      newInvited: [],
      failed: [],
    });
  });

  it('enrollUsers enrolls, invites and emails nobody when it refuses', async () => {
    await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }]);

    expectNoAssignmentSideEffects();
  });

  it('enrollUsers refuses before emitting any deferred worker notification', async () => {
    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }], undefined, {
      deferWorkerNotification: true,
    });

    expect(result.refusedReason).toBe(REFUSAL_MESSAGE);
    expect(result.deferred).toEqual([]);
    expectNoAssignmentSideEffects();
  });

  it('assignCourseToRole returns the refusal reason and writes no assignment', async () => {
    const result = await assignCourseToRole(COURSE_ID, 'nurse');

    expect(result.refusedReason).toBe(REFUSAL_MESSAGE);
    expect(result).toMatchObject({
      assignmentId: null,
      holderCount: 0,
      enrolled: 0,
      alreadyEnrolled: 0,
      failed: 0,
      targetRole: 'nurse',
    });
    // Refused before the holder lookup, so no role holder was ever considered.
    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
    expectNoAssignmentSideEffects();
  });
});
