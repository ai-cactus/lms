/**
 * Unit tests for src/app/actions/staff.ts
 *
 * Post multi-org schema split: "a person within an organization" is an
 * OrganizationUser row (id, userId, organizationId, role, jobTitle, managerId),
 * not a flat User row. Identity fields (email, firstName/lastName/fullName,
 * avatarUrl) live on User; org-scoped fields live on OrganizationUser.
 * `session.user` carries `organizationId`/`organizationUserId`/`role` directly
 * (resolved at login from the active membership) — most gates here read those
 * off the session rather than re-querying the DB for them.
 *
 * updateStaffDetails() — Owner role is established ONLY at org creation:
 *   - Promoting a non-owner to owner via updateStaffDetails must be rejected.
 *   - An existing owner keeping their role while editing name/title is allowed.
 *
 * RBAC ruling: supervisor was demoted to READ-ONLY on every resource — it no
 * longer holds user.edit/user.delete/invite.edit/invite.delete, so it is
 * denied on every write path in this file (previously it held some of these).
 * `admin` is a new Owner-equivalent role (full CRUD) alongside `owner`.
 *
 * resendInvite() — THER-007 regression tests:
 *   - Authorization: caller must be an authenticated admin who owns the
 *     invite's organization.
 *   - Token + expiry regeneration: a fresh token and a ~7-day expiry window
 *     are written, invalidating any previously-shared (stale) invite link.
 *   - Status reset to 'pending' so an expired invite becomes usable again.
 *   - An already-accepted invite is not silently "resent" — it returns a
 *     distinct, non-throwing error instead.
 *
 * F-009 / F-010 regression tests (org isolation) for getStaffDetails and
 * getEnrollmentQuizResult — see their own describe blocks below.
 *
 * External deps (@/auth, @/lib/prisma, next/cache, @/lib/email,
 * @/lib/enrollment/role-targets, @/app/actions/enrollment) are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockOrgUserFindUnique,
  mockOrgUserUpdate,
  mockUserUpdate,
  mockInviteFindUnique,
  mockInviteUpdate,
  mockInviteUpdateMany,
  mockInviteDelete,
  mockEnrollmentFindUnique,
  mockEnrollmentDeleteMany,
  mockTransaction,
  mockRevalidatePath,
  mockSendInviteEmail,
  mockSendStaffRemovedEmail,
  mockSendStaffRemovalConfirmationEmail,
  mockAudit,
  mockEnrollUsers,
  mockEnrollUserForRoleTargets,
  mockFacilityFindMany,
  mockOrgUserFacilityUpdateMany,
  mockOrgUserFacilityUpsert,
  mockInvalidateRevalidationCache,
  prismaMock,
} = vi.hoisted(() => {
  const mockOrgUserFindUnique = vi.fn();
  const mockOrgUserUpdate = vi.fn();
  const mockUserUpdate = vi.fn();
  const mockInviteFindUnique = vi.fn();
  const mockInviteUpdate = vi.fn();
  const mockInviteUpdateMany = vi.fn();
  const mockInviteDelete = vi.fn();
  const mockEnrollmentFindUnique = vi.fn();
  const mockEnrollmentDeleteMany = vi.fn();
  const mockFacilityFindMany = vi.fn();
  const mockOrgUserFacilityUpdateMany = vi.fn();
  const mockOrgUserFacilityUpsert = vi.fn();
  const txClient = {
    organizationUserFacility: {
      updateMany: mockOrgUserFacilityUpdateMany,
      upsert: mockOrgUserFacilityUpsert,
    },
  };
  // removeStaff() runs its writes as an array-form $transaction([...]); the
  // individual delegate calls are already-invoked mock promises by the time
  // $transaction receives them, so Promise.all is faithful to Prisma's real
  // array-transaction semantics for that test double. setStaffFacilities()
  // instead uses the callback form `$transaction(async (tx) => ...)`, so this
  // mock must support BOTH shapes.
  const mockTransaction = vi.fn((arg: Promise<unknown>[] | ((tx: typeof txClient) => unknown)) =>
    typeof arg === 'function' ? Promise.resolve(arg(txClient)) : Promise.all(arg),
  );
  const prismaMock = {
    organizationUser: {
      findUnique: mockOrgUserFindUnique,
      findFirst: mockOrgUserFindUnique,
      findMany: vi.fn().mockResolvedValue([]),
      update: mockOrgUserUpdate,
    },
    user: { update: mockUserUpdate },
    invite: {
      findUnique: mockInviteFindUnique,
      update: mockInviteUpdate,
      updateMany: mockInviteUpdateMany,
      delete: mockInviteDelete,
    },
    enrollment: {
      findUnique: mockEnrollmentFindUnique,
      findFirst: mockEnrollmentFindUnique,
      deleteMany: mockEnrollmentDeleteMany,
    },
    facility: { findMany: mockFacilityFindMany },
    $transaction: mockTransaction,
  };
  return {
    mockAuth: vi.fn(),
    mockOrgUserFindUnique,
    mockOrgUserUpdate,
    mockUserUpdate,
    mockFacilityFindMany,
    mockOrgUserFacilityUpdateMany,
    mockOrgUserFacilityUpsert,
    mockInviteFindUnique,
    mockInviteUpdate,
    mockInviteUpdateMany,
    mockInviteDelete,
    mockEnrollmentFindUnique,
    mockEnrollmentDeleteMany,
    mockTransaction,
    mockRevalidatePath: vi.fn(),
    mockSendInviteEmail: vi.fn(),
    mockSendStaffRemovedEmail: vi.fn(),
    mockSendStaffRemovalConfirmationEmail: vi.fn(),
    mockAudit: vi.fn(),
    mockEnrollUsers: vi.fn(),
    mockEnrollUserForRoleTargets: vi.fn(),
    mockInvalidateRevalidationCache: vi.fn(),
    prismaMock,
  };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
// F-001 audit is a best-effort side-channel — stub it so business-logic tests
// don't depend on the audit sink or the request-scoped headers() it reads.
vi.mock('@/lib/audit', () => ({ audit: mockAudit, getClientContext: () => ({}) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
// resendInvite / removeStaff dynamically import '@/lib/email' — mock the module path.
vi.mock('@/lib/email', () => ({
  sendInviteEmail: mockSendInviteEmail,
  sendStaffRemovedEmail: mockSendStaffRemovedEmail,
  sendStaffRemovalConfirmationEmail: mockSendStaffRemovalConfirmationEmail,
}));
// assignCourseToStaffMember delegates to enrollUsers — mock the enrollment module.
vi.mock('@/app/actions/enrollment', () => ({ enrollUsers: mockEnrollUsers }));
// A role change live-enrolls the target in role-target assignments — mocked out.
vi.mock('@/lib/enrollment/role-targets', () => ({
  enrollUserForRoleTargets: mockEnrollUserForRoleTargets,
}));
// removeStaff / role change actively bust the JWT revalidation cache; stub it so
// the tests don't reach the real Redis client (its connect attempt would hang).
// Kept as a spy (not an inline vi.fn()) so tests can assert it's actually
// called — a stub that silently swallows the call would hide a real regression.
vi.mock('@/lib/auth/session-revalidation-cache', () => ({
  invalidateRevalidationCache: mockInvalidateRevalidationCache,
}));

import {
  updateStaffDetails,
  resendInvite,
  revokeInvite,
  getStaffDetails,
  getEnrollmentQuizResult,
  removeStaff,
  setStaffManager,
  assignCourseToStaffMember,
  setStaffFacilities,
} from './staff';

// ── Helpers & fixtures ──────────────────────────────────────────────────────────

function makeAdminSession(role = 'owner', overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: 'admin-1',
      email: 'admin@acme.com',
      role,
      organizationId: 'org-1',
      organizationUserId: 'ou-admin-1',
      ...overrides,
    },
  };
}

const baseData = {
  firstName: 'Jane',
  lastName: 'Doe',
  role: 'nurse' as const,
  jobTitle: 'Nurse',
};

const PENDING_INVITE = {
  organizationId: 'org-1',
  email: 'newstaff@example.com',
  role: 'nurse',
  status: 'pending',
  organization: { name: 'Acme Co' },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
  // Most callers in this suite act as an org owner unless a test overrides it.
  mockAuth.mockResolvedValue(makeAdminSession('owner'));
  mockOrgUserUpdate.mockResolvedValue({});
  mockUserUpdate.mockResolvedValue({ id: 'target-user-1', email: 'target@acme.com' });
  mockInviteFindUnique.mockResolvedValue(PENDING_INVITE);
  mockInviteUpdate.mockResolvedValue({});
  mockInviteUpdateMany.mockResolvedValue({ count: 0 });
  mockInviteDelete.mockResolvedValue({});
  mockEnrollmentDeleteMany.mockResolvedValue({ count: 0 });
  mockEnrollUserForRoleTargets.mockResolvedValue(undefined);
  mockSendInviteEmail.mockResolvedValue(undefined);
  mockSendStaffRemovedEmail.mockResolvedValue(undefined);
  mockSendStaffRemovalConfirmationEmail.mockResolvedValue(undefined);
  mockEnrollUsers.mockResolvedValue({
    success: ['target@acme.com'],
    alreadyEnrolled: [],
    newInvited: [],
    failed: [],
  });
  mockInvalidateRevalidationCache.mockResolvedValue(undefined);
});

// ── updateStaffDetails() ────────────────────────────────────────────────────────

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('updateStaffDetails() — auth guard', () => {
  it('returns Unauthorized when there is no session', async () => {
    mockAuth.mockResolvedValue(null);
    const result = await updateStaffDetails('target-1', baseData);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  it('returns Unauthorized when the requester is a worker', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'w-1', email: 'w@a.com', role: 'nurse', organizationId: 'org-1' },
    });
    const result = await updateStaffDetails('target-1', baseData);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });
});

// ── Owner-promotion guard ─────────────────────────────────────────────────────

describe('updateStaffDetails() — owner role cannot be granted via edit (one-owner invariant)', () => {
  it('rejects promotion of a worker to owner', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    // Target is currently a worker (non-owner) — `target` is the OrganizationUser row.
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-1',
      role: 'nurse',
    });

    const result = await updateStaffDetails('target-1', {
      ...baseData,
      role: 'owner',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Owner role cannot be assigned/i);
    expect(mockOrgUserUpdate).not.toHaveBeenCalled();
  });

  it('rejects promotion of a supervisor to owner', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-1',
      role: 'supervisor',
    });

    const result = await updateStaffDetails('target-1', {
      ...baseData,
      role: 'owner',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Owner role cannot be assigned/i);
  });

  it('allows an existing owner to keep their role while changing name/title', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    // Target is already an owner — keeping their role is allowed
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-1',
      role: 'owner',
    });

    const result = await updateStaffDetails('target-1', {
      firstName: 'Alice',
      lastName: 'Smith',
      role: 'owner',
      jobTitle: 'CEO',
    });

    expect(result.success).toBe(true);
    // No role change → exactly one User write (the name-field update).
    expect(mockUserUpdate).toHaveBeenCalledOnce();
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe('updateStaffDetails() — tenant isolation', () => {
  it('rejects when the target user belongs to a different org', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-OTHER',
      role: 'nurse',
    });

    const result = await updateStaffDetails('target-1', baseData);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Forbidden');
  });

  it('rejects when the target user is not found', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockOrgUserFindUnique.mockResolvedValue(null);

    const result = await updateStaffDetails('target-1', baseData);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Forbidden');
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('updateStaffDetails() — happy path', () => {
  it('updates the org-membership role/jobTitle and the identity name fields when all checks pass', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-1',
      role: 'nurse',
    });

    const result = await updateStaffDetails('target-1', {
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'supervisor',
      jobTitle: 'Supervisor',
    });

    expect(result.success).toBe(true);
    expect(mockOrgUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { role: 'supervisor', jobTitle: 'Supervisor', roleAssignedAt: expect.any(Date) },
    });
    // Two separate User writes: the sessionVersion kill-switch bump (role
    // changed) and the identity name-field update. The old single
    // `profile.upsert` call is gone — Profile was merged into User, and
    // role/jobTitle now live on OrganizationUser, not User.
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-user-1' },
      data: { sessionVersion: { increment: 1 } },
    });
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-user-1' },
      data: { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe' },
    });
  });
});

// ── updateStaffDetails() — RBAC matrix realignment ──────────────────────────────

/**
 * Permission-gate matrix for updateStaffDetails: gated on `can(..., 'user.edit')`.
 * Finance and Clinical Director hold `user.read` only (view-only on staff) and
 * must be denied. RBAC ruling: Supervisor was demoted to read-only and no
 * longer holds `user.edit` either (previously it did) — moved into the deny
 * list. HR, Owner, and the new Owner-equivalent `admin` role retain full edit
 * rights.
 */
describe('updateStaffDetails() — permission matrix (user.edit gate)', () => {
  it.each(['finance', 'clinical_director', 'supervisor'] as const)(
    'denies %s (view-only on staff — no longer holds user.edit)',
    async (role) => {
      mockAuth.mockResolvedValue({
        user: { id: 'admin-1', email: 'a@acme.com', role, organizationId: 'org-1' },
      });

      const result = await updateStaffDetails('target-1', baseData);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(mockOrgUserFindUnique).not.toHaveBeenCalled();
      expect(mockOrgUserUpdate).not.toHaveBeenCalled();
    },
  );

  it.each(['hr', 'owner', 'admin'] as const)(
    'allows %s to edit name/job-title without changing the role',
    async (role) => {
      mockAuth.mockResolvedValue({
        user: { id: 'admin-1', email: 'a@acme.com', role, organizationId: 'org-1' },
      });
      mockOrgUserFindUnique.mockResolvedValue({
        userId: 'target-user-1',
        organizationId: 'org-1',
        role: 'nurse',
      });

      const result = await updateStaffDetails('target-1', { ...baseData, role: 'nurse' });

      expect(result.success).toBe(true);
      expect(mockOrgUserUpdate).toHaveBeenCalledOnce();
      // A same-role resubmit must not touch sessionVersion — only ONE User
      // write occurs (the name-field update).
      expect(mockUserUpdate).toHaveBeenCalledOnce();
      expect(mockUserUpdate.mock.calls[0][0].data).not.toHaveProperty('sessionVersion');
    },
  );
});

/**
 * In-place role change (Change 2). A role-changing update runs the pure
 * `canChangeRole` guard from role-utils; only Owner/Admin may re-role a
 * reachable target (ROLE_CHANGE_ACTOR_ROLES = ['owner', 'admin']), never
 * themselves, and a successful change bumps sessionVersion in a separate User
 * write (killing the target's live sessions) and records a
 * `staff.role.change` audit entry. A same-role resubmit (no actual change)
 * must skip both the bump and the audit entirely.
 */
describe('updateStaffDetails() — in-place role change (canChangeRole integration)', () => {
  it('owner changing a target role bumps sessionVersion and writes a staff.role.change audit entry', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-1',
      role: 'hr',
    });

    const result = await updateStaffDetails('target-1', { ...baseData, role: 'nurse' });

    expect(result).toEqual({ success: true });
    expect(mockOrgUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: expect.objectContaining({ role: 'nurse', roleAssignedAt: expect.any(Date) }),
    });
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-user-1' },
      data: { sessionVersion: { increment: 1 } },
    });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.role.change',
        actorId: 'admin-1',
        targetType: 'user',
        targetId: 'target-1',
        metadata: { fromRole: 'hr', toRole: 'nurse' },
      }),
    );
    expect(mockEnrollUserForRoleTargets).toHaveBeenCalledWith('target-1', 'org-1');
    // commit 66aa961: the role change bumped sessionVersion, so the target's
    // cached revalidation snapshot must be busted with THEIR IDENTITY id (not
    // the membership id, and not the actor's), and only after the DB write that
    // bumped the version.
    expect(mockInvalidateRevalidationCache).toHaveBeenCalledExactlyOnceWith('target-user-1');
    expect(mockUserUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockInvalidateRevalidationCache.mock.invocationCallOrder[0],
    );
  });

  it('a same-role resubmit does NOT bump sessionVersion, does NOT write a staff.role.change audit entry, and does NOT invalidate the cache', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-1',
      role: 'nurse',
    });

    const result = await updateStaffDetails('target-1', { ...baseData, role: 'nurse' });

    expect(result).toEqual({ success: true });
    expect(mockOrgUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { role: 'nurse', jobTitle: 'Nurse' },
    });
    // Only the name-field update fires — no sessionVersion bump.
    expect(mockUserUpdate).toHaveBeenCalledOnce();
    expect(mockAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'staff.role.change' }),
    );
    expect(mockEnrollUserForRoleTargets).not.toHaveBeenCalled();
    // No sessionVersion bump happened, so there's nothing to invalidate.
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });

  it('denies a role change attempted by hr (hr may edit staff but not re-role them)', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'hr-1', email: 'hr@acme.com', role: 'hr', organizationId: 'org-1' },
    });
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-1',
      role: 'nurse',
    });

    const result = await updateStaffDetails('target-1', { ...baseData, role: 'supervisor' });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Only an Owner or Supervisor can change a staff member's role.");
    expect(mockOrgUserUpdate).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('denies self role-change even for an owner', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner')); // session.user.id === 'admin-1'
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'admin-1',
      organizationId: 'org-1',
      role: 'owner',
    });

    const result = await updateStaffDetails('ou-admin-1', { ...baseData, role: 'supervisor' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('You cannot change your own role.');
    expect(mockOrgUserUpdate).not.toHaveBeenCalled();
  });

  // RBAC ruling: ROLE_CHANGE_ACTOR_ROLES is now ['owner', 'admin'] — `admin`
  // is the new Owner-equivalent seat and can re-role staff just like owner.
  it("allows admin (Owner-equivalent) to change another staff member's role", async () => {
    mockAuth.mockResolvedValue(
      makeAdminSession('admin', { id: 'admin-x', organizationUserId: 'ou-admin-x' }),
    );
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-1',
      role: 'supervisor',
    });

    const result = await updateStaffDetails('target-1', { ...baseData, role: 'hr' });

    expect(result).toEqual({ success: true });
    expect(mockOrgUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: expect.objectContaining({ role: 'hr' }),
    });
  });

  // RBAC ruling: supervisor was demoted to read-only — it no longer holds
  // user.edit at all, so it can't reach updateStaffDetails for ANY edit, role
  // change or not. This is the representative "supervisor write denied" check
  // for the role-change path specifically.
  it("denies supervisor attempting to change a staff member's role — no longer holds user.edit", async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'sup-1', email: 'sup@acme.com', role: 'supervisor', organizationId: 'org-1' },
    });

    const result = await updateStaffDetails('target-1', { ...baseData, role: 'hr' });

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(mockOrgUserFindUnique).not.toHaveBeenCalled();
    expect(mockOrgUserUpdate).not.toHaveBeenCalled();
  });
});

// ── setStaffManager() ────────────────────────────────────────────────────────────

describe('setStaffManager() — permission matrix (user.edit gate)', () => {
  it.each(['finance', 'clinical_director', 'supervisor'] as const)(
    'denies %s (view-only on staff)',
    async (role) => {
      mockAuth.mockResolvedValue({
        user: { id: 'admin-1', email: 'a@acme.com', role, organizationId: 'org-1' },
      });

      const result = await setStaffManager('staff-1', 'manager-1');

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(mockOrgUserUpdate).not.toHaveBeenCalled();
    },
  );

  it('allows hr to set a manager', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'hr-1', email: 'hr@acme.com', role: 'hr', organizationId: 'org-1' },
    });
    mockOrgUserFindUnique
      // staff lookup
      .mockResolvedValueOnce({ organizationId: 'org-1' })
      // manager lookup
      .mockResolvedValueOnce({ organizationId: 'org-1', role: 'supervisor' });

    const result = await setStaffManager('staff-1', 'manager-1');

    expect(result).toEqual({ success: true });
    expect(mockOrgUserUpdate).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: { managerId: 'manager-1' },
    });
  });

  it('rejects when the staff member belongs to a different organization', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockOrgUserFindUnique.mockResolvedValueOnce({ organizationId: 'org-OTHER' });

    const result = await setStaffManager('staff-1', 'manager-1');

    expect(result).toEqual({ success: false, error: 'Forbidden' });
    expect(mockOrgUserUpdate).not.toHaveBeenCalled();
  });
});

// ── assignCourseToStaffMember() ───────────────────────────────────────────────────

/**
 * assignCourseToStaffMember gates on `user.edit` (roster management) — a
 * deliberately distinct gate from the Courses-module assignment path, which
 * remains reachable via `enrollment.create`/`enrollment.edit` (Clinical
 * Director keeps that path). It resolves the target's email within the
 * caller's org, then delegates the actual enrollment mechanics to the
 * UNCHANGED `enrollUsers`.
 */
describe('assignCourseToStaffMember() — permission gate, org scope, delegation', () => {
  it.each(['finance', 'clinical_director', 'supervisor'] as const)(
    'denies %s even though Clinical Director retains Courses-module assignment elsewhere',
    async (role) => {
      mockAuth.mockResolvedValue({
        user: { id: 'admin-1', email: 'a@acme.com', role, organizationId: 'org-1' },
      });

      const result = await assignCourseToStaffMember('course-1', 'staff-1');

      expect(result).toEqual({
        success: [],
        alreadyEnrolled: [],
        newInvited: [],
        failed: [],
        error: 'Unauthorized',
      });
      expect(mockEnrollUsers).not.toHaveBeenCalled();
    },
  );

  it('rejects a target in a different organization without calling enrollUsers', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockOrgUserFindUnique.mockResolvedValue({
      organizationId: 'org-OTHER',
      user: { email: 'x@other.com' },
    });

    const result = await assignCourseToStaffMember('course-1', 'staff-1');

    expect(result.error).toBe('Forbidden');
    expect(mockEnrollUsers).not.toHaveBeenCalled();
  });

  it('delegates to enrollUsers with the resolved target email and returns its result verbatim', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockOrgUserFindUnique.mockResolvedValue({
      organizationId: 'org-1',
      user: { email: 'target@acme.com' },
    });
    mockEnrollUsers.mockResolvedValue({
      success: ['target@acme.com'],
      alreadyEnrolled: [],
      newInvited: [],
      failed: [],
    });

    const result = await assignCourseToStaffMember('course-1', 'staff-1', {
      renewalCycle: 'annual',
    });

    expect(mockEnrollUsers).toHaveBeenCalledWith('course-1', [{ email: 'target@acme.com' }], {
      renewalCycle: 'annual',
    });
    expect(result).toEqual({
      success: ['target@acme.com'],
      alreadyEnrolled: [],
      newInvited: [],
      failed: [],
    });
  });

  it('allows hr to assign a course', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'hr-1', email: 'hr@acme.com', role: 'hr', organizationId: 'org-1' },
    });
    mockOrgUserFindUnique.mockResolvedValue({
      organizationId: 'org-1',
      user: { email: 'target@acme.com' },
    });

    await assignCourseToStaffMember('course-1', 'staff-1');

    expect(mockEnrollUsers).toHaveBeenCalledOnce();
  });

  /**
   * Defect B — enrollUsers throws when the org's billing gate blocks course
   * assignment (see enrollment.test.ts's billing-gate matrix for the full
   * active/paused/canceled coverage). assignCourseToStaffMember must catch
   * that throw and normalize it into its own return shape — `failed:
   * [staffOrgUserId]` plus the caller-facing `error` message — rather than
   * letting the error propagate and break the calling modal.
   */
  it('normalizes a billing-gate error thrown by enrollUsers into the failed/error return shape', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockOrgUserFindUnique.mockResolvedValue({
      organizationId: 'org-1',
      user: { email: 'target@acme.com' },
    });
    mockEnrollUsers.mockRejectedValue(
      new Error('Your organization needs an active subscription to assign courses.'),
    );

    const result = await assignCourseToStaffMember('course-1', 'staff-1');

    expect(result).toEqual({
      success: [],
      alreadyEnrolled: [],
      newInvited: [],
      failed: ['staff-1'],
      error: 'Your organization needs an active subscription to assign courses.',
    });
  });

  it('normalizes a non-Error rejection from enrollUsers into a generic error message', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockOrgUserFindUnique.mockResolvedValue({
      organizationId: 'org-1',
      user: { email: 'target@acme.com' },
    });
    mockEnrollUsers.mockRejectedValue('unexpected non-error rejection');

    const result = await assignCourseToStaffMember('course-1', 'staff-1');

    expect(result).toEqual({
      success: [],
      alreadyEnrolled: [],
      newInvited: [],
      failed: ['staff-1'],
      error: 'Failed to assign course',
    });
  });
});

// ── revokeInvite() ───────────────────────────────────────────────────────────────

// revokeInvite() reads role/organizationId directly off the session (no DB
// lookup), so tests set the session, not a prisma mock, for permission checks.
describe('revokeInvite() — permission matrix (invite.delete gate)', () => {
  it.each(['finance', 'clinical_director', 'supervisor'] as const)(
    'denies %s (view-only — no invite.delete)',
    async (role) => {
      mockAuth.mockResolvedValue({
        user: { id: 'admin-1', email: 'a@acme.com', role, organizationId: 'org-1' },
      });

      await expect(revokeInvite('invite-1')).rejects.toThrow('Insufficient permissions');
      expect(mockInviteDelete).not.toHaveBeenCalled();
    },
  );

  it('allows hr to revoke an invite in their org', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'hr-1', email: 'hr@acme.com', role: 'hr', organizationId: 'org-1' },
    });
    mockInviteFindUnique.mockResolvedValue({ organizationId: 'org-1' });

    const result = await revokeInvite('invite-1');

    expect(result).toEqual({ success: true });
    expect(mockInviteDelete).toHaveBeenCalledWith({ where: { id: 'invite-1' } });
  });

  it('rejects an invite belonging to a different organization', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockInviteFindUnique.mockResolvedValue({ organizationId: 'org-OTHER' });

    await expect(revokeInvite('invite-1')).rejects.toThrow(
      'Invite does not belong to your organization',
    );
    expect(mockInviteDelete).not.toHaveBeenCalled();
  });
});

// ── resendInvite() ──────────────────────────────────────────────────────────────

// resendInvite() also reads role/organizationId directly off the session.
describe('resendInvite — permission matrix (invite.edit gate)', () => {
  it.each(['finance', 'clinical_director', 'supervisor'] as const)(
    'denies %s (view-only — no invite.edit)',
    async (role) => {
      mockAuth.mockResolvedValue({
        user: { id: 'admin-1', email: 'a@acme.com', role, organizationId: 'org-1' },
      });

      const result = await resendInvite('invite-1');

      expect(result).toEqual({ success: false, error: 'Insufficient permissions' });
      expect(prismaMock.invite.update).not.toHaveBeenCalled();
    },
  );

  it('allows hr to resend an invite', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'hr-1', email: 'hr@acme.com', role: 'hr', organizationId: 'org-1' },
    });

    const result = await resendInvite('invite-1');

    expect(result).toEqual({ success: true });
    expect(prismaMock.invite.update).toHaveBeenCalledOnce();
  });
});

describe('resendInvite — authorization', () => {
  it('rejects when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await resendInvite('invite-1');

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
  });

  it('rejects a non-admin caller', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'w-1', email: 'w@a.com', role: 'nurse', organizationId: 'org-1' },
    });

    const result = await resendInvite('invite-1');

    expect(result).toEqual({ success: false, error: 'Insufficient permissions' });
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
  });

  it('rejects when the invite belongs to a different organization', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({ ...PENDING_INVITE, organizationId: 'org-2' });

    const result = await resendInvite('invite-1');

    expect(result).toEqual({
      success: false,
      error: 'Invite does not belong to your organization',
    });
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
  });

  it('returns "Invite not found" for an unknown invite id', async () => {
    prismaMock.invite.findUnique.mockResolvedValue(null);

    const result = await resendInvite('bad-id');

    expect(result).toEqual({ success: false, error: 'Invite not found' });
  });
});

describe('resendInvite — already-accepted invite', () => {
  it('does not regenerate the token and returns a clear, non-throwing error', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({ ...PENDING_INVITE, status: 'accepted' });

    const result = await resendInvite('invite-1');

    expect(result).toEqual({
      success: false,
      error: 'This invite has already been accepted.',
    });
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
    expect(mockSendInviteEmail).not.toHaveBeenCalled();
  });
});

describe('resendInvite — happy path (token + expiry regeneration, status reset)', () => {
  it('regenerates the token, sets a ~7-day expiry, resets status to pending, and emails the link', async () => {
    const before = Date.now();
    const result = await resendInvite('invite-1');
    const after = Date.now();

    expect(result).toEqual({ success: true });

    const updateCall = prismaMock.invite.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'invite-1' });
    expect(updateCall.data.status).toBe('pending');
    expect(typeof updateCall.data.token).toBe('string');
    expect(updateCall.data.token.length).toBeGreaterThan(0);

    const expiresAt: Date = updateCall.data.expiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + SEVEN_DAYS_MS - 5_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + SEVEN_DAYS_MS + 5_000);

    expect(mockSendInviteEmail).toHaveBeenCalledWith(
      'newstaff@example.com',
      expect.stringContaining(`https://app.example.com/join/${updateCall.data.token}`),
      'Acme Co',
      'nurse',
    );
  });

  it('generates a DIFFERENT token each call, invalidating any previously-shared link', async () => {
    await resendInvite('invite-1');
    const firstToken = prismaMock.invite.update.mock.calls[0][0].data.token;

    prismaMock.invite.update.mockClear();
    await resendInvite('invite-1');
    const secondToken = prismaMock.invite.update.mock.calls[0][0].data.token;

    expect(secondToken).not.toBe(firstToken);
  });
});

/**
 * F-009 regression tests for getStaffDetails — cross-tenant isolation.
 *
 * Previously, any authenticated admin could pull another organization's
 * worker details (courses, progress, manager) simply by knowing/guessing an
 * OrganizationUser id, because the lookup never compared the target's
 * organizationId to the caller's. The fix requires the caller be an admin
 * WITH an organizationId and returns null when the target belongs to a
 * different org.
 */
describe('getStaffDetails — org isolation (F-009)', () => {
  const ADMIN_ORG_A = { id: 'admin-a', role: 'owner', organizationId: 'org-a' };

  function makeTargetOrgUser(organizationId: string) {
    return {
      id: 'target-1',
      role: 'nurse',
      jobTitle: 'Nurse',
      managerId: null,
      organizationId,
      user: { fullName: 'Target User', email: 'target@example.com', avatarUrl: null },
      manager: null,
      facilities: [],
      enrollments: [],
    };
  }

  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: ADMIN_ORG_A });
  });

  it('returns null when the target user belongs to a different organization (cross-tenant)', async () => {
    mockOrgUserFindUnique.mockResolvedValue(makeTargetOrgUser('org-b'));

    const result = await getStaffDetails('target-1');

    expect(result).toBeNull();
  });

  it('returns the staff details when the target user belongs to the same organization', async () => {
    mockOrgUserFindUnique.mockResolvedValue(makeTargetOrgUser('org-a'));

    const result = await getStaffDetails('target-1');

    expect(result).not.toBeNull();
    expect(result?.user.email).toBe('target@example.com');
    expect(result?.user.name).toBe('Target User');
  });

  it('rejects (throws) when the caller is not an admin', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'worker-1', role: 'nurse', organizationId: 'org-a' },
    });

    await expect(getStaffDetails('target-1')).rejects.toThrow('Unauthorized');
    expect(mockOrgUserFindUnique).not.toHaveBeenCalled();
  });

  it('rejects (throws) when the admin session has no organizationId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-a', role: 'owner', organizationId: null } });

    await expect(getStaffDetails('target-1')).rejects.toThrow('Unauthorized');
    expect(mockOrgUserFindUnique).not.toHaveBeenCalled();
  });

  it('rejects (throws) when there is no session at all', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(getStaffDetails('target-1')).rejects.toThrow('Unauthorized');
    expect(mockOrgUserFindUnique).not.toHaveBeenCalled();
  });
});

/**
 * F-010 regression tests for getEnrollmentQuizResult — cross-tenant isolation.
 *
 * Previously an admin could pull the full quiz breakdown (including the
 * correct answers and the worker's name/email) for an enrollment belonging to
 * a completely different organization. The fix returns null when the
 * enrollment's OrganizationUser organizationId doesn't match the caller's.
 */
describe('getEnrollmentQuizResult — org isolation (F-010)', () => {
  const ADMIN_ORG_A = { id: 'admin-a', role: 'owner', organizationId: 'org-a' };
  const ENROLLMENT_ID = 'enrollment-1';

  function makeEnrollment(organizationId: string) {
    return {
      id: ENROLLMENT_ID,
      organizationUser: {
        organizationId,
        user: { email: 'worker@example.com', fullName: 'Worker Name' },
        organization: { name: 'Acme Co' },
      },
      course: { title: 'Fire Safety' },
      quizAttempts: [
        {
          score: 50,
          timeTaken: 120,
          attemptCount: 1,
          answers: [{ questionId: 'q1', selectedAnswer: '4', explanation: 'basic math' }],
          quiz: {
            allowedAttempts: 3,
            passingScore: 70,
            questions: [
              {
                id: 'q1',
                text: 'What is 2+2?',
                options: ['3', '4', '5'],
                correctAnswer: '4',
              },
            ],
          },
        },
      ],
    };
  }

  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: ADMIN_ORG_A });
  });

  it('returns null for a cross-org enrollment (no correctAnswer or worker identity leaked)', async () => {
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('org-b'));

    const result = await getEnrollmentQuizResult(ENROLLMENT_ID);

    expect(result).toBeNull();
  });

  it('returns the quiz result for a same-org enrollment', async () => {
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('org-a'));

    const result = await getEnrollmentQuizResult(ENROLLMENT_ID);

    expect(result).not.toBeNull();
    expect(result?.courseName).toBe('Fire Safety');
    expect(result?.userName).toBe('Worker Name');
    expect(result?.correct).toBe(1);
    expect(result?.wrong).toBe(0);
    expect(result?.questions[0].correctAnswer).toBe('B');
  });

  it('returns null when there are no quiz attempts yet, before the org check runs', async () => {
    mockEnrollmentFindUnique.mockResolvedValue({
      ...makeEnrollment('org-a'),
      quizAttempts: [],
    });

    const result = await getEnrollmentQuizResult(ENROLLMENT_ID);

    expect(result).toBeNull();
  });

  it('rejects (throws) when the caller is not an admin', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'worker-1', role: 'nurse', organizationId: 'org-a' },
    });

    await expect(getEnrollmentQuizResult(ENROLLMENT_ID)).rejects.toThrow('Unauthorized');
    expect(mockEnrollmentFindUnique).not.toHaveBeenCalled();
  });
});

/**
 * QA ISSUE 2 regression: removeStaff() previously only nulled organizationId,
 * leaving the removed user's live session (and any future login, until the
 * JWT naturally expired) intact — a removed user could still reach a
 * `/dashboard` shell. The fix deactivates the OrganizationUser membership AND
 * bumps the identity's sessionVersion in the SAME transaction so the F-059
 * kill-switch invalidates any live session on its next JWT decode.
 */
describe('removeStaff() — org disconnect + sessionVersion bump (QA ISSUE 2)', () => {
  const ADMIN_SESSION = makeAdminSession('owner');
  const ADMIN_ORG_USER = {
    role: 'owner',
    organizationId: 'org-1',
    user: { email: 'admin@acme.com' },
    organization: { name: 'Acme Co' },
  };
  const TARGET_ORG_USER = {
    organizationId: 'org-1',
    userId: 'target-user-1',
    user: { email: 'removed@acme.com', fullName: 'Removed Staffer' },
  };

  beforeEach(() => {
    mockAuth.mockResolvedValue(ADMIN_SESSION);
    mockOrgUserFindUnique
      // First call resolves the calling admin's own membership (via session.user.organizationUserId)...
      .mockResolvedValueOnce(ADMIN_ORG_USER)
      // ...second call resolves the target staff membership.
      .mockResolvedValueOnce(TARGET_ORG_USER);
    mockUserUpdate.mockResolvedValue({});
  });

  it('deactivates the membership AND increments sessionVersion on the identity', async () => {
    const result = await removeStaff('target-1');

    expect(result).toEqual({ success: true });
    expect(mockOrgUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { active: false, deactivatedAt: expect.any(Date) },
    });
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-user-1' },
      data: { sessionVersion: { increment: 1 } },
    });
  });

  it('records a staff.remove audit entry on the successful path', async () => {
    await removeStaff('target-1');

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.remove',
        actorId: 'admin-1',
        targetType: 'user',
        targetId: 'target-1',
      }),
    );
  });

  it("commit 66aa961: busts the removed user's cached revalidation snapshot, with THEIR identity id, after the transaction commits", async () => {
    await removeStaff('target-1');

    // 'target-1' is the organizationUserId the action is called with; the cache
    // is keyed by IDENTITY, so it must be busted with the membership's userId.
    expect(mockInvalidateRevalidationCache).toHaveBeenCalledExactlyOnceWith('target-user-1');
    expect(mockTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockInvalidateRevalidationCache.mock.invocationCallOrder[0],
    );
  });

  it('rejects removing the organization owner — the owner seat is irrevocable', async () => {
    mockOrgUserFindUnique.mockReset();
    mockOrgUserFindUnique
      .mockResolvedValueOnce(ADMIN_ORG_USER)
      .mockResolvedValueOnce({ ...TARGET_ORG_USER, role: 'owner' });

    const result = await removeStaff('target-1');

    expect(result).toEqual({
      success: false,
      error: 'The organization owner cannot be removed.',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects self-removal — the caller cannot remove their own membership', async () => {
    // 'ou-admin-1' is the caller's own organizationUserId from makeAdminSession.
    const result = await removeStaff('ou-admin-1');

    expect(result).toEqual({
      success: false,
      error: 'You cannot remove your own account from the organization.',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockOrgUserUpdate).not.toHaveBeenCalled();
  });

  it('rejects when the caller has no session', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await removeStaff('target-1');

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(mockOrgUserUpdate).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });

  it('rejects when the target user belongs to a different organization', async () => {
    mockOrgUserFindUnique
      .mockReset()
      .mockResolvedValueOnce(ADMIN_ORG_USER)
      .mockResolvedValueOnce({ ...TARGET_ORG_USER, organizationId: 'org-OTHER' });

    const result = await removeStaff('target-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not belong to your organization/i);
    expect(mockOrgUserUpdate).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });

  it('rejects when the target user is not found', async () => {
    mockOrgUserFindUnique
      .mockReset()
      .mockResolvedValueOnce(ADMIN_ORG_USER)
      .mockResolvedValueOnce(null);

    const result = await removeStaff('target-1');

    expect(result).toEqual({ success: false, error: 'User not found' });
    expect(mockOrgUserUpdate).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });

  it('still returns success even if the removal notification emails fail', async () => {
    mockSendStaffRemovedEmail.mockRejectedValue(new Error('SMTP down'));

    const result = await removeStaff('target-1');

    expect(result).toEqual({ success: true });
    // The DB mutation (the security-relevant part) already happened.
    expect(mockOrgUserUpdate).toHaveBeenCalledOnce();
    expect(mockInvalidateRevalidationCache).toHaveBeenCalledExactlyOnceWith('target-user-1');
  });

  it('OBSERVATION (not currently exploitable): removeStaff has no local try/catch around invalidateRevalidationCache — it relies entirely on that module\'s own internal fail-safety. If it ever violated its "never rethrows" contract, the already-committed removal would be reported as a failure', async () => {
    // The REAL invalidateRevalidationCache() catches every Redis error
    // internally and is documented to never rethrow — this mock deliberately
    // violates that contract to pin down what removeStaff's single top-level
    // try/catch does in that (currently unreachable) case: the DB transaction
    // already committed, but the caller sees `success: false`. Unlike the
    // notification-email block a few lines below it (which has its own
    // dedicated try/catch specifically so a non-critical failure can't mask a
    // successful removal), this call site has no equivalent local guard.
    mockInvalidateRevalidationCache.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await removeStaff('target-1');

    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(result).toEqual({ success: false, error: 'ECONNREFUSED' });
  });
});

/**
 * fix/worker-invite: removeStaff() now drops the removed user's IN-FLIGHT
 * enrollments (so a subsequent re-invite yields a clean slate) while
 * retaining terminal/completed ones for compliance history, and expires any
 * pending Invite for that email in the org (so a live `/join` token can't
 * immediately re-add the person). All four writes — the enrollment cleanup,
 * the membership deactivation, the identity sessionVersion bump, and the
 * invite expiry — run inside a single $transaction.
 */
describe('removeStaff() — drops in-flight enrollments and expires pending invites (fix/worker-invite)', () => {
  const ADMIN_SESSION = makeAdminSession('owner');
  const ADMIN_ORG_USER = {
    role: 'owner',
    organizationId: 'org-1',
    user: { email: 'admin@acme.com' },
    organization: { name: 'Acme Co' },
  };
  const TARGET_ORG_USER = {
    organizationId: 'org-1',
    userId: 'target-user-1',
    user: { email: 'removed@acme.com', fullName: 'Removed Staffer' },
  };

  beforeEach(() => {
    mockAuth.mockResolvedValue(ADMIN_SESSION);
    mockOrgUserFindUnique
      .mockResolvedValueOnce(ADMIN_ORG_USER)
      .mockResolvedValueOnce(TARGET_ORG_USER);
    mockUserUpdate.mockResolvedValue({});
  });

  it('deletes only the active-status enrollments for the removed membership', async () => {
    mockEnrollmentDeleteMany.mockResolvedValue({ count: 2 });

    await removeStaff('target-1');

    expect(mockEnrollmentDeleteMany).toHaveBeenCalledWith({
      where: {
        organizationUserId: 'target-1',
        status: { in: ['enrolled', 'assigned', 'in_progress', 'lessons_complete'] },
      },
    });
    // Terminal statuses (completed, attested, locked, failed, retry_requested)
    // are never named in the deleteMany filter — they are retained by omission.
    const call = mockEnrollmentDeleteMany.mock.calls[0][0];
    expect(call.where.status.in).not.toContain('completed');
    expect(call.where.status.in).not.toContain('attested');
  });

  it("expires (not deletes) any pending invite for the removed user's email in the org", async () => {
    await removeStaff('target-1');

    expect(mockInviteUpdateMany).toHaveBeenCalledWith({
      where: { email: 'removed@acme.com', organizationId: 'org-1', status: 'pending' },
      data: { status: 'expired' },
    });
  });

  it('runs the enrollment cleanup, membership deactivation, sessionVersion bump, and invite expiry inside a single $transaction', async () => {
    await removeStaff('target-1');

    expect(mockTransaction).toHaveBeenCalledOnce();
    const opsCountAtCallTime = mockTransaction.mock.calls[0][0].length;
    // 4 ops: enrollment.deleteMany, organizationUser.update (deactivate),
    // user.update (sessionVersion bump), invite.updateMany. Previously the
    // membership deactivation and the identity's sessionVersion bump were a
    // single combined User write; the multi-org split separates "deactivate
    // the org membership" from "kill the identity's live sessions" into two
    // distinct writes on two distinct models.
    expect(opsCountAtCallTime).toBe(4);
    expect(mockEnrollmentDeleteMany).toHaveBeenCalledOnce();
    expect(mockOrgUserUpdate).toHaveBeenCalledOnce();
    expect(mockUserUpdate).toHaveBeenCalledOnce();
    expect(mockInviteUpdateMany).toHaveBeenCalledOnce();
  });

  it('records the dropped-enrollment count on the staff.remove audit entry', async () => {
    mockEnrollmentDeleteMany.mockResolvedValue({ count: 3 });

    await removeStaff('target-1');

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.remove',
        metadata: { droppedEnrollmentCount: 3 },
      }),
    );
  });

  it('records a zero dropped-enrollment count when the removed user had no in-flight training', async () => {
    mockEnrollmentDeleteMany.mockResolvedValue({ count: 0 });

    await removeStaff('target-1');

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { droppedEnrollmentCount: 0 } }),
    );
  });
});

/**
 * Permission-gate matrix for removeStaff: gated on `can(..., 'user.delete')`.
 * Finance and Clinical Director are view-only on staff and must be denied.
 * RBAC ruling: Supervisor was demoted to read-only and no longer holds
 * user.delete either. Per the approved plan's user decision ("HR keeps full
 * staff CRUD"), HR must retain remove-staff rights.
 */
describe('removeStaff() — permission matrix (user.delete gate)', () => {
  it.each(['finance', 'clinical_director', 'supervisor'] as const)(
    'denies %s (view-only — no user.delete)',
    async (role) => {
      mockAuth.mockResolvedValue({
        user: {
          id: 'admin-1',
          email: 'a@acme.com',
          role,
          organizationId: 'org-1',
          organizationUserId: 'ou-admin-1',
        },
      });
      mockOrgUserFindUnique.mockResolvedValueOnce({
        role,
        organizationId: 'org-1',
        user: { email: 'a@acme.com' },
        organization: { name: 'Acme Co' },
      });

      const result = await removeStaff('target-1');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/insufficient permissions/i);
      expect(mockOrgUserUpdate).not.toHaveBeenCalled();
    },
  );

  it('allows hr to remove a staff member (full staff CRUD per plan decision)', async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: 'hr-1',
        email: 'hr@acme.com',
        role: 'hr',
        organizationId: 'org-1',
        organizationUserId: 'ou-hr-1',
      },
    });
    mockOrgUserFindUnique
      .mockResolvedValueOnce({
        role: 'hr',
        organizationId: 'org-1',
        user: { email: 'hr@acme.com' },
        organization: { name: 'Acme Co' },
      })
      .mockResolvedValueOnce({
        organizationId: 'org-1',
        userId: 'target-user-1',
        user: { email: 'removed@acme.com', fullName: 'Removed Staffer' },
      });

    const result = await removeStaff('target-1');

    expect(result).toEqual({ success: true });
    expect(mockOrgUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { active: false, deactivatedAt: expect.any(Date) },
    });
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-user-1' },
      data: { sessionVersion: { increment: 1 } },
    });
  });
});

// ── setStaffFacilities ───────────────────────────────────────────────────────

describe('setStaffFacilities', () => {
  function makeSession(role: string, overrides: Record<string, unknown> = {}) {
    return {
      user: {
        id: 'admin-1',
        organizationId: 'org-1',
        organizationUserId: 'ou-admin',
        role,
        ...overrides,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(makeSession('owner'));
    mockOrgUserFindUnique.mockResolvedValue({ organizationId: 'org-1' });
    const ORG_FACILITY_IDS = ['fac-1', 'fac-2'];
    // Mirrors the real query's org-scoping filter: only ids that are both
    // requested AND owned by the org come back.
    mockFacilityFindMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        where.id.in.filter((id) => ORG_FACILITY_IDS.includes(id)).map((id) => ({ id })),
      ),
    );
  });

  it('rejects when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await setStaffFacilities('target-1', ['fac-1']);

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(mockOrgUserFacilityUpdateMany).not.toHaveBeenCalled();
  });

  it.each(['supervisor', 'finance', 'clinical_director'])(
    'denies role=%s — lacks user.edit',
    async (role) => {
      mockAuth.mockResolvedValue(makeSession(role));

      const result = await setStaffFacilities('target-1', ['fac-1']);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(mockOrgUserFindUnique).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'admin', 'hr'])('allows role=%s (holds user.edit)', async (role) => {
    mockAuth.mockResolvedValue(makeSession(role));

    const result = await setStaffFacilities('target-1', ['fac-1']);

    expect(result).toEqual({ success: true });
  });

  it("rejects reassigning the owner's facilities — owner scope is org-wide", async () => {
    mockOrgUserFindUnique.mockResolvedValue({ organizationId: 'org-1', role: 'owner' });

    const result = await setStaffFacilities('target-owner', ['fac-1']);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/owner's facilities cannot be changed/i);
    expect(mockOrgUserFacilityUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects an empty facility list rather than clearing every assignment', async () => {
    const result = await setStaffFacilities('target-1', []);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least one facility/i);
    expect(mockOrgUserFindUnique).not.toHaveBeenCalled();
  });

  it('de-duplicates a facility list with repeats before writing', async () => {
    await setStaffFacilities('target-1', ['fac-1', 'fac-1', 'fac-2']);

    expect(mockFacilityFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['fac-1', 'fac-2'] }, organizationId: 'org-1' },
      select: { id: true },
    });
    expect(mockOrgUserFacilityUpsert).toHaveBeenCalledTimes(2);
  });

  it('rejects (Forbidden) when the target membership belongs to a different organization', async () => {
    mockOrgUserFindUnique.mockResolvedValue({ organizationId: 'org-OTHER' });

    const result = await setStaffFacilities('target-1', ['fac-1']);

    expect(result).toEqual({ success: false, error: 'Forbidden' });
    expect(mockOrgUserFacilityUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects (Forbidden) when the target membership does not exist', async () => {
    mockOrgUserFindUnique.mockResolvedValue(null);

    const result = await setStaffFacilities('ghost-target', ['fac-1']);

    expect(result).toEqual({ success: false, error: 'Forbidden' });
  });

  it("rejects when a requested facility id does not belong to the caller's organization", async () => {
    // Only fac-1 resolves as owned; fac-foreign is silently absent from the
    // ownedFacilities lookup result — a crafted request must not smuggle a
    // membership into another tenant's facility.
    mockFacilityFindMany.mockResolvedValue([{ id: 'fac-1' }]);

    const result = await setStaffFacilities('target-1', ['fac-1', 'fac-foreign']);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not in your organization/i);
    expect(mockOrgUserFacilityUpdateMany).not.toHaveBeenCalled();
  });

  it('deactivates assignments not in the requested set and upserts (create-or-reactivate) each requested facility', async () => {
    await setStaffFacilities('target-1', ['fac-1', 'fac-2']);

    expect(mockOrgUserFacilityUpdateMany).toHaveBeenCalledWith({
      where: {
        organizationUserId: 'target-1',
        active: true,
        facilityId: { notIn: ['fac-1', 'fac-2'] },
      },
      data: { active: false, deactivatedAt: expect.any(Date) },
    });
    expect(mockOrgUserFacilityUpsert).toHaveBeenCalledWith({
      where: {
        organizationUserId_facilityId: { organizationUserId: 'target-1', facilityId: 'fac-1' },
      },
      update: { active: true, deactivatedAt: null },
      create: { organizationUserId: 'target-1', facilityId: 'fac-1' },
    });
    expect(mockOrgUserFacilityUpsert).toHaveBeenCalledWith({
      where: {
        organizationUserId_facilityId: { organizationUserId: 'target-1', facilityId: 'fac-2' },
      },
      update: { active: true, deactivatedAt: null },
      create: { organizationUserId: 'target-1', facilityId: 'fac-2' },
    });
  });

  it('never touches enrollments or certificates — training history is preserved by construction', async () => {
    await setStaffFacilities('target-1', ['fac-1']);

    expect(prismaMock.enrollment.deleteMany).not.toHaveBeenCalled();
  });

  it('returns a generic failure without throwing when the transaction rejects', async () => {
    mockTransaction.mockRejectedValueOnce(new Error('db down'));

    const result = await setStaffFacilities('target-1', ['fac-1']);

    expect(result).toEqual({ success: false, error: 'Failed to update facility assignments' });
  });
});
