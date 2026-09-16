/**
 * Role-target assignments were WRITE-ONLY: the course wizard created them and
 * nothing in the app listed, edited or removed them. Because a role-target
 * assignment enrols everyone who GAINS the role later — live via
 * `enrollUserForRoleTargets` on all four account-creation paths, and again via
 * the nightly reconcile pre-pass — a brand-new staff account could arrive
 * already enrolled with no way for an admin to see why or stop it.
 *
 * These cover `setRoleAssignmentTargets`, which superseded `revokeRoleAssignment`
 * when the shared role picker landed and is now the only way to change which
 * roles a course auto-enrols.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  mockAdminAuth,
  mockResolveDataFacilityIds,
  mockCreateEnrollmentForUser,
  mockCreateEnrollmentsForUsers,
} = vi.hoisted(() => ({
  prismaMock: {
    courseAssignment: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    enrollment: { groupBy: vi.fn() },
    organization: { findUnique: vi.fn() },
    organizationUser: { findMany: vi.fn() },
  },
  mockAdminAuth: vi.fn(),
  mockResolveDataFacilityIds: vi.fn(),
  mockCreateEnrollmentForUser: vi.fn(),
  mockCreateEnrollmentsForUsers: vi.fn(),
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
// setRoleAssignmentTargets' widen delegates to enrollHoldersOfAddedRoles →
// enrollSequentially → createEnrollmentForUser. Mocked so a widen test never
// falls through to the real per-user membership/invite machinery, which this
// file's prisma mock does not model.
vi.mock('@/lib/enrollment/create', () => ({
  createEnrollmentForUser: mockCreateEnrollmentForUser,
  createEnrollmentsForUsers: mockCreateEnrollmentsForUsers,
}));

import { setRoleAssignmentTargets } from './enrollment';
import { BILLING_GATE_ASSIGN_MESSAGE } from '@/lib/billing';

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

describe('setRoleAssignmentTargets', () => {
  /**
   * An already role-targeted, org-wide row. `current.length > 0` is required
   * for a widen to be honoured at all (see the "never role-targeted" test
   * below), so this is the default shape most tests build on.
   */
  function assignmentRowFor(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ca-1',
      courseId: 'course-1',
      targetRoles: ['nurse'],
      scheduleAt: null,
      dueAt: null,
      dueWindowDays: 30,
      facilityScoped: false,
      facilityIds: [],
      course: { title: 'HIPAA Basics', reviewRequired: false },
      ...overrides,
    };
  }

  beforeEach(() => {
    prismaMock.courseAssignment.findFirst.mockResolvedValue(assignmentRowFor());
    prismaMock.organization.findUnique.mockResolvedValue({
      name: 'Acme Corp',
      subscription: { status: 'active', pausedAt: null },
    });
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    mockCreateEnrollmentForUser.mockResolvedValue({
      status: 'enrolled',
      email: 'holder@example.com',
      userId: 'ou-holder',
      enrollmentId: 'enr-1',
    });
  });

  // Item 1 — the single highest-value test in this PR. sweep.ts:276-290 still
  // queries `targetRole: { not: null }`, so a desync here silently breaks the
  // nightly reconciliation backstop.
  it('keeps targetRole and targetRoles in sync after a WIDEN', async () => {
    prismaMock.courseAssignment.findFirst.mockResolvedValue(
      assignmentRowFor({ targetRoles: ['nurse'] }),
    );

    const result = await setRoleAssignmentTargets('ca-1', ['nurse', 'hr']);

    expect(result.success).toBe(true);
    expect(prismaMock.courseAssignment.update).toHaveBeenCalledTimes(1);
    const data = prismaMock.courseAssignment.update.mock.calls[0][0].data;
    // The superseded singular column carries the FIRST role of the new list —
    // never the pre-widen value and never left stale.
    expect(data).toEqual({ targetRole: 'nurse', targetRoles: ['nurse', 'hr'] });
  });

  it('keeps targetRole and targetRoles in sync after a NARROW', async () => {
    prismaMock.courseAssignment.findFirst.mockResolvedValue(
      assignmentRowFor({ targetRoles: ['nurse', 'hr'] }),
    );

    const result = await setRoleAssignmentTargets('ca-1', ['nurse']);

    expect(result.success).toBe(true);
    const data = prismaMock.courseAssignment.update.mock.calls[0][0].data;
    expect(data).toEqual({ targetRole: 'nurse', targetRoles: ['nurse'] });
  });

  it('clearing to an empty list sets targetRole to null, not to a stale role', async () => {
    prismaMock.courseAssignment.findFirst.mockResolvedValue(
      assignmentRowFor({ targetRoles: ['nurse', 'hr'] }),
    );

    const result = await setRoleAssignmentTargets('ca-1', []);

    expect(result).toEqual({ success: true, enrolled: 0 });
    expect(prismaMock.courseAssignment.update.mock.calls[0][0].data).toEqual({
      targetRole: null,
      targetRoles: [],
    });
  });

  // Item 2 — permission split. `assignment.create` gates the widen and
  // `assignment.delete` the narrow. Since 2026-09-16 supervisor holds BOTH: the
  // delete verb was granted for founder Rule C (per-staff withdrawal on the
  // course roster), and the registry has no finer grain than the resource, so
  // the role-target narrow comes with it. Finance is the remaining
  // create-without-delete case that keeps the split itself under test.
  describe('permission split — create gates the widen, delete gates the narrow', () => {
    it('a supervisor (create, no delete) may widen', async () => {
      mockAdminAuth.mockResolvedValue(session('supervisor'));
      prismaMock.courseAssignment.findFirst.mockResolvedValue(
        assignmentRowFor({ targetRoles: ['nurse'] }),
      );
      prismaMock.organizationUser.findMany.mockResolvedValue([
        { id: 'ou-holder', user: { email: 'holder@example.com' } },
      ]);

      const result = await setRoleAssignmentTargets('ca-1', ['nurse', 'hr']);

      expect(result).toEqual({ success: true, enrolled: 1 });
      expect(prismaMock.courseAssignment.update).toHaveBeenCalledTimes(1);
    });

    // A role without `assignment.delete` is refused BY RETURN — never a throw,
    // which production would redact to React error #441.
    it('a role holding create but not delete is REFUSED a narrow, by return', async () => {
      mockAdminAuth.mockResolvedValue(session('nurse'));
      prismaMock.courseAssignment.findFirst.mockResolvedValue(
        assignmentRowFor({ targetRoles: ['nurse', 'hr'] }),
      );

      const result = await setRoleAssignmentTargets('ca-1', ['nurse']);

      expect(result.success).toBe(false);
      expect(result.refusedReason).toBeTruthy();
      expect(prismaMock.courseAssignment.update).not.toHaveBeenCalled();
    });

    it('a supervisor may now narrow too, having gained assignment.delete (Rule C)', async () => {
      mockAdminAuth.mockResolvedValue(session('supervisor'));
      prismaMock.courseAssignment.findFirst.mockResolvedValue(
        assignmentRowFor({ targetRoles: ['nurse', 'hr'] }),
      );

      const result = await setRoleAssignmentTargets('ca-1', ['nurse']);

      expect(result.success).toBe(true);
      expect(prismaMock.courseAssignment.update).toHaveBeenCalledTimes(1);
    });

    it.each(['owner', 'admin', 'hr', 'clinical_director'])(
      'role=%s holds both verbs — may widen AND narrow',
      async (role) => {
        mockAdminAuth.mockResolvedValue(session(role));
        prismaMock.courseAssignment.findFirst.mockResolvedValue(
          assignmentRowFor({ targetRoles: ['nurse'] }),
        );

        await expect(setRoleAssignmentTargets('ca-1', ['nurse', 'hr'])).resolves.toMatchObject({
          success: true,
        });
        expect(prismaMock.courseAssignment.update).toHaveBeenCalledTimes(1);
      },
    );
  });

  // Item 3 — facility scope is inherited from the row, never re-derived from
  // the calling session.
  it("a widen enrols only holders within the ROW's recorded facility scope, without consulting resolveDataFacilityIds", async () => {
    prismaMock.courseAssignment.findFirst.mockResolvedValue(
      assignmentRowFor({
        targetRoles: ['nurse'],
        facilityScoped: true,
        facilityIds: ['fac-a'],
      }),
    );

    await setRoleAssignmentTargets('ca-1', ['nurse', 'hr']);

    expect(prismaMock.organizationUser.findMany.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
      role: { in: ['hr'] },
      active: true,
      facilities: { some: { facilityId: { in: ['fac-a'] }, active: true } },
    });
    // The row's own recorded scope is the only input — the caller's session
    // scope must never be re-resolved and substituted in its place.
    expect(mockResolveDataFacilityIds).not.toHaveBeenCalled();
  });

  it('an org-wide row (facilityScoped: false) enrols with no facility predicate at all', async () => {
    prismaMock.courseAssignment.findFirst.mockResolvedValue(
      assignmentRowFor({ targetRoles: ['nurse'], facilityScoped: false, facilityIds: [] }),
    );

    await setRoleAssignmentTargets('ca-1', ['nurse', 'hr']);

    expect(prismaMock.organizationUser.findMany.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
      role: { in: ['hr'] },
      active: true,
    });
  });

  // Item 4 — a row with no recorded role-target scope must refuse a widen
  // rather than inherit its org-wide default.
  it('refuses a widen when the row has never been role-targeted', async () => {
    prismaMock.courseAssignment.findFirst.mockResolvedValue(assignmentRowFor({ targetRoles: [] }));

    const result = await setRoleAssignmentTargets('ca-1', ['nurse']);

    expect(result.success).toBe(false);
    expect(result.refusedReason).toMatch(/assign this course to roles first/i);
    expect(prismaMock.courseAssignment.update).not.toHaveBeenCalled();
    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
  });

  // Item 5 — D6 soft revoke: removal clears the target only; every existing
  // Enrollment is untouched. Mirrors the deleted revokeRoleAssignment tests
  // (recovered via `git show HEAD`).
  describe('D6 soft revoke', () => {
    it('clears the removed role from targets and leaves enrollments untouched — no delete, no status change', async () => {
      prismaMock.courseAssignment.findFirst.mockResolvedValue(
        assignmentRowFor({ targetRoles: ['nurse', 'hr'] }),
      );

      const result = await setRoleAssignmentTargets('ca-1', ['nurse']);

      expect(result).toEqual({ success: true, enrolled: 0 });
      // targetRoles no longer includes 'hr' stops enrollUserForRoleTargets
      // ({ has: role }); targetRole staying non-null (or clearing to null when
      // empty) stops the nightly reconcile ({ not: null }).
      expect(prismaMock.courseAssignment.update.mock.calls[0][0].data).toEqual({
        targetRole: 'nurse',
        targetRoles: ['nurse'],
      });
    });

    it('does not delete the row — only `update` is ever called', async () => {
      prismaMock.courseAssignment.findFirst.mockResolvedValue(
        assignmentRowFor({ targetRoles: ['nurse', 'hr'] }),
      );

      await setRoleAssignmentTargets('ca-1', ['nurse']);

      expect(prismaMock.courseAssignment).not.toHaveProperty('delete');
      expect(prismaMock.courseAssignment.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
    });
  });

  // Item 6 — tenancy and no-op behaviour.
  it('a cross-org assignmentId is "not found", never "forbidden"', async () => {
    prismaMock.courseAssignment.findFirst.mockResolvedValue(null);

    const result = await setRoleAssignmentTargets('ca-other-org', ['nurse']);

    expect(result.success).toBe(false);
    expect(result.refusedReason).toMatch(/not found/i);
    expect(prismaMock.courseAssignment.findFirst.mock.calls[0][0].where).toEqual({
      id: 'ca-other-org',
      organizationId: ORG,
    });
    expect(prismaMock.courseAssignment.update).not.toHaveBeenCalled();
  });

  it('a no-op call (nothing added or removed) succeeds without writing anything', async () => {
    prismaMock.courseAssignment.findFirst.mockResolvedValue(
      assignmentRowFor({ targetRoles: ['nurse', 'hr'] }),
    );

    const result = await setRoleAssignmentTargets('ca-1', ['hr', 'nurse']);

    expect(result).toEqual({ success: true, enrolled: 0 });
    expect(prismaMock.courseAssignment.update).not.toHaveBeenCalled();
  });

  // Item 7 — the review and billing gates apply to the widen only.
  describe('review and billing gates apply to the widen only', () => {
    it('refuses a widen when the course is held for quality review', async () => {
      prismaMock.courseAssignment.findFirst.mockResolvedValue(
        assignmentRowFor({
          targetRoles: ['nurse'],
          course: { title: 'HIPAA Basics', reviewRequired: true },
        }),
      );

      const result = await setRoleAssignmentTargets('ca-1', ['nurse', 'hr']);

      expect(result.success).toBe(false);
      expect(result.refusedReason).toMatch(/quality warnings/i);
      expect(prismaMock.courseAssignment.update).not.toHaveBeenCalled();
    });

    it('refuses a widen when the organization lacks active billing', async () => {
      prismaMock.courseAssignment.findFirst.mockResolvedValue(
        assignmentRowFor({ targetRoles: ['nurse'] }),
      );
      prismaMock.organization.findUnique.mockResolvedValue({
        name: 'Acme Corp',
        subscription: { status: 'past_due', pausedAt: null },
      });

      const result = await setRoleAssignmentTargets('ca-1', ['nurse', 'hr']);

      expect(result).toEqual({ success: false, refusedReason: BILLING_GATE_ASSIGN_MESSAGE });
      expect(prismaMock.courseAssignment.update).not.toHaveBeenCalled();
    });

    it('a narrow still succeeds for a held-for-review course — switching auto-enrolment off must never be blocked', async () => {
      prismaMock.courseAssignment.findFirst.mockResolvedValue(
        assignmentRowFor({
          targetRoles: ['nurse', 'hr'],
          course: { title: 'HIPAA Basics', reviewRequired: true },
        }),
      );

      const result = await setRoleAssignmentTargets('ca-1', ['nurse']);

      expect(result).toEqual({ success: true, enrolled: 0 });
      expect(prismaMock.courseAssignment.update).toHaveBeenCalledTimes(1);
      // Neither gate's lookup should even run for a narrow-only call.
      expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
    });

    it('a narrow still succeeds for an org with lapsed billing', async () => {
      prismaMock.courseAssignment.findFirst.mockResolvedValue(
        assignmentRowFor({ targetRoles: ['nurse', 'hr'] }),
      );
      prismaMock.organization.findUnique.mockResolvedValue({
        name: 'Acme Corp',
        subscription: { status: 'canceled', pausedAt: null },
      });

      const result = await setRoleAssignmentTargets('ca-1', ['nurse']);

      expect(result).toEqual({ success: true, enrolled: 0 });
      expect(prismaMock.courseAssignment.update).toHaveBeenCalledTimes(1);
    });
  });
});
