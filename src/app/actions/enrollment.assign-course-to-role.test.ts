/**
 * Unit tests for assignCourseToRole (Phase 2 Issue #4 / TC-016).
 *
 * Per-user enrollment creation is delegated to createEnrollmentForUser (mocked
 * here — its own internals are covered by src/lib/enrollment/create.test.ts),
 * so these tests focus on what's specific to assignCourseToRole: enrolling
 * only CURRENT holders of the targeted role in the caller's own org, rejecting
 * an absolute dueAt for role targets, and the upsert (not duplicate) of the
 * underlying CourseAssignment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockCourseFindUnique,
  mockUserFindUnique,
  mockUserFindMany,
  mockOfferingFindUnique,
  mockOfferingUpsert,
  mockAssignmentFindFirst,
  mockAssignmentCreate,
  mockAssignmentUpdate,
  mockStageUpsert,
  mockRevalidate,
  mockCreateEnrollmentForUser,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindUnique: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserFindMany: vi.fn(),
  mockOfferingFindUnique: vi.fn(),
  mockOfferingUpsert: vi.fn(),
  mockAssignmentFindFirst: vi.fn(),
  mockAssignmentCreate: vi.fn(),
  mockAssignmentUpdate: vi.fn(),
  mockStageUpsert: vi.fn(),
  mockRevalidate: vi.fn(),
  mockCreateEnrollmentForUser: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findUnique: mockCourseFindUnique },
    user: { findUnique: mockUserFindUnique, findMany: mockUserFindMany },
    orgCourseOffering: { findUnique: mockOfferingFindUnique, upsert: mockOfferingUpsert },
    courseAssignment: {
      findFirst: mockAssignmentFindFirst,
      create: mockAssignmentCreate,
      update: mockAssignmentUpdate,
    },
    assignmentReminderStage: { upsert: mockStageUpsert },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/enrollment/create', () => ({
  createEnrollmentForUser: mockCreateEnrollmentForUser,
}));
vi.mock('@/lib/enrollment/role-targets', () => ({
  enrollUserForRoleTargets: vi.fn(),
}));

import { assignCourseToRole } from './enrollment';

const ORG_ID = 'org-1';
const ADMIN_ID = 'admin-1';

const ownCourse = {
  id: 'course-1',
  title: 'Infection Control',
  createdBy: ADMIN_ID,
  isGlobal: false,
  type: 'document',
};

const adminUser = {
  id: ADMIN_ID,
  role: 'owner',
  organizationId: ORG_ID,
  organization: {
    id: ORG_ID,
    name: 'Acme Corp',
    subscription: { status: 'active', pausedAt: null },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue({ user: { id: ADMIN_ID } });
  mockWorkerAuth.mockResolvedValue(null);
  mockCourseFindUnique.mockResolvedValue(ownCourse);
  mockUserFindUnique.mockResolvedValue(adminUser);
  mockAssignmentFindFirst.mockResolvedValue(null);
  mockAssignmentCreate.mockResolvedValue({ id: 'assignment-role-1' });
  mockUserFindMany.mockResolvedValue([]);
  mockCreateEnrollmentForUser.mockResolvedValue({
    status: 'enrolled',
    email: 'nurse@test.com',
    userId: 'nurse-1',
    enrollmentId: 'enrollment-1',
  });
});

describe('assignCourseToRole — enrolls only current holders of the role, in the caller org', () => {
  it('enrolls every current holder of the targeted role', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'nurse-1', email: 'nurse1@test.com' },
      { id: 'nurse-2', email: 'nurse2@test.com' },
    ]);

    const result = await assignCourseToRole('course-1', 'nurse');

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG_ID, role: 'nurse' } }),
    );
    expect(mockCreateEnrollmentForUser).toHaveBeenCalledTimes(2);
    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'nurse1@test.com' },
      expect.objectContaining({ assignmentId: 'assignment-role-1', courseId: 'course-1' }),
    );
    expect(result).toEqual(expect.objectContaining({ targetRole: 'nurse', holderCount: 2 }));
  });

  it('scopes the holder query to the caller organizationId — never cross-org', async () => {
    await assignCourseToRole('course-1', 'nurse');

    const call = mockUserFindMany.mock.calls[0][0];
    expect(call.where.organizationId).toBe(ORG_ID);
  });

  it('rejects an unrecognized role value', async () => {
    await expect(assignCourseToRole('course-1', 'not-a-real-role' as never)).rejects.toThrow(
      'Invalid role',
    );
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it('rejects a non-admin caller', async () => {
    mockUserFindUnique.mockResolvedValue({ ...adminUser, role: 'nurse' });

    await expect(assignCourseToRole('course-1', 'nurse')).rejects.toThrow('Forbidden');
    expect(mockAssignmentCreate).not.toHaveBeenCalled();
  });
});

describe('assignCourseToRole — role-target assignments never carry an absolute dueAt', () => {
  it('always persists dueAt: null on the CourseAssignment, ignoring any dueAt-shaped input', async () => {
    await assignCourseToRole('course-1', 'nurse', {
      dueWindowDays: 21,
    } as Parameters<typeof assignCourseToRole>[2]);

    expect(mockAssignmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dueAt: null, targetRole: 'nurse', dueWindowDays: 21 }),
      }),
    );
  });

  it('computes each holder deadline from dueWindowDays via createEnrollmentForUser, never an absolute dueAt', async () => {
    mockUserFindMany.mockResolvedValue([{ id: 'nurse-1', email: 'nurse1@test.com' }]);

    await assignCourseToRole('course-1', 'nurse', { dueWindowDays: 14 });

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'nurse1@test.com' },
      expect.objectContaining({ assignmentDueAt: null, assignmentWindowDays: 14 }),
    );
  });
});

describe('assignCourseToRole — upserts the CourseAssignment rather than duplicating', () => {
  it('updates the existing assignment (setting targetRole) when one already exists for (org, course)', async () => {
    mockAssignmentFindFirst.mockResolvedValue({ id: 'existing-assignment-1' });

    const result = await assignCourseToRole('course-1', 'nurse');

    expect(mockAssignmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-assignment-1' },
        data: expect.objectContaining({ targetRole: 'nurse' }),
      }),
    );
    expect(mockAssignmentCreate).not.toHaveBeenCalled();
    expect(result.assignmentId).toBe('existing-assignment-1');
  });
});
