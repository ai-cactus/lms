/**
 * Unit tests for enrollInviteCourses (src/lib/enrollment/invite-courses.ts).
 *
 * Materialises courses parked on an accepted invite (InviteCourseAssignment
 * rows, see create.test.ts's invite branch) into real enrollments. Called at
 * accept time from src/app/api/invite/accept/route.ts and both OAuth
 * pending-invite branches in src/lib/create-auth-instance.ts — its own tests
 * assert only that it's CALLED with the right args (mocked here).
 *
 * createEnrollmentForUser is mocked so this suite is isolated to
 * enrollInviteCourses's own responsibility: resolving the org's live
 * CourseAssignment settings (or falling back to bare nulls) and building the
 * enrollment context correctly — not re-testing createEnrollmentForUser's
 * internals (covered by create.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockCreateEnrollmentForUser, mockLogger } = vi.hoisted(() => {
  const prismaMock = {
    invite: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    courseAssignment: { findFirst: vi.fn() },
    course: { findUnique: vi.fn() },
  };
  return {
    prismaMock,
    mockCreateEnrollmentForUser: vi.fn(),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/logger', () => ({ logger: mockLogger }));
vi.mock('./create', () => ({ createEnrollmentForUser: mockCreateEnrollmentForUser }));

import { enrollInviteCourses } from './invite-courses';

const USER_ID = 'user-1';
const INVITE_ID = 'invite-1';

const baseUser = {
  email: 'staff@example.com',
  facilityId: 'facility-1',
  organizationId: 'org-1',
  organization: { name: 'Acme Corp' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateEnrollmentForUser.mockResolvedValue({
    status: 'enrolled',
    email: 'staff@example.com',
    userId: USER_ID,
    enrollmentId: 'enrollment-1',
  });
});

describe('enrollInviteCourses — guard clauses (no-op, never throws)', () => {
  it('is a no-op when the invite does not exist', async () => {
    prismaMock.invite.findUnique.mockResolvedValue(null);

    await enrollInviteCourses(USER_ID, INVITE_ID);

    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('is a no-op when the invite has no parked courses', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      courseAssignments: [],
    });

    await enrollInviteCourses(USER_ID, INVITE_ID);

    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('is a no-op when the user does not exist', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      courseAssignments: [{ courseId: 'course-1' }],
    });
    prismaMock.user.findUnique.mockResolvedValue(null);

    await enrollInviteCourses(USER_ID, INVITE_ID);

    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it("is a no-op when the user does not belong to the invite's organization (cross-tenant safety)", async () => {
    prismaMock.invite.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      courseAssignments: [{ courseId: 'course-1' }],
    });
    prismaMock.user.findUnique.mockResolvedValue({ ...baseUser, organizationId: 'org-OTHER' });

    await enrollInviteCourses(USER_ID, INVITE_ID);

    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('never throws — logs and swallows a DB failure', async () => {
    prismaMock.invite.findUnique.mockRejectedValue(new Error('db down'));

    await expect(enrollInviteCourses(USER_ID, INVITE_ID)).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: '[enrollment] Invite-course enroll on accept failed',
        userId: USER_ID,
        inviteId: INVITE_ID,
      }),
    );
  });
});

describe('enrollInviteCourses — materialising parked courses', () => {
  it("enrolls a parked course using the org's live CourseAssignment settings", async () => {
    prismaMock.invite.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      courseAssignments: [{ courseId: 'course-1' }],
    });
    prismaMock.user.findUnique.mockResolvedValue(baseUser);
    const scheduleAt = new Date('2026-08-01T00:00:00Z');
    const dueAt = new Date('2026-09-01T00:00:00Z');
    prismaMock.courseAssignment.findFirst.mockResolvedValue({
      id: 'assignment-1',
      scheduleAt,
      dueAt,
      dueWindowDays: 14,
      course: { title: 'Safety Training' },
    });

    await enrollInviteCourses(USER_ID, INVITE_ID);

    expect(prismaMock.courseAssignment.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', courseId: 'course-1' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        scheduleAt: true,
        dueAt: true,
        dueWindowDays: true,
        course: { select: { title: true } },
      },
    });
    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'staff@example.com' },
      {
        courseId: 'course-1',
        courseTitle: 'Safety Training',
        organizationId: 'org-1',
        organizationName: 'Acme Corp',
        facilityId: 'facility-1',
        assignmentId: 'assignment-1',
        scheduleAt,
        assignmentDueAt: dueAt,
        assignmentWindowDays: 14,
        enrolledByUserId: USER_ID,
      },
    );
    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to bare nulls (courseTitle from Course directly) when no CourseAssignment row exists for the course', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      courseAssignments: [{ courseId: 'course-2' }],
    });
    prismaMock.user.findUnique.mockResolvedValue(baseUser);
    prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
    prismaMock.course.findUnique.mockResolvedValue({ title: 'Fallback Course' });

    await enrollInviteCourses(USER_ID, INVITE_ID);

    expect(prismaMock.course.findUnique).toHaveBeenCalledWith({
      where: { id: 'course-2' },
      select: { title: true },
    });
    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'staff@example.com' },
      expect.objectContaining({
        courseId: 'course-2',
        courseTitle: 'Fallback Course',
        assignmentId: null,
        scheduleAt: null,
        assignmentDueAt: null,
        assignmentWindowDays: null,
      }),
    );
  });

  it('defaults organizationName to "Your Organization" when the user has no organization name on record', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      courseAssignments: [{ courseId: 'course-1' }],
    });
    prismaMock.user.findUnique.mockResolvedValue({ ...baseUser, organization: null });
    prismaMock.courseAssignment.findFirst.mockResolvedValue({
      id: 'assignment-1',
      scheduleAt: null,
      dueAt: null,
      dueWindowDays: null,
      course: { title: 'Safety Training' },
    });

    await enrollInviteCourses(USER_ID, INVITE_ID);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'staff@example.com' },
      expect.objectContaining({ organizationName: 'Your Organization' }),
    );
  });

  it('skips a course whose title cannot be resolved at all (no CourseAssignment row and no Course row)', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      courseAssignments: [{ courseId: 'deleted-course' }],
    });
    prismaMock.user.findUnique.mockResolvedValue(baseUser);
    prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
    prismaMock.course.findUnique.mockResolvedValue(null);

    await enrollInviteCourses(USER_ID, INVITE_ID);

    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('processes every parked course independently', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      courseAssignments: [{ courseId: 'course-a' }, { courseId: 'course-b' }],
    });
    prismaMock.user.findUnique.mockResolvedValue(baseUser);
    prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
    prismaMock.course.findUnique
      .mockResolvedValueOnce({ title: 'Course A' })
      .mockResolvedValueOnce({ title: 'Course B' });

    await enrollInviteCourses(USER_ID, INVITE_ID);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledTimes(2);
    expect(mockCreateEnrollmentForUser).toHaveBeenNthCalledWith(
      1,
      { email: 'staff@example.com' },
      expect.objectContaining({ courseId: 'course-a', courseTitle: 'Course A' }),
    );
    expect(mockCreateEnrollmentForUser).toHaveBeenNthCalledWith(
      2,
      { email: 'staff@example.com' },
      expect.objectContaining({ courseId: 'course-b', courseTitle: 'Course B' }),
    );
  });

  it('is idempotent: an already-enrolled outcome logs nothing new and does not throw', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      courseAssignments: [{ courseId: 'course-1' }],
    });
    prismaMock.user.findUnique.mockResolvedValue(baseUser);
    prismaMock.courseAssignment.findFirst.mockResolvedValue({
      id: 'assignment-1',
      scheduleAt: null,
      dueAt: null,
      dueWindowDays: null,
      course: { title: 'Safety Training' },
    });
    mockCreateEnrollmentForUser.mockResolvedValue({
      status: 'alreadyEnrolled',
      email: 'staff@example.com',
    });

    await enrollInviteCourses(USER_ID, INVITE_ID);

    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ msg: '[enrollment] Invite-parked course enrolled on accept' }),
    );
  });

  it('logs when a course is newly enrolled', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      courseAssignments: [{ courseId: 'course-1' }],
    });
    prismaMock.user.findUnique.mockResolvedValue(baseUser);
    prismaMock.courseAssignment.findFirst.mockResolvedValue({
      id: 'assignment-1',
      scheduleAt: null,
      dueAt: null,
      dueWindowDays: null,
      course: { title: 'Safety Training' },
    });

    await enrollInviteCourses(USER_ID, INVITE_ID);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: '[enrollment] Invite-parked course enrolled on accept',
        userId: USER_ID,
        courseId: 'course-1',
        inviteId: INVITE_ID,
      }),
    );
  });
});
