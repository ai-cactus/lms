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
  mockOrgUserFindMany,
  mockListAccessibleFacilities,
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
  const mockOrgUserFindMany = vi.fn();
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
      findMany: mockOrgUserFindMany,
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
    mockOrgUserFindMany,
    mockListAccessibleFacilities: vi.fn(),
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
// The facility narrowing itself is exercised for real (target-scope and
// staff-where are NOT mocked); only the roster lookup behind the caller's
// accessible set is stubbed, so a supervisor session resolves to a real scope.
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
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
  mockOrgUserFindMany.mockResolvedValue([]);
  mockListAccessibleFacilities.mockResolvedValue([]);
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
 * Actor-role gate for updateStaffDetails: STAFF_PROFILE_ACTOR_ROLES, NOT
 * `can(..., 'user.edit')`. Founder Q2 grants the supervisor basic profile
 * editing (name, job title, contact) over their own facility, while `user.edit`
 * also gates the facility move and the role change — both reserved for
 * Owner/Admin/HR. Finance and Clinical Director hold `user.read` only and stay
 * denied.
 */
describe('updateStaffDetails() — permission matrix (STAFF_PROFILE_ACTOR_ROLES gate)', () => {
  it.each(['finance', 'clinical_director', 'nurse'] as const)(
    'denies %s (view-only on staff) before touching the database',
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

  // Q2: the supervisor's "U" on Staff Management, delivered as this actor list
  // rather than as a `user.edit` grant.
  it('allows a supervisor to edit a profile for staff inside their own facility', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'sup-1', email: 'sup@acme.com', role: 'supervisor', organizationId: 'org-1' },
    });
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);
    mockOrgUserFindMany.mockResolvedValue([
      { id: 'target-1', facilities: [{ facilityId: 'fac-1' }] },
    ]);
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-1',
      role: 'nurse',
    });

    const result = await updateStaffDetails('target-1', { ...baseData, role: 'nurse' });

    expect(result.success).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-user-1' },
      data: { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe' },
    });
  });

  // "own facility only" is the other half of Q2 — tenancy alone does not give it.
  it('denies a supervisor editing staff outside their facilities', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'sup-1', email: 'sup@acme.com', role: 'supervisor', organizationId: 'org-1' },
    });
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);
    mockOrgUserFindMany.mockResolvedValue([
      { id: 'target-1', facilities: [{ facilityId: 'fac-2' }] },
    ]);
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-1',
      role: 'nurse',
    });

    const result = await updateStaffDetails('target-1', { ...baseData, role: 'nurse' });

    expect(result).toEqual({ success: false, error: 'Forbidden' });
    expect(mockOrgUserUpdate).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

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
 * In-place role change. A role-changing update runs the pure `canChangeRole`
 * guard from role-utils; only Owner/Admin/HR may re-role a reachable target
 * (ROLE_CHANGE_ACTOR_ROLES), never themselves, and HR's reach is capped at
 * everything below the two Owner-equivalent seats by GRANTABLE_ROLES.hr. A
 * successful change bumps sessionVersion in a separate User
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

  // Founder Q11: HR may re-role everything except the two Owner-equivalent
  // seats. The ceiling is GRANTABLE_ROLES.hr, applied by canChangeRole to both
  // the target's current role and the requested new role.
  it('allows hr to promote a worker to supervisor', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'hr-1', email: 'hr@acme.com', role: 'hr', organizationId: 'org-1' },
    });
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-1',
      role: 'nurse',
    });

    const result = await updateStaffDetails('target-1', { ...baseData, role: 'supervisor' });

    expect(result).toEqual({ success: true });
    expect(mockOrgUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: expect.objectContaining({ role: 'supervisor', roleAssignedAt: expect.any(Date) }),
    });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'staff.role.change' }),
    );
  });

  it('denies hr promoting a target to admin — the Owner-equivalent escalation fence', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'hr-1', email: 'hr@acme.com', role: 'hr', organizationId: 'org-1' },
    });
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-1',
      role: 'nurse',
    });

    const result = await updateStaffDetails('target-1', { ...baseData, role: 'admin' });

    expect(result.success).toBe(false);
    expect(mockOrgUserUpdate).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('denies hr re-roling an admin target — an admin is out of HR reach', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'hr-1', email: 'hr@acme.com', role: 'hr', organizationId: 'org-1' },
    });
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-1',
      role: 'admin',
    });

    const result = await updateStaffDetails('target-1', { ...baseData, role: 'nurse' });

    expect(result.success).toBe(false);
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

  // A supervisor now REACHES this action for profile edits (Q2), so the
  // role-change refusal has to come from `canChangeRole` — supervisor is not in
  // ROLE_CHANGE_ACTOR_ROLES — rather than from the outer gate. The target here
  // is inside their facility precisely so nothing else can be doing the work.
  it("denies a supervisor changing a staff member's role, even inside their own facility", async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'sup-1', email: 'sup@acme.com', role: 'supervisor', organizationId: 'org-1' },
    });
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);
    mockOrgUserFindMany.mockResolvedValue([
      { id: 'target-1', facilities: [{ facilityId: 'fac-1' }] },
    ]);
    mockOrgUserFindUnique.mockResolvedValue({
      userId: 'target-user-1',
      organizationId: 'org-1',
      role: 'nurse',
    });

    const result = await updateStaffDetails('target-1', { ...baseData, role: 'hr' });

    expect(result).toEqual({
      success: false,
      error: "Only an Owner, Admin or HR can change a staff member's role.",
    });
    expect(mockOrgUserUpdate).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
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
 * caller's org, then delegates the actual enrollment mechanics to
 * `enrollUsers` — under the per-person `deadlineScope` its successor uses, so
 * the revert path cannot reintroduce BUG-20.
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

    expect(mockEnrollUsers).toHaveBeenCalledWith(
      'course-1',
      [{ email: 'target@acme.com' }],
      { renewalCycle: 'annual' },
      { deadlineScope: 'enrollment' },
    );
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
      user: {
        fullName: 'Target User',
        email: 'target@example.com',
        avatarUrl: null,
        firstName: 'Target',
        lastName: 'User',
      },
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

  // The profile page's Edit Profile / Change Role modals echo back whichever of
  // `updateStaffDetails`' four fields they do not edit, so these three must be
  // the STORED record, never a display fallback.
  it('reports the editable name and job-title fields verbatim', async () => {
    mockOrgUserFindUnique.mockResolvedValue(makeTargetOrgUser('org-a'));

    const result = await getStaffDetails('target-1');

    expect(result?.user.firstName).toBe('Target');
    expect(result?.user.lastName).toBe('User');
    expect(result?.user.jobTitle).toBe('Nurse');
  });

  // BUG-17: the profile's course table draws a video course from this value, so
  // it must be the access-checked route URL — never a raw storage URI — and
  // null (the placeholder) when nothing resolves.
  it('hands each enrollment the thumbnail route URL, or null when nothing resolves', async () => {
    const lessonUpdatedAt = new Date('2026-09-10T00:00:00.000Z');
    const enrollment = (courseId: string, type: string, poster: string | null) => ({
      id: `e-${courseId}`,
      courseId,
      status: 'in_progress',
      progress: 0,
      score: null,
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
      completedAt: null,
      dueAt: null,
      course: {
        id: courseId,
        title: courseId,
        type,
        thumbnailStorageUri: null,
        previewPosterStorageUri: null,
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        lessons: [{ videoPosterStorageUri: poster, updatedAt: lessonUpdatedAt, quiz: null }],
      },
    });
    mockOrgUserFindUnique.mockResolvedValue({
      ...makeTargetOrgUser('org-a'),
      enrollments: [
        enrollment('video-1', 'video', 'gcs://lms/system/videos/posters/1.jpg'),
        enrollment('video-2', 'video', null),
        enrollment('reading-1', 'text', 'gcs://lms/system/videos/posters/2.jpg'),
      ],
    });

    const result = await getStaffDetails('target-1');

    const images = Object.fromEntries(result!.enrollments.map((e) => [e.courseId, e.courseImage]));
    expect(images).toEqual({
      'video-1': `/api/courses/video-1/thumbnail?v=${lessonUpdatedAt.getTime()}`,
      'video-2': null,
      'reading-1': null,
    });
    const courseSelect =
      mockOrgUserFindUnique.mock.calls[0][0].select.enrollments.select.course.select;
    expect(courseSelect.lessons.orderBy).toEqual({ order: 'asc' });
  });

  it('reports a blank job title as blank rather than substituting a placeholder', async () => {
    mockOrgUserFindUnique.mockResolvedValue({
      ...makeTargetOrgUser('org-a'),
      jobTitle: null,
      user: {
        fullName: 'Target User',
        email: 'target@example.com',
        avatarUrl: null,
        firstName: null,
        lastName: null,
      },
    });

    const result = await getStaffDetails('target-1');

    // A placeholder here would make Change Role silently write "Staff Member"
    // into a job title the admin never touched.
    expect(result?.user.jobTitle).toBe('');
    expect(result?.user.firstName).toBe('');
    expect(result?.user.lastName).toBe('');
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

  /**
   * The gate moved from `assignment.read` to `isAdminRole && assessment.read`.
   *
   * `assignment` is the org's auto-enrolment configuration; `assessment` is
   * "Quizzes, questions & question-by-question attempt logs" — this payload.
   * Two different resources, which is why this gate reads the assessment verb
   * regardless of which roles hold it at any given moment.
   *
   * HR is one of them, by founder ruling — "HR can build quizzes and view
   * results" (docs/local/RBAC_for_multi-tenancy-updated.md). This gate briefly
   * excluded HR on the strength of the role's own registry description, which
   * he reversed when asked (docs/local/RBAC-founder-answers-2026-09-15.md).
   * Finance is still out: it holds no `assessment.*` at all.
   */
  describe('the verb: isAdminRole && assessment.read', () => {
    it.each(['owner', 'admin', 'supervisor', 'clinical_director', 'hr'])(
      '%s is admitted',
      async (role) => {
        mockAuth.mockResolvedValue({ user: { id: 'a-1', role, organizationId: 'org-a' } });
        mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('org-a'));

        await expect(getEnrollmentQuizResult(ENROLLMENT_ID)).resolves.not.toBeNull();
      },
    );

    it('USER-VISIBLE: HR reads question-level scores, per the founder ruling', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'hr-1', role: 'hr', organizationId: 'org-a' } });
      mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('org-a'));

      await expect(getEnrollmentQuizResult(ENROLLMENT_ID)).resolves.not.toBeNull();
    });

    it('finance stays denied', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'f-1', role: 'finance', organizationId: 'org-a' } });

      await expect(getEnrollmentQuizResult(ENROLLMENT_ID)).rejects.toThrow('Unauthorized');
    });

    /**
     * DEFENCE IN DEPTH — this module's `auth` is the admin instance, which
     * invalidates any session whose freshly-read role is not an admin role
     * (`auth.ts:6` + `create-auth-instance.ts:736`), so the sessions staged
     * below cannot exist and this proves less than its shape suggests.
     *
     * Kept because every worker role holds `assessment.read` (granted so a
     * learner can read their OWN attempt), so the tier check is what would save
     * this action if it ever moved to a resolve-either-instance session — as
     * `getEnrollmentWithResults` uses, where the same check IS load-bearing
     * against a session a nurse can really hold.
     */
    it.each(['nurse', 'therapist_clinician', 'front_desk_admin'])(
      '%s would be denied even if the admin instance ever stopped fencing it out',
      async (role) => {
        mockAuth.mockResolvedValue({ user: { id: 'w-1', role, organizationId: 'org-a' } });

        await expect(getEnrollmentQuizResult(ENROLLMENT_ID)).rejects.toThrow('Unauthorized');
        expect(mockEnrollmentFindUnique).not.toHaveBeenCalled();
      },
    );
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
 * Founder decision Q23 (docs/local/RBAC-founder-answers-2026-09-15.md):
 * "Delete deactivated account but records should be kept for compliance
 * purposes." removeStaff() therefore revokes ACCESS only — it deactivates the
 * membership, bumps the identity's sessionVersion, and expires any pending
 * Invite for that email in the org (so a live `/join` token can't immediately
 * re-add the person) — and deletes NO training record of any status.
 *
 * This supersedes the earlier fix/worker-invite behaviour, which deleted the
 * in-flight ("active"-status) enrollments so a re-invite got a clean slate.
 * That clean slate destroyed the evidence that training had been started but
 * not finished, so it was reversed. The three remaining writes still run
 * inside a single $transaction.
 */
describe('removeStaff() — retains training records and expires pending invites (Q23)', () => {
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

  it('COMPLIANCE (Q23): deletes no enrollment of any status — in-flight training history is retained, not wiped', async () => {
    await removeStaff('target-1');

    expect(mockEnrollmentDeleteMany).not.toHaveBeenCalled();

    // Asserted at the transaction level too, so a deletion reintroduced as a
    // fourth op is caught even if it were routed around the delegate above.
    expect(mockTransaction.mock.calls[0][0]).toHaveLength(3);
  });

  it('COMPLIANCE (Q23): deactivates the membership rather than deleting it, so the retained records keep an owner', async () => {
    await removeStaff('target-1');

    expect(mockOrgUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { active: false, deactivatedAt: expect.any(Date) },
    });
  });

  it('still revokes access: the sessionVersion bump kills live sessions on their next decode', async () => {
    await removeStaff('target-1');

    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'target-user-1' },
      data: { sessionVersion: { increment: 1 } },
    });
  });

  it("expires (not deletes) any pending invite for the removed user's email in the org", async () => {
    await removeStaff('target-1');

    expect(mockInviteUpdateMany).toHaveBeenCalledWith({
      where: { email: 'removed@acme.com', organizationId: 'org-1', status: 'pending' },
      data: { status: 'expired' },
    });
  });

  it('runs the membership deactivation, sessionVersion bump, and invite expiry inside a single $transaction', async () => {
    await removeStaff('target-1');

    expect(mockTransaction).toHaveBeenCalledOnce();
    // 3 ops: organizationUser.update (deactivate), user.update (sessionVersion
    // bump), invite.updateMany. Deactivating the org membership and killing the
    // identity's live sessions are two writes on two models because of the
    // multi-org split.
    expect(mockTransaction.mock.calls[0][0]).toHaveLength(3);
    expect(mockOrgUserUpdate).toHaveBeenCalledOnce();
    expect(mockUserUpdate).toHaveBeenCalledOnce();
    expect(mockInviteUpdateMany).toHaveBeenCalledOnce();
  });

  it('records the retention rule on the staff.remove audit entry', async () => {
    await removeStaff('target-1');

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.remove',
        targetType: 'user',
        targetId: 'target-1',
        metadata: { enrollmentsRetained: true },
      }),
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

  // Rule A: only Owner/Admin/HR may move staff between facilities. Supervisor is
  // the load-bearing case — it now holds a staff-EDITING power (Q2 profile
  // edits), and this asserts that power stops short of the facility move.
  it.each(['supervisor', 'finance', 'clinical_director'])(
    'denies role=%s — not in FACILITY_CHANGE_ACTOR_ROLES (Rule A)',
    async (role) => {
      mockAuth.mockResolvedValue(makeSession(role));

      const result = await setStaffFacilities('target-1', ['fac-1']);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(mockOrgUserFindUnique).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'admin', 'hr'])('allows role=%s (Rule A actor)', async (role) => {
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

  // The check used to name `owner` alone, which left every other org-wide role
  // reassignable: `resolveDataFacilityIds` returns null for them too, so the
  // write changed no scope while the UI implied it had.
  it.each(['admin', 'hr', 'clinical_director', 'finance'])(
    'rejects reassigning a %s — the role is organization-wide, not facility-bound',
    async (role) => {
      mockOrgUserFindUnique.mockResolvedValue({ organizationId: 'org-1', role });

      const result = await setStaffFacilities('target-global', ['fac-1']);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/organization-wide role/i);
      expect(mockOrgUserFacilityUpdateMany).not.toHaveBeenCalled();
    },
  );

  it.each(['supervisor', 'nurse', 'front_desk_admin'])(
    'still reassigns a facility-bound %s',
    async (role) => {
      mockOrgUserFindUnique.mockResolvedValue({ organizationId: 'org-1', role });

      const result = await setStaffFacilities('target-bound', ['fac-1']);

      expect(result).toEqual({ success: true });
    },
  );

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
