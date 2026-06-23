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
  mockNotificationCreate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findUnique: mockCourseFindUnique },
    user: { findUnique: mockUserFindUnique },
    orgCourseOffering: { findUnique: mockOfferingFindUnique, upsert: mockOfferingUpsert },
    courseAssignment: { create: mockAssignmentCreate },
    enrollment: { findFirst: mockEnrollmentFindFirst, create: mockEnrollmentCreate },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('./notifications', () => ({
  createNotification: mockNotificationCreate,
  notifyOrganizationAdmins: vi.fn(),
}));
vi.mock('@/lib/email', () => ({
  sendCourseInviteEmail: vi.fn(),
  sendCourseEnrollmentEmail: vi.fn(),
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
      role: 'admin',
      organizationId: 'org-1',
      organization: { name: 'Org' },
    })
    .mockResolvedValue({ id: 'worker-1', email: 'w@x.com', profile: { fullName: 'W' } });
  mockAssignmentCreate.mockResolvedValue({ id: 'assignment-1' });
  mockEnrollmentFindFirst.mockResolvedValue(null);
  mockEnrollmentCreate.mockResolvedValue({ id: 'enroll-1' });
  mockOfferingFindUnique.mockResolvedValue(null);
  mockOfferingUpsert.mockResolvedValue({ id: 'offering-1' });
});

describe('enrollUsers assignment batch', () => {
  it('creates a CourseAssignment and links the enrollment to it', async () => {
    await enrollUsers('course-1', [{ email: 'w@x.com' }], {
      scheduleAt: '2026-09-12T00:00:00.000Z',
      renewalCycle: 'annual',
      reminders: [{ offsetMinutes: 30 }],
    });

    expect(mockAssignmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          courseId: 'course-1',
          renewalCycle: 'annual',
          reminders: { create: [{ offsetMinutes: 30, channel: 'email' }] },
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
