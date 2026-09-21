/**
 * "No learner is ever enrolled in a draft."
 *
 * The assign paths deliberately gate on `reviewRequired`, not on `status`: the
 * Assign & Publish page submits an ordinary unheld draft on purpose, and a
 * status gate there would break the primary authoring flow. The ruling is
 * enforced at the point that actually decides the outcome instead —
 * `publishCourseOnAssignment` takes the course out of draft BEFORE the first
 * enrollment write, and the assignment is REFUSED when it cannot.
 *
 * That failure case is the whole point of these tests. It used to log and carry
 * on, so a course that could not leave draft still gained enrollments,
 * certificates and launch emails — the exact artifact the ruling forbids. The
 * refusal is by RETURN VALUE, as with the F-051 review gate, because a thrown
 * Server Action error is redacted in production (React #441).
 *
 * `publishCourseOnAssignment` is deliberately NOT mocked here: the transition
 * and the refusal are one mechanism, and mocking the transition would test the
 * gate against a fiction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth, mockWorkerAuth } = vi.hoisted(() => {
  const prismaMock = {
    course: { findUnique: vi.fn(), update: vi.fn() },
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
  return { prismaMock, mockAdminAuth: vi.fn(), mockWorkerAuth: vi.fn() };
});

const mockSendCourseInviteEmail = vi.fn().mockResolvedValue(undefined);
const mockSendCourseLaunchEmail = vi.fn().mockResolvedValue(undefined);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/notifications/create', () => ({
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

import { assignCourseToRoles, enrollUsers } from './enrollment';

const ADMIN_ID = 'admin-001';
const ADMIN_ORG_USER_ID = 'ou-admin-001';
const ORG_ID = 'org-001';
const COURSE_ID = 'draft-course-001';
const STAFF_EMAIL = 'staff@example.com';

/** The copy the assign UI surfaces when the course could not leave draft. */
const REFUSAL_MESSAGE =
  'This course is still a draft and could not be published, so it was not assigned.';

const adminSession = {
  user: {
    id: ADMIN_ID,
    organizationUserId: ADMIN_ORG_USER_ID,
    organizationId: ORG_ID,
    role: 'owner',
  },
};

/**
 * An ordinary unheld draft — what the Assign & Publish page submits, and what
 * a fork starts life as (`draft` + `reviewRequired: false`).
 */
const unheldDraft = {
  id: COURSE_ID,
  title: 'Newly Forked Course',
  createdByOrgUserId: ADMIN_ORG_USER_ID,
  creator: { organizationId: ORG_ID },
  isGlobal: false,
  type: 'document',
  status: 'draft',
  reviewRequired: false,
  qualityWarnings: [],
  pendingAssignment: null,
};

function expectNoAssignmentSideEffects() {
  expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  expect(prismaMock.courseAssignment.create).not.toHaveBeenCalled();
  expect(prismaMock.courseAssignment.update).not.toHaveBeenCalled();
  expect(prismaMock.invite.create).not.toHaveBeenCalled();
  expect(prismaMock.user.create).not.toHaveBeenCalled();
  expect(mockSendCourseInviteEmail).not.toHaveBeenCalled();
  expect(mockSendCourseLaunchEmail).not.toHaveBeenCalled();
}

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
  prismaMock.courseAssignment.create.mockResolvedValue({
    id: 'assignment-001',
    dueAt: null,
    dueWindowDays: null,
  });
  prismaMock.course.findUnique.mockResolvedValue(unheldDraft);
  prismaMock.course.update.mockResolvedValue({});
});

describe('the Assign & Publish flow still works — an unheld draft assigns', () => {
  it('enrollUsers publishes the draft before it enrolls anyone', async () => {
    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }]);

    expect(result.refusedReason).toBeUndefined();
    expect(prismaMock.course.update).toHaveBeenCalledWith({
      where: { id: COURSE_ID },
      data: expect.objectContaining({ status: 'published' }),
    });
    // The ruling is about ORDER, not about refusing the draft: the status write
    // must land before the first enrollment row, or a learner is momentarily
    // enrolled in a draft.
    const publishOrder = prismaMock.course.update.mock.invocationCallOrder[0];
    const enrollOrder = prismaMock.enrollment.create.mock.invocationCallOrder[0];
    expect(prismaMock.enrollment.create).toHaveBeenCalled();
    expect(publishOrder).toBeLessThan(enrollOrder);
  });

  it('assignCourseToRoles publishes the draft rather than refusing it', async () => {
    const result = await assignCourseToRoles(COURSE_ID, ['nurse']);

    expect(result.refusedReason).toBeUndefined();
    expect(prismaMock.course.update).toHaveBeenCalledWith({
      where: { id: COURSE_ID },
      data: expect.objectContaining({ status: 'published' }),
    });
  });
});

describe('a course that cannot leave draft enrols nobody', () => {
  beforeEach(() => {
    prismaMock.course.update.mockRejectedValue(new Error('db down'));
  });

  it('enrollUsers returns the refusal reason instead of throwing it', async () => {
    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }]);

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

  it('assignCourseToRoles returns the refusal reason and writes no assignment', async () => {
    const result = await assignCourseToRoles(COURSE_ID, ['nurse']);

    expect(result.refusedReason).toBe(REFUSAL_MESSAGE);
    expect(result).toMatchObject({
      assignmentId: null,
      holderCount: 0,
      enrolled: 0,
      alreadyEnrolled: 0,
      failed: 0,
    });
    // Refused before the holder lookup, so no role holder was ever considered.
    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
    expectNoAssignmentSideEffects();
  });
});

describe('scope — only `draft` is gated', () => {
  it('leaves a retired (inactive) course assignable and does not revive it', async () => {
    prismaMock.course.findUnique.mockResolvedValue({ ...unheldDraft, status: 'inactive' });

    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }]);

    // The maintainer was asked and confirmed: drafts only. A retired course
    // still accepts assignments, and assigning one must not silently republish
    // it either.
    expect(result.refusedReason).toBeUndefined();
    expect(prismaMock.course.update).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.create).toHaveBeenCalled();
  });

  it('a published course assigns with no status write at all', async () => {
    prismaMock.course.findUnique.mockResolvedValue({ ...unheldDraft, status: 'published' });

    const result = await enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }]);

    expect(result.refusedReason).toBeUndefined();
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });
});
