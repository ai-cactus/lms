import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockWorkerAuth,
  mockRevalidate,
  mockCourseFindUnique,
  mockUserFindUnique,
  mockOfferingFindUnique,
  mockOfferingUpsert,
  mockAssignmentCreate,
  mockEnrollmentFindFirst,
  mockEnrollmentCreate,
  mockReminderLogCreate,
  mockNotificationCreate,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockRevalidate: vi.fn(),
  mockCourseFindUnique: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockOfferingFindUnique: vi.fn(),
  mockOfferingUpsert: vi.fn(),
  mockAssignmentCreate: vi.fn(),
  mockEnrollmentFindFirst: vi.fn(),
  mockEnrollmentCreate: vi.fn(),
  mockReminderLogCreate: vi.fn(),
  mockNotificationCreate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findUnique: mockCourseFindUnique },
    user: { findUnique: mockUserFindUnique },
    orgCourseOffering: { findUnique: mockOfferingFindUnique, upsert: mockOfferingUpsert },
    courseAssignment: { create: mockAssignmentCreate },
    enrollment: { findFirst: mockEnrollmentFindFirst, create: mockEnrollmentCreate },
    // Added in facility split: enrollUsers resolves facilityId for new users.
    facility: { findFirst: vi.fn().mockResolvedValue(null) },
    reminderLog: { create: mockReminderLogCreate },
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
  sendCourseEnrollmentEmail: vi.fn(),
  sendCourseLaunchEmail: vi.fn(),
}));

import { enrollUsers } from './enrollment';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } });
  mockWorkerAuth.mockResolvedValue(null);
  mockCourseFindUnique.mockResolvedValue({
    id: 'course-1',
    title: 'Course',
    createdBy: 'admin-1',
    isGlobal: false,
  });
  mockUserFindUnique
    .mockResolvedValueOnce({
      id: 'admin-1',
      // After RBAC migration: 'admin' is retired; 'owner' is an admin role.
      role: 'owner',
      organizationId: 'org-1',
      // Defect B billing gate: enrollUsers now requires active, unpaused
      // billing — without this the gate throws before reaching the
      // assignment-batch logic under test here.
      organization: { name: 'Org', subscription: { status: 'active', pausedAt: null } },
    })
    .mockResolvedValue({ id: 'worker-1', email: 'w@x.com', profile: { fullName: 'W' } });
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
      createdBy: 'system-user',
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
