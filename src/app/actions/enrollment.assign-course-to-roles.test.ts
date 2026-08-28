/**
 * Unit tests for assignCourseToRoles — the course wizard's multi-role publish
 * path (Phase 9).
 *
 * Per-user enrollment creation is delegated to createEnrollmentForUser (mocked
 * here — its internals are covered by src/lib/enrollment/create.test.ts), so
 * these tests focus on what is specific to the multi-role action: the permission
 * gate, the union of role holders it enrolls, the `targetRoles` (+ legacy
 * `targetRole`) columns it writes, the deadline precedence, the reminder ladder
 * it derives from the wizard's day-offsets, and the renewal cycle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockCourseFindUnique,
  mockOrganizationFindUnique,
  mockOrgUserFindMany,
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
  mockOrganizationFindUnique: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
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
    organization: { findUnique: mockOrganizationFindUnique },
    organizationUser: { findMany: mockOrgUserFindMany },
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

import { assignCourseToRoles } from './enrollment';

const ORG_ID = 'org-1';
const ADMIN_ID = 'admin-1';
const ADMIN_ORG_USER_ID = 'ou-admin-1';

const ownCourse = {
  id: 'course-1',
  title: 'Infection Control',
  createdByOrgUserId: ADMIN_ORG_USER_ID,
  isGlobal: false,
  type: 'document',
};

function adminSession(role = 'owner') {
  return {
    user: { id: ADMIN_ID, organizationUserId: ADMIN_ORG_USER_ID, organizationId: ORG_ID, role },
  };
}

/** The `data` the CourseAssignment was created with. */
function createdAssignmentData() {
  return mockAssignmentCreate.mock.calls[0][0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(adminSession());
  mockWorkerAuth.mockResolvedValue(null);
  mockCourseFindUnique.mockResolvedValue(ownCourse);
  mockOrganizationFindUnique.mockResolvedValue({
    name: 'Acme Corp',
    subscription: { status: 'active', pausedAt: null },
  });
  mockAssignmentFindFirst.mockResolvedValue(null);
  mockAssignmentCreate.mockResolvedValue({ id: 'assignment-roles-1' });
  mockOrgUserFindMany.mockResolvedValue([]);
  mockCreateEnrollmentForUser.mockImplementation(async (entry: { email: string }) => ({
    status: 'enrolled',
    email: entry.email,
    userId: 'user-1',
    enrollmentId: 'enrollment-1',
  }));
});

describe('assignCourseToRoles — authorization and input', () => {
  it('rejects a caller without assignment.create', async () => {
    mockAdminAuth.mockResolvedValue(adminSession('nurse'));

    await expect(assignCourseToRoles('course-1', ['nurse'])).rejects.toThrow('Forbidden');
    expect(mockAssignmentCreate).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller', async () => {
    mockAdminAuth.mockResolvedValue(null);

    await expect(assignCourseToRoles('course-1', ['nurse'])).rejects.toThrow('Unauthorized');
  });

  it('rejects an empty role list', async () => {
    await expect(assignCourseToRoles('course-1', [])).rejects.toThrow(
      'At least one role is required',
    );
    expect(mockOrgUserFindMany).not.toHaveBeenCalled();
  });

  it('rejects a list containing an unrecognized role', async () => {
    await expect(
      assignCourseToRoles('course-1', ['nurse', 'not-a-real-role' as never]),
    ).rejects.toThrow('Invalid role');
    expect(mockOrgUserFindMany).not.toHaveBeenCalled();
  });

  it('refuses an unparseable deadline', async () => {
    const result = await assignCourseToRoles('course-1', ['nurse'], { dueDate: 'not-a-date' });

    expect(result.refusedReason).toBe(
      "That completion deadline couldn't be read. Please pick the date again.",
    );
    expect(result.assignmentId).toBeNull();
    expect(mockOrgUserFindMany).not.toHaveBeenCalled();
  });
});

describe('assignCourseToRoles — role targeting', () => {
  it('persists every targeted role, keeping the legacy single-value column on the first', async () => {
    await assignCourseToRoles('course-1', ['hr', 'nurse']);

    expect(createdAssignmentData()).toMatchObject({
      targetRoles: ['hr', 'nurse'],
      targetRole: 'hr',
    });
  });

  it('deduplicates a repeated role before writing and enrolling', async () => {
    const result = await assignCourseToRoles('course-1', ['nurse', 'nurse', 'hr']);

    expect(createdAssignmentData().targetRoles).toEqual(['nurse', 'hr']);
    expect(mockOrgUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, role: { in: ['nurse', 'hr'] }, active: true },
      }),
    );
    expect(result.targetRoles).toEqual(['nurse', 'hr']);
  });

  it('updates the org existing assignment rather than creating a second one', async () => {
    mockAssignmentFindFirst.mockResolvedValue({ id: 'existing-assignment-1' });

    const result = await assignCourseToRoles('course-1', ['nurse', 'hr']);

    expect(mockAssignmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-assignment-1' },
        data: expect.objectContaining({ targetRoles: ['nurse', 'hr'], targetRole: 'nurse' }),
      }),
    );
    expect(mockAssignmentCreate).not.toHaveBeenCalled();
    expect(result.assignmentId).toBe('existing-assignment-1');
  });

  it('scopes the holder query to the caller organization — never cross-org', async () => {
    await assignCourseToRoles('course-1', ['nurse']);

    expect(mockOrgUserFindMany.mock.calls[0][0].where.organizationId).toBe(ORG_ID);
  });
});

describe('assignCourseToRoles — enrolls the union of the targeted roles current holders', () => {
  it('enrolls every current holder across all targeted roles', async () => {
    mockOrgUserFindMany.mockResolvedValue([
      { id: 'ou-nurse-1', user: { email: 'nurse1@test.com' } },
      { id: 'ou-nurse-2', user: { email: 'nurse2@test.com' } },
      { id: 'ou-hr-1', user: { email: 'hr1@test.com' } },
    ]);

    const result = await assignCourseToRoles('course-1', ['nurse', 'hr']);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledTimes(3);
    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'hr1@test.com' },
      expect.objectContaining({ assignmentId: 'assignment-roles-1', courseId: 'course-1' }),
    );
    expect(result).toMatchObject({ holderCount: 3, enrolled: 3, alreadyEnrolled: 0, failed: 0 });
  });

  it('counts an already-enrolled holder separately instead of re-enrolling them', async () => {
    mockOrgUserFindMany.mockResolvedValue([
      { id: 'ou-nurse-1', user: { email: 'nurse1@test.com' } },
      { id: 'ou-hr-1', user: { email: 'hr1@test.com' } },
    ]);
    mockCreateEnrollmentForUser.mockImplementation(async (entry: { email: string }) => ({
      status: entry.email === 'hr1@test.com' ? 'alreadyEnrolled' : 'enrolled',
      email: entry.email,
    }));

    const result = await assignCourseToRoles('course-1', ['nurse', 'hr']);

    expect(result).toMatchObject({ enrolled: 1, alreadyEnrolled: 1, failed: 0 });
  });
});

describe('assignCourseToRoles — deadline precedence', () => {
  it('uses the explicit due date + time as the assignment deadline for every holder', async () => {
    mockOrgUserFindMany.mockResolvedValue([
      { id: 'ou-nurse-1', user: { email: 'nurse1@test.com' } },
    ]);

    await assignCourseToRoles('course-1', ['nurse'], {
      dueDate: '2026-03-01',
      dueTime: '5:00 PM',
      dueWindowDays: 30,
    });

    const expected = new Date('2026-03-01T17:00:00.000Z');
    expect(createdAssignmentData().dueAt).toEqual(expected);
    // The window is still persisted as the fallback for anyone enrolled without
    // the absolute date.
    expect(createdAssignmentData().dueWindowDays).toBe(30);
    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'nurse1@test.com' },
      expect.objectContaining({ assignmentDueAt: expected, assignmentWindowDays: 30 }),
    );
  });

  it('falls back to the course completion window when no due date was set', async () => {
    mockOrgUserFindMany.mockResolvedValue([
      { id: 'ou-nurse-1', user: { email: 'nurse1@test.com' } },
    ]);

    await assignCourseToRoles('course-1', ['nurse'], { dueWindowDays: 14 });

    expect(createdAssignmentData()).toMatchObject({ dueAt: null, dueWindowDays: 14 });
    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'nurse1@test.com' },
      expect.objectContaining({ assignmentDueAt: null, assignmentWindowDays: 14 }),
    );
  });
});

describe('assignCourseToRoles — reminder ladder and renewal', () => {
  it('maps the wizard day-offsets onto the ladder, furthest-out first', async () => {
    await assignCourseToRoles('course-1', ['nurse'], { reminderDaysBefore: [7, 3, 1] });

    const stages = createdAssignmentData().reminderStages.create;
    expect(stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'FRIENDLY_REMINDER', offsetDays: -7, enabled: true }),
        expect.objectContaining({ stage: 'URGENT_REMINDER', offsetDays: -3, enabled: true }),
        expect.objectContaining({ stage: 'DAY_OF_DEADLINE', offsetDays: -1, enabled: true }),
      ]),
    );
  });

  it('seeds the canonical ladder when the caller supplies no reminder rows', async () => {
    await assignCourseToRoles('course-1', ['nurse']);

    const stages = createdAssignmentData().reminderStages.create;
    expect(stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'FRIENDLY_REMINDER', offsetDays: -14, enabled: true }),
      ]),
    );
  });

  it('turns the whole ladder off when reminders are disabled', async () => {
    await assignCourseToRoles('course-1', ['nurse'], {
      remindersEnabled: false,
      reminderDaysBefore: [],
    });

    expect(createdAssignmentData().remindersEnabled).toBe(false);
  });

  it('persists the recurring interval, defaulting to no renewal', async () => {
    await assignCourseToRoles('course-1', ['nurse'], { renewalCycle: 'annual' });
    expect(createdAssignmentData().renewalCycle).toBe('annual');

    mockAssignmentCreate.mockClear();
    await assignCourseToRoles('course-1', ['nurse']);
    expect(createdAssignmentData().renewalCycle).toBe('none');
  });
});
