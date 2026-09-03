/**
 * Role-target assignments were WRITE-ONLY: the course wizard created them and
 * nothing in the app listed, edited or removed them. Because a role-target
 * assignment enrols everyone who GAINS the role later — live via
 * `enrollUserForRoleTargets` on all four account-creation paths, and again via
 * the nightly reconcile pre-pass — a brand-new staff account could arrive
 * already enrolled with no way for an admin to see why or stop it.
 *
 * These cover the two actions that close that gap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth, mockResolveDataFacilityIds } = vi.hoisted(() => ({
  prismaMock: {
    courseAssignment: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    enrollment: { groupBy: vi.fn() },
  },
  mockAdminAuth: vi.fn(),
  mockResolveDataFacilityIds: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));
vi.mock('@/lib/facility/staff-where', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/staff-where')>()),
  resolveDataFacilityIds: mockResolveDataFacilityIds,
}));

import { listRoleAssignments, revokeRoleAssignment } from './enrollment';

const ORG = 'org-1';

function session(role: string) {
  return {
    user: { id: 'u1', organizationId: ORG, organizationUserId: 'ou-1', role },
  };
}

const assignmentRow = {
  id: 'ca-1',
  courseId: 'course-1',
  targetRoles: ['nurse'],
  dueWindowDays: 30,
  facilityScoped: false,
  createdAt: new Date('2026-01-01'),
  course: { title: 'HIPAA Basics' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(session('owner'));
  mockResolveDataFacilityIds.mockResolvedValue(null);
  prismaMock.courseAssignment.findMany.mockResolvedValue([assignmentRow]);
  prismaMock.enrollment.groupBy.mockResolvedValue([{ assignmentId: 'ca-1', _count: { _all: 12 } }]);
  prismaMock.courseAssignment.findFirst.mockResolvedValue({ id: 'ca-1', courseId: 'course-1' });
  prismaMock.courseAssignment.update.mockResolvedValue({});
});

describe('listRoleAssignments', () => {
  it('returns only rows that still carry role targets, with their enrolled count', async () => {
    const rows = await listRoleAssignments();

    // A revoked row keeps its settings but empties targetRoles, so this
    // predicate is exactly "still auto-enrolling".
    expect(prismaMock.courseAssignment.findMany.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
      targetRoles: { isEmpty: false },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      courseTitle: 'HIPAA Basics',
      targetRoles: ['nurse'],
      enrolledCount: 12,
    });
  });

  it('counts enrolments in ONE grouped query, not one per assignment', async () => {
    prismaMock.courseAssignment.findMany.mockResolvedValue([
      assignmentRow,
      { ...assignmentRow, id: 'ca-2', course: { title: 'Fire Safety' } },
      { ...assignmentRow, id: 'ca-3', course: { title: 'Bloodborne' } },
    ]);

    await listRoleAssignments();

    expect(prismaMock.enrollment.groupBy).toHaveBeenCalledTimes(1);
    expect(prismaMock.enrollment.groupBy.mock.calls[0][0].where.assignmentId).toEqual({
      in: ['ca-1', 'ca-2', 'ca-3'],
    });
  });

  it('reports zero rather than undefined for an assignment that has enrolled nobody', async () => {
    prismaMock.enrollment.groupBy.mockResolvedValue([]);

    const rows = await listRoleAssignments();

    expect(rows[0].enrolledCount).toBe(0);
  });

  it('narrows the counts to a facility-bound caller’s own facilities', async () => {
    mockAdminAuth.mockResolvedValue(session('supervisor'));
    mockResolveDataFacilityIds.mockResolvedValue(['fac-a']);

    await listRoleAssignments();

    // The rows are org-level configuration; "how many people did this enrol" is
    // subject data and follows the caller's scope.
    expect(
      prismaMock.enrollment.groupBy.mock.calls[0][0].where.organizationUser.facilities,
    ).toEqual({ some: { facilityId: { in: ['fac-a'] }, active: true } });
  });

  it('skips the count query entirely when there are no role assignments', async () => {
    prismaMock.courseAssignment.findMany.mockResolvedValue([]);

    await expect(listRoleAssignments()).resolves.toEqual([]);
    expect(prismaMock.enrollment.groupBy).not.toHaveBeenCalled();
  });

  it.each(['finance', 'nurse', 'front_desk_admin'])(
    'denies role=%s — no assignment.read',
    async (role) => {
      mockAdminAuth.mockResolvedValue(session(role));

      await expect(listRoleAssignments()).rejects.toThrow('Unauthorized');
      expect(prismaMock.courseAssignment.findMany).not.toHaveBeenCalled();
    },
  );
});

describe('revokeRoleAssignment', () => {
  it('clears both role-target columns so neither the live hook nor the sweep matches', async () => {
    const result = await revokeRoleAssignment('ca-1');

    expect(result).toEqual({ success: true });
    // targetRoles: [] stops `enrollUserForRoleTargets` ({ has: role });
    // targetRole: null stops the nightly reconcile ({ not: null }).
    expect(prismaMock.courseAssignment.update.mock.calls[0][0].data).toEqual({
      targetRole: null,
      targetRoles: [],
    });
  });

  it('does not delete the row — its schedule settings are still resolved per course', async () => {
    await revokeRoleAssignment('ca-1');

    expect(prismaMock.courseAssignment).not.toHaveProperty('delete');
    expect(prismaMock.courseAssignment.update).toHaveBeenCalledTimes(1);
  });

  it('refuses an assignment belonging to another organisation', async () => {
    prismaMock.courseAssignment.findFirst.mockResolvedValue(null);

    const result = await revokeRoleAssignment('ca-other-org');

    expect(result.success).toBe(false);
    expect(prismaMock.courseAssignment.update).not.toHaveBeenCalled();
    // Scoped lookup, so a foreign id is "not found" rather than "forbidden".
    expect(prismaMock.courseAssignment.findFirst.mock.calls[0][0].where.organizationId).toBe(ORG);
  });

  // A supervisor may create role targets within their own scope but must not
  // revoke one the organisation relies on — `assignment.delete`, not `.create`.
  it.each(['supervisor', 'finance', 'nurse'])(
    'denies role=%s — no assignment.delete',
    async (role) => {
      mockAdminAuth.mockResolvedValue(session(role));

      const result = await revokeRoleAssignment('ca-1');

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(prismaMock.courseAssignment.update).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'admin', 'hr', 'clinical_director'])(
    'allows role=%s — holds assignment.delete',
    async (role) => {
      mockAdminAuth.mockResolvedValue(session(role));

      await expect(revokeRoleAssignment('ca-1')).resolves.toEqual({ success: true });
    },
  );
});
