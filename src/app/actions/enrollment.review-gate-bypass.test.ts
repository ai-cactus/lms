/**
 * Regression probe for a gap discovered while testing Issue #14 (the F-051
 * publish-review gate).
 *
 * `createFullCourse` and `publishCourse` (src/app/actions/course.ts) now
 * correctly defer enrollment/email until a review-required draft is
 * explicitly acknowledged (see course.deferred-assignment.test.ts). BUT
 * `enrollUsers` and `assignCourseToRoles` — the same two functions
 * `publishCourse` calls to replay the deferred intent — are also reachable
 * DIRECTLY from `/dashboard/training/courses/[id]/assign`
 * (AssignPublishClient.tsx via the assign/page.tsx server component), and
 * neither the page's course lookup nor `enrollUsers` itself ever reads
 * `course.reviewRequired`. TrainingDetails.tsx's "Assign" button also links
 * there unconditionally, regardless of the course's review-gate state.
 *
 * Concretely: an admin can create a course that gets flagged
 * `reviewRequired: true` (still `status: 'draft'`), then navigate straight to
 * its Assign page and click "Assign Course" — which calls `enrollUsers`
 * directly — enrolling and EMAILING learners about a course that has not
 * been reviewed. This is precisely the scenario Issue #14 was fixed to
 * prevent, reached through a second door the fix never closed.
 *
 * This is a PRODUCT DEFECT, not a test issue — reported to the orchestrator
 * per bug-hunter's mandate, not fixed here. The assertion below documents
 * the desired (currently unmet) behavior; it is expected to fail until
 * `enrollUsers` (or the assign page) is given the same reviewRequired guard
 * `publishCourse` already has.
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
  sendCourseLaunchEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('hashed-password') },
  hash: vi.fn().mockResolvedValue('hashed-password'),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));

import { enrollUsers } from './enrollment';

const ADMIN_ID = 'admin-001';
const ADMIN_ORG_USER_ID = 'ou-admin-001';
const ORG_ID = 'org-001';
const COURSE_ID = 'held-course-001';
const STAFF_EMAIL = 'staff@example.com';

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

describe('enrollUsers — F-051 review-gate bypass via the direct assign path (product defect)', () => {
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
    prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
    prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });
  });

  it("must refuse to enroll into a review-required (F-051-held) course, mirroring publishCourse's own gate", async () => {
    prismaMock.course.findUnique.mockResolvedValue(reviewRequiredCourse);

    // Desired behavior: enrollUsers refuses a course the quality gate is
    // still holding, the same way publishCourse does. Today it does not —
    // this assertion is expected to FAIL, proving the gap end to end
    // (enrollment.create IS invoked despite reviewRequired: true).
    await expect(enrollUsers(COURSE_ID, [{ email: STAFF_EMAIL }])).rejects.toThrow(
      /review|not published|draft/i,
    );
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });
});
