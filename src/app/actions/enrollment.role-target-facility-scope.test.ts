/**
 * Facility-scope wiring for the role-target assignment path
 * (assignCourseToRoles → assignCourseToRoleTargets, and getRoleHolderCounts).
 *
 * The narrowing here is what makes `enrollment.create` safe to grant a
 * facility-bound supervisor: unscoped, assigning to "nurse" would enroll every
 * nurse in the organisation. Two invariants matter most:
 *
 *  - The SAME resolved facility scope is used to (a) filter which current
 *    holders get enrolled immediately AND (b) persist onto the
 *    CourseAssignment row (facilityScoped/facilityIds), so the live
 *    auto-enroll hook and nightly sweep inherit exactly this reach.
 *  - getRoleHolderCounts (the pre-flight count the assign UI shows) must
 *    narrow identically, or it promises a smaller number than the mutation
 *    performs.
 *  - Org-wide roles get byte-identical queries: no facility predicate at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockWorkerAuth,
  mockCourseFindUnique,
  mockUserFindUnique,
  mockOrgUserFindFirst,
  mockOrgUserFindMany,
  mockOrgUserGroupBy,
  mockOfferingFindUnique,
  mockOfferingUpsert,
  mockAssignmentCreate,
  mockAssignmentFindFirst,
  mockStageUpsert,
  mockEnrollmentFindFirst,
  mockEnrollmentCreate,
  mockReminderLogCreate,
  mockOrganizationFindUnique,
  mockListAccessibleFacilities,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindUnique: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockOrgUserFindFirst: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
  mockOrgUserGroupBy: vi.fn(),
  mockOfferingFindUnique: vi.fn(),
  mockOfferingUpsert: vi.fn(),
  mockAssignmentCreate: vi.fn(),
  mockAssignmentFindFirst: vi.fn(),
  mockStageUpsert: vi.fn(),
  mockEnrollmentFindFirst: vi.fn(),
  mockEnrollmentCreate: vi.fn(),
  mockReminderLogCreate: vi.fn(),
  mockOrganizationFindUnique: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findUnique: mockCourseFindUnique },
    user: { findUnique: mockUserFindUnique },
    organizationUser: {
      findFirst: mockOrgUserFindFirst,
      findMany: mockOrgUserFindMany,
      groupBy: mockOrgUserGroupBy,
    },
    orgCourseOffering: { findUnique: mockOfferingFindUnique, upsert: mockOfferingUpsert },
    courseAssignment: { create: mockAssignmentCreate, findFirst: mockAssignmentFindFirst },
    assignmentReminderStage: { upsert: mockStageUpsert },
    enrollment: { findFirst: mockEnrollmentFindFirst, create: mockEnrollmentCreate },
    facility: { findFirst: vi.fn().mockResolvedValue(null) },
    organizationUserFacility: { findFirst: vi.fn().mockResolvedValue(null) },
    reminderLog: { create: mockReminderLogCreate },
    invite: { findMany: vi.fn().mockResolvedValue([]) },
    organization: { findUnique: mockOrganizationFindUnique },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./notifications', () => ({
  createNotification: vi.fn(),
  notifyOrganizationAdmins: vi.fn(),
}));
vi.mock('@/lib/email', () => ({
  sendCourseInviteEmail: vi.fn(),
  sendCourseLaunchEmail: vi.fn(),
}));
// isOrgWideFacilityRole kept real (pure role-list lookup) so the org-wide vs
// facility-bound split under test is genuine, not stubbed.
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { assignCourseToRoles, getRoleHolderCounts } from './enrollment';

const ORG_ID = 'org-1';
const ADMIN_ORG_USER_ID = 'ou-admin-1';

function setSession(userId: string, role: string, organizationUserId = ADMIN_ORG_USER_ID) {
  mockAuth.mockResolvedValue({
    user: { id: userId, organizationUserId, organizationId: ORG_ID, role },
  });
  mockWorkerAuth.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSession('admin-1', 'owner');
  mockCourseFindUnique.mockResolvedValue({
    id: 'course-1',
    title: 'Infection Control',
    createdByOrgUserId: ADMIN_ORG_USER_ID,
    creator: { organizationId: ORG_ID },
    isGlobal: false,
    reviewRequired: false,
  });
  mockOrganizationFindUnique.mockResolvedValue({
    name: 'Acme Corp',
    subscription: { status: 'active', pausedAt: null },
  });
  mockAssignmentFindFirst.mockResolvedValue(null);
  mockAssignmentCreate.mockResolvedValue({ id: 'assignment-1' });
  mockOrgUserFindMany.mockResolvedValue([]);
  mockOrgUserGroupBy.mockResolvedValue([]);
  mockListAccessibleFacilities.mockResolvedValue([]);
});

describe('assignCourseToRoles — facility scope', () => {
  it('an ORG-WIDE role (owner) queries holders with NO facility predicate — byte-identical to the pre-scope shape', async () => {
    await assignCourseToRoles('course-1', ['nurse'], {});

    const where = mockOrgUserFindMany.mock.calls[0][0].where;
    expect(where).toEqual({
      organizationId: ORG_ID,
      role: { in: ['nurse'] },
      active: true,
    });
  });

  it('an ORG-WIDE role persists the assignment as org-wide (facilityScoped:false)', async () => {
    await assignCourseToRoles('course-1', ['nurse'], {});

    const data = mockAssignmentCreate.mock.calls[0][0].data;
    expect(data.facilityScoped).toBe(false);
    expect(data.facilityIds).toEqual([]);
  });

  it('a FACILITY-BOUND role (supervisor) narrows the holder query to its accessible facilities', async () => {
    setSession('supervisor-1', 'supervisor');
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);

    await assignCourseToRoles('course-1', ['nurse'], {});

    const where = mockOrgUserFindMany.mock.calls[0][0].where;
    expect(where).toEqual({
      organizationId: ORG_ID,
      role: { in: ['nurse'] },
      active: true,
      facilities: { some: { facilityId: { in: ['fac-1'] }, active: true } },
    });
  });

  it('a FACILITY-BOUND role persists the SAME facility scope onto the assignment row, so later auto-enrolment inherits it', async () => {
    setSession('supervisor-1', 'supervisor');
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }, { id: 'fac-2' }]);

    await assignCourseToRoles('course-1', ['nurse'], {});

    const data = mockAssignmentCreate.mock.calls[0][0].data;
    expect(data.facilityScoped).toBe(true);
    expect(data.facilityIds).toEqual(['fac-1', 'fac-2']);
  });

  it('FAIL-CLOSED: a facility-bound role with NO accessible facilities narrows to an impossible `in: []`, and the count is 0', async () => {
    setSession('supervisor-1', 'supervisor');
    mockListAccessibleFacilities.mockResolvedValue([]);
    mockOrgUserFindMany.mockResolvedValue([]); // what an `in: []` predicate would genuinely return

    const result = await assignCourseToRoles('course-1', ['nurse'], {});

    const where = mockOrgUserFindMany.mock.calls[0][0].where;
    expect(where.facilities).toEqual({ some: { facilityId: { in: [] }, active: true } });
    expect(result.holderCount).toBe(0);
    const data = mockAssignmentCreate.mock.calls[0][0].data;
    expect(data.facilityScoped).toBe(true);
    expect(data.facilityIds).toEqual([]);
  });
});

describe('getRoleHolderCounts — facility scope', () => {
  it('an ORG-WIDE role (owner) counts with NO facility predicate', async () => {
    await getRoleHolderCounts();

    const where = mockOrgUserGroupBy.mock.calls[0][0].where;
    expect(where).toEqual({ organizationId: ORG_ID, active: true });
  });

  it('a FACILITY-BOUND role (supervisor) narrows the count to its accessible facilities', async () => {
    setSession('supervisor-1', 'supervisor');
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);

    await getRoleHolderCounts();

    const where = mockOrgUserGroupBy.mock.calls[0][0].where;
    expect(where).toEqual({
      organizationId: ORG_ID,
      active: true,
      facilities: { some: { facilityId: { in: ['fac-1'] }, active: true } },
    });
  });

  it('FAIL-CLOSED: a facility-bound role with no accessible facilities narrows to an impossible `in: []`, never to the whole org', async () => {
    setSession('supervisor-1', 'supervisor');
    mockListAccessibleFacilities.mockResolvedValue([]);

    await getRoleHolderCounts();

    const where = mockOrgUserGroupBy.mock.calls[0][0].where;
    expect(where.facilities).toEqual({ some: { facilityId: { in: [] }, active: true } });
  });

  it('the SAME narrowing that assignCourseToRoles applies to its mutation — count and mutation stay in step', async () => {
    setSession('supervisor-1', 'supervisor');
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-9' }]);

    await getRoleHolderCounts();
    await assignCourseToRoles('course-1', ['nurse'], {});

    const countWhere = mockOrgUserGroupBy.mock.calls[0][0].where.facilities;
    const enrollWhere = mockOrgUserFindMany.mock.calls[0][0].where.facilities;
    expect(countWhere).toEqual(enrollWhere);
  });
});
