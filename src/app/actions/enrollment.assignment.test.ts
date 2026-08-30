import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockWorkerAuth,
  mockRevalidate,
  mockCourseFindUnique,
  mockUserFindUnique,
  mockOrgUserFindFirst,
  mockOfferingFindUnique,
  mockOfferingUpsert,
  mockAssignmentCreate,
  mockAssignmentFindFirst,
  mockAssignmentUpdate,
  mockStageUpsert,
  mockEnrollmentFindFirst,
  mockEnrollmentCreate,
  mockReminderLogCreate,
  mockNotificationCreate,
  mockOrganizationFindUnique,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockRevalidate: vi.fn(),
  mockCourseFindUnique: vi.fn(),
  // Staff-email lookup inside createEnrollmentForUser (@/lib/enrollment/create) —
  // NOT a "current user" fetch; the session carries the caller's own role/org
  // context directly post User/OrganizationUser split.
  mockUserFindUnique: vi.fn(),
  mockOrgUserFindFirst: vi.fn(),
  mockOfferingFindUnique: vi.fn(),
  mockOfferingUpsert: vi.fn(),
  mockAssignmentCreate: vi.fn(),
  mockAssignmentFindFirst: vi.fn(),
  mockAssignmentUpdate: vi.fn(),
  mockStageUpsert: vi.fn(),
  mockEnrollmentFindFirst: vi.fn(),
  mockEnrollmentCreate: vi.fn(),
  mockReminderLogCreate: vi.fn(),
  mockNotificationCreate: vi.fn(),
  mockOrganizationFindUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findUnique: mockCourseFindUnique },
    user: { findUnique: mockUserFindUnique },
    // Membership lookup for the staff email (createEnrollmentForUser) and the
    // seat-gate's existing-member dedup both key off OrganizationUser now.
    organizationUser: { findFirst: mockOrgUserFindFirst, findMany: vi.fn().mockResolvedValue([]) },
    orgCourseOffering: { findUnique: mockOfferingFindUnique, upsert: mockOfferingUpsert },
    courseAssignment: {
      create: mockAssignmentCreate,
      findFirst: mockAssignmentFindFirst,
      update: mockAssignmentUpdate,
    },
    assignmentReminderStage: { upsert: mockStageUpsert },
    enrollment: { findFirst: mockEnrollmentFindFirst, create: mockEnrollmentCreate },
    // Added in facility split: enrollUsers resolves facilityId for new users.
    facility: { findFirst: vi.fn().mockResolvedValue(null) },
    // Facility stamped on each created enrollment (resolveMemberFacilityId).
    organizationUserFacility: { findFirst: vi.fn().mockResolvedValue(null) },
    reminderLog: { create: mockReminderLogCreate },
    invite: { findMany: vi.fn().mockResolvedValue([]) },
    // Seat gate (F-022): enrollUsers now calls getSeatUsage(organizationId, ...)
    // unconditionally when the caller has an org. The subscription below has no
    // recognized `plan` value, so getSeatUsage's BILLING_PLANS lookup misses and
    // it returns staffMax: null (a no-op) — none of these tests are focused on
    // the seat gate itself (see enrollment.test.ts for that). This same
    // organization.findUnique mock also backs the outer billing gate, which
    // DOES require an active, unpaused subscription to proceed.
    organization: {
      findUnique: mockOrganizationFindUnique,
    },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./notifications', () => ({
  createNotification: mockNotificationCreate,
  notifyOrganizationAdmins: vi.fn(),
}));
vi.mock('@/lib/email', () => ({
  sendCourseInviteEmail: vi.fn(),
  sendCourseLaunchEmail: vi.fn(),
}));

import { enrollUsers } from './enrollment';

const ADMIN_ORG_USER_ID = 'ou-admin-1';

beforeEach(() => {
  vi.clearAllMocks();
  // Post User/OrganizationUser split: the session carries role/org context
  // directly. 'owner' is the admin-equivalent role after the RBAC ruling.
  mockAuth.mockResolvedValue({
    user: {
      id: 'admin-1',
      organizationUserId: ADMIN_ORG_USER_ID,
      organizationId: 'org-1',
      role: 'owner',
    },
  });
  mockWorkerAuth.mockResolvedValue(null);
  mockCourseFindUnique.mockResolvedValue({
    id: 'course-1',
    title: 'Course',
    createdByOrgUserId: ADMIN_ORG_USER_ID,
    creator: { organizationId: 'org-1' },
    isGlobal: false,
  });
  // Defect B billing gate: enrollUsers now requires active, unpaused billing —
  // without this the gate throws before reaching the assignment-batch logic
  // under test here. No `plan` field, so the seat gate (getSeatUsage) treats
  // this as an unenforced/no-op plan.
  mockOrganizationFindUnique.mockResolvedValue({
    name: 'Org',
    subscription: { status: 'active', pausedAt: null },
  });
  // createEnrollmentForUser's own staff-email lookup + membership check.
  mockUserFindUnique.mockResolvedValue({
    id: 'worker-1',
    firstName: null,
    lastName: null,
    fullName: 'W',
  });
  mockOrgUserFindFirst.mockResolvedValue({ id: 'ou-worker-1' });
  // No prior assignment for this (org, course) — upsertCourseAssignment takes the create branch.
  mockAssignmentFindFirst.mockResolvedValue(null);
  mockAssignmentCreate.mockResolvedValue({ id: 'assignment-1' });
  mockEnrollmentFindFirst.mockResolvedValue(null);
  mockEnrollmentCreate.mockResolvedValue({ id: 'enroll-1' });
  mockReminderLogCreate.mockResolvedValue({ id: 'log-1' });
  mockOfferingFindUnique.mockResolvedValue(null);
  mockOfferingUpsert.mockResolvedValue({ id: 'offering-1' });
});

describe('enrollUsers assignment batch', () => {
  it('creates a CourseAssignment and links the enrollment to it', async () => {
    await enrollUsers('course-1', [{ email: 'w@x.com' }], {
      scheduleAt: '2026-09-12T00:00:00.000Z',
      renewalCycle: 'annual',
      remindersEnabled: true,
      stages: [{ stage: 'FRIENDLY_REMINDER', offsetDays: -14, enabled: true, channels: ['email'] }],
    });

    expect(mockAssignmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          courseId: 'course-1',
          renewalCycle: 'annual',
          remindersEnabled: true,
          reminderStages: {
            create: [
              { stage: 'FRIENDLY_REMINDER', offsetDays: -14, enabled: true, channels: ['email'] },
            ],
          },
        }),
      }),
    );
    expect(mockEnrollmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignmentId: 'assignment-1' }),
      }),
    );
  });

  it('allows assigning a global published catalog course and creates the org offering', async () => {
    // A catalog course created by the system back-office user, which the
    // admin's org has not yet offered. The admin reaches Assign straight from
    // the catalog, so no offering exists yet.
    mockCourseFindUnique.mockResolvedValue({
      id: 'course-2',
      title: 'Catalog Course',
      createdByOrgUserId: 'ou-system-user',
      creator: { organizationId: 'org-platform' },
      isGlobal: true,
      status: 'published',
    });
    mockOfferingFindUnique.mockResolvedValue(null);

    await enrollUsers('course-2', [{ email: 'w@x.com' }]);

    // The enrollment goes through (no "Course not found" throw)...
    expect(mockEnrollmentCreate).toHaveBeenCalled();
    // ...and the org now has an offering for the catalog course.
    expect(mockOfferingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_courseId: { organizationId: 'org-1', courseId: 'course-2' } },
        create: expect.objectContaining({
          organizationId: 'org-1',
          courseId: 'course-2',
          addedByAdminId: 'admin-1',
        }),
      }),
    );
  });
});

describe('enrollUsers — upsert path (Issue #5 / TC-018): re-submitting settings updates, never duplicates', () => {
  beforeEach(() => {
    mockAssignmentFindFirst.mockResolvedValue({ id: 'existing-assignment-1' });
    mockAssignmentUpdate.mockResolvedValue({ id: 'existing-assignment-1' });
    mockStageUpsert.mockResolvedValue({});
  });

  it('updates the existing CourseAssignment + stage rows instead of creating a new one', async () => {
    await enrollUsers('course-1', [{ email: 'w@x.com' }], {
      renewalCycle: 'annual',
      remindersEnabled: false,
      stages: [{ stage: 'FRIENDLY_REMINDER', offsetDays: -10, enabled: true, channels: ['email'] }],
    });

    expect(mockAssignmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-assignment-1' },
        data: expect.objectContaining({ renewalCycle: 'annual', remindersEnabled: false }),
      }),
    );
    expect(mockStageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assignmentId_stage: { assignmentId: 'existing-assignment-1', stage: 'FRIENDLY_REMINDER' },
        },
        update: { offsetDays: -10, enabled: true, channels: ['email'] },
      }),
    );
    // No duplicate CourseAssignment row created.
    expect(mockAssignmentCreate).not.toHaveBeenCalled();
  });

  it('links the enrollment to the EXISTING assignment id on re-submit, not a fresh one', async () => {
    await enrollUsers('course-1', [{ email: 'w@x.com' }]);

    expect(mockEnrollmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignmentId: 'existing-assignment-1' }),
      }),
    );
  });
});

describe('enrollUsers — assignmentSettingsMode: "preserve" (multi-course staff assignment)', () => {
  it('links the existing CourseAssignment without touching its settings or stage rows, while the deadline still reaches the worker Enrollment.dueAt', async () => {
    mockAssignmentFindFirst.mockResolvedValue({
      id: 'existing-assignment-1',
      renewalCycle: 'annual',
      remindersEnabled: false,
    });

    const chosenDeadline = '2027-01-01T00:00:00.000Z';
    await enrollUsers(
      'course-1',
      [{ email: 'w@x.com' }],
      { dueAt: chosenDeadline },
      { assignmentSettingsMode: 'preserve' },
    );

    // The shared org-wide row is neither updated nor upserted...
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    expect(mockStageUpsert).not.toHaveBeenCalled();
    expect(mockAssignmentCreate).not.toHaveBeenCalled();
    // ...it is simply linked...
    expect(mockEnrollmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignmentId: 'existing-assignment-1' }),
      }),
    );
    // ...while the worker's own enrollment still gets the admin's chosen deadline.
    expect(mockEnrollmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dueAt: new Date(chosenDeadline) }),
      }),
    );
  });

  it('creates a fresh CourseAssignment from the supplied settings when none exists yet — nothing to preserve', async () => {
    mockAssignmentFindFirst.mockResolvedValue(null);

    await enrollUsers(
      'course-1',
      [{ email: 'w@x.com' }],
      { dueAt: '2027-01-01T00:00:00.000Z', renewalCycle: 'annual' },
      { assignmentSettingsMode: 'preserve' },
    );

    expect(mockAssignmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ renewalCycle: 'annual' }) }),
    );
  });

  it('defaults to "write" (today\'s overwrite behaviour) when assignmentSettingsMode is omitted', async () => {
    mockAssignmentFindFirst.mockResolvedValue({ id: 'existing-assignment-1' });

    await enrollUsers('course-1', [{ email: 'w@x.com' }], { renewalCycle: 'annual' });

    expect(mockAssignmentUpdate).toHaveBeenCalled();
  });
});

describe('enrollUsers — defaultStageRows() seeding (Issue #8 / TC-024)', () => {
  it('seeds exactly the 5 SWEEP_STAGES rows, never ADMIN_PRE_DEADLINE_REMINDER, when no explicit stages are given', async () => {
    await enrollUsers('course-1', [{ email: 'w@x.com' }]); // no assignmentSettings.stages

    const call = mockAssignmentCreate.mock.calls[0][0];
    const seededStages = call.data.reminderStages.create.map((row: { stage: string }) => row.stage);

    expect(seededStages).toEqual([
      'FRIENDLY_REMINDER',
      'URGENT_REMINDER',
      'DAY_OF_DEADLINE',
      'GRACE_SOFT_ESCALATION',
      'HARD_ESCALATION',
    ]);
    expect(seededStages).not.toContain('ADMIN_PRE_DEADLINE_REMINDER');
    expect(seededStages).not.toContain('INITIAL_LAUNCH');
  });
});
