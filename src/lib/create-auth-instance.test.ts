/**
 * Regression tests for the `sessionAllowedRoles` split introduced for the
 * Manage/Learn session-bridge feature (see src/app/actions/session-bridge.ts).
 *
 * The worker auth instance (src/auth.worker.ts) now widens `sessionAllowedRoles`
 * to ALL_ROLES so a bridged admin's worker-cookie JWT survives re-validation —
 * but `allowedRoles` (which gates the worker LOGIN form's `authorize()`) stays
 * WORKER_ROLES. These tests exercise the real `@/auth` / `@/auth.worker` wiring
 * (not a hand-rolled `createAuthInstance` call) so a regression in either
 * module's config is caught here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockFindUnique,
  mockUpdate,
  mockCheckRateLimit,
  mockAudit,
  mockCookieStore,
  mockCookies,
  mockInviteFindFirst,
  mockInviteUpdate,
  mockFacilityFindFirst,
  mockUserCreate,
  mockProfileFindUnique,
  mockProfileCreate,
  mockEnrollUserForRoleTargets,
  mockEnrollInviteCourses,
} = vi.hoisted(() => {
  const mockCookieStore = {
    has: vi.fn().mockReturnValue(false),
    delete: vi.fn(),
    set: vi.fn(),
  };
  return {
    mockFindUnique: vi.fn(),
    mockUpdate: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockAudit: vi.fn(),
    mockCookieStore,
    mockCookies: vi.fn(() => Promise.resolve(mockCookieStore)),
    mockInviteFindFirst: vi.fn(),
    mockInviteUpdate: vi.fn(),
    mockFacilityFindFirst: vi.fn(),
    mockUserCreate: vi.fn(),
    mockProfileFindUnique: vi.fn(),
    mockProfileCreate: vi.fn(),
    mockEnrollUserForRoleTargets: vi.fn(),
    mockEnrollInviteCourses: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => {
  const prisma = {
    user: { findUnique: mockFindUnique, update: mockUpdate, create: mockUserCreate },
    invite: { findFirst: mockInviteFindFirst, update: mockInviteUpdate },
    facility: { findFirst: mockFacilityFindFirst },
    profile: { findUnique: mockProfileFindUnique, create: mockProfileCreate },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock('@/lib/audit', () => ({ audit: mockAudit, getClientContext: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: mockCookies }));
vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn().mockResolvedValue(true), hash: vi.fn().mockResolvedValue('hash') },
  compare: vi.fn().mockResolvedValue(true),
  hash: vi.fn().mockResolvedValue('hash'),
}));
// Live auto-enroll hooks are exercised by their own suites (role-targets has
// none dedicated yet; invite-courses.test.ts covers enrollInviteCourses) —
// this file asserts only that the OAuth signIn callback CALLS them correctly.
vi.mock('@/lib/enrollment/role-targets', () => ({
  enrollUserForRoleTargets: mockEnrollUserForRoleTargets,
}));
vi.mock('@/lib/enrollment/invite-courses', () => ({
  enrollInviteCourses: mockEnrollInviteCourses,
}));

import { adminConfig } from '@/auth';
import { workerConfig } from '@/auth.worker';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAuthorize(config: any) {
  return config.providers[0].options.authorize as (
    credentials: unknown,
    request: Request,
  ) => Promise<unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSignIn(config: any) {
  return config.callbacks!.signIn as (args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    account: any;
  }) => Promise<unknown>;
}

const fakeRequest = () => ({ headers: new Headers({ 'x-forwarded-for': '1.2.3.4' }) }) as Request;

const baseUser = {
  id: 'user-1',
  email: 'person@acme.com',
  // Not a real bcrypt hash — the cost-upgrade regex won't match, so the
  // rehash branch is skipped and bcrypt.compare (mocked above) is what decides.
  password: 'not-a-real-hash',
  organizationId: 'org-1',
  mfaEnabled: false,
  passwordResetRequired: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockUpdate.mockResolvedValue({});
  mockCookieStore.has.mockReturnValue(false);
  mockCookies.mockImplementation(() => Promise.resolve(mockCookieStore));
  mockInviteFindFirst.mockResolvedValue(null);
  mockInviteUpdate.mockResolvedValue({});
  mockFacilityFindFirst.mockResolvedValue({ id: 'facility-1' });
  mockUserCreate.mockResolvedValue({});
  mockProfileFindUnique.mockResolvedValue({ fullName: 'OAuth Person' });
  mockProfileCreate.mockResolvedValue({});
  mockEnrollUserForRoleTargets.mockResolvedValue(undefined);
  mockEnrollInviteCourses.mockResolvedValue(undefined);
});

const freshUserBase = {
  id: 'user-1',
  organizationId: 'org-1',
  mfaEnabled: false,
  mfaVerifiedAt: null,
  passwordResetRequired: false,
  sessionVersion: 1,
  authProvider: 'credentials',
  profile: { fullName: 'Person' },
};

describe('least-privilege regression guard: worker instance authorize()', () => {
  it('rejects an admin-tier user at the worker login form despite sessionAllowedRoles: ALL_ROLES', async () => {
    mockFindUnique.mockResolvedValue({ ...baseUser, role: 'owner' });
    const authorize = getAuthorize(workerConfig);

    const result = await authorize({ email: 'person@acme.com', password: 'pw' }, fakeRequest());

    expect(result).toBeNull();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login.failure',
        metadata: expect.objectContaining({ reason: 'role_mismatch', instance: 'worker' }),
      }),
    );
  });

  it('still allows a genuine worker-tier user through the role gate', async () => {
    mockFindUnique.mockResolvedValue({ ...baseUser, role: 'nurse' });
    const authorize = getAuthorize(workerConfig);

    const result = await authorize({ email: 'person@acme.com', password: 'pw' }, fakeRequest());

    expect(result).not.toBeNull();
    expect(mockAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: 'role_mismatch' }) }),
    );
  });
});

describe('jwt() session re-validation — sessionAllowedRoles vs allowedRoles', () => {
  it('worker instance KEEPS a session whose fresh DB role is admin-tier (sessionAllowedRoles: ALL_ROLES)', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'user-1',
      role: 'owner',
      organizationId: 'org-1',
      mfaEnabled: false,
      mfaVerifiedAt: null,
      passwordResetRequired: false,
      sessionVersion: 1,
      authProvider: 'credentials',
      profile: { fullName: 'Owner Person' },
    });
    const token = { id: 'user-1', role: 'owner', sessionVersion: 1 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (workerConfig.callbacks!.jwt as any)({ token });

    expect(result).not.toBeNull();
    expect(result.role).toBe('owner');
  });

  it('admin instance INVALIDATES a session whose fresh DB role is outside ADMIN_ROLES', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'user-2',
      role: 'nurse',
      organizationId: 'org-1',
      mfaEnabled: false,
      mfaVerifiedAt: null,
      passwordResetRequired: false,
      sessionVersion: 1,
      authProvider: 'credentials',
      profile: { fullName: 'Nick Nurse' },
    });
    const token = { id: 'user-2', role: 'nurse', sessionVersion: 1 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (adminConfig.callbacks!.jwt as any)({ token });

    expect(result).toBeNull();
  });
});

/**
 * ISSUE 2 regression: a removed staff member is a non-owner admin-tier account
 * whose organizationId has been nulled (see removeStaff() in
 * src/app/actions/staff.ts). Login must be denied at the credential layer, and
 * the account's own live JWT must self-invalidate on its next re-validation —
 * both BEFORE and independent of the sessionVersion kill-switch, so a removal
 * path that forgets to bump sessionVersion is still caught.
 */
describe('ISSUE 2 — removed non-owner admin: authorize() denial', () => {
  it('denies login for a non-owner admin-tier account with no organization, with the specific audit reason', async () => {
    mockFindUnique.mockResolvedValue({ ...baseUser, role: 'hr', organizationId: null });
    const authorize = getAuthorize(adminConfig);

    const result = await authorize({ email: 'person@acme.com', password: 'pw' }, fakeRequest());

    expect(result).toBeNull();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login.failure',
        actorRole: 'hr',
        metadata: expect.objectContaining({
          reason: 'removed_from_org',
          instance: 'admin',
        }),
      }),
    );
  });

  it('never reaches the password check for a removed admin (denies before bcrypt.compare)', async () => {
    mockFindUnique.mockResolvedValue({ ...baseUser, role: 'hr', organizationId: null });
    const authorize = getAuthorize(adminConfig);
    const bcrypt = await import('bcryptjs');
    (bcrypt.default.compare as ReturnType<typeof vi.fn>).mockClear();

    await authorize({ email: 'person@acme.com', password: 'wrong' }, fakeRequest());

    expect(bcrypt.default.compare).not.toHaveBeenCalled();
  });

  it('allows an org-less OWNER through the credential layer (owner is the only legitimate org-less admin state)', async () => {
    mockFindUnique.mockResolvedValue({ ...baseUser, role: 'owner', organizationId: null });
    const authorize = getAuthorize(adminConfig);

    const result = await authorize({ email: 'person@acme.com', password: 'pw' }, fakeRequest());

    expect(result).not.toBeNull();
    expect(mockAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ reason: 'removed_from_org' }),
      }),
    );
  });

  it('allows an org-less WORKER-tier account through the worker instance (ISSUE 2 is admin-only)', async () => {
    mockFindUnique.mockResolvedValue({ ...baseUser, role: 'nurse', organizationId: null });
    const authorize = getAuthorize(workerConfig);

    const result = await authorize({ email: 'person@acme.com', password: 'pw' }, fakeRequest());

    expect(result).not.toBeNull();
  });
});

describe('ISSUE 2 — removed non-owner admin: jwt() defense-in-depth', () => {
  it('invalidates (returns null) a live session for a non-owner admin whose fresh DB org is now null', async () => {
    mockFindUnique.mockResolvedValue({ ...freshUserBase, role: 'hr', organizationId: null });
    const token = { id: 'user-1', role: 'hr', sessionVersion: 1 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (adminConfig.callbacks!.jwt as any)({ token });

    expect(result).toBeNull();
  });

  it('keeps a live session for an org-less OWNER (legitimate pre-onboarding state)', async () => {
    mockFindUnique.mockResolvedValue({ ...freshUserBase, role: 'owner', organizationId: null });
    const token = { id: 'user-1', role: 'owner', sessionVersion: 1 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (adminConfig.callbacks!.jwt as any)({ token });

    expect(result).not.toBeNull();
    expect(result.organizationId).toBeNull();
  });

  it('does not apply the org-less-admin guard on the worker instance', async () => {
    mockFindUnique.mockResolvedValue({ ...freshUserBase, role: 'nurse', organizationId: null });
    const token = { id: 'user-1', role: 'nurse', sessionVersion: 1 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (workerConfig.callbacks!.jwt as any)({ token });

    expect(result).not.toBeNull();
  });
});

/**
 * F-059 regression: unrelated to ISSUE 2, but the org-less-admin guard sits
 * directly below the sessionVersion check in jwt() — a prior edit accidentally
 * short-circuiting this would silently disable the password-reset /
 * forced-logout kill-switch. Pin the existing behavior alongside the new guard.
 */
describe('sessionVersion kill-switch regression (F-059)', () => {
  it('invalidates a session whose token sessionVersion no longer matches the fresh DB value', async () => {
    mockFindUnique.mockResolvedValue({ ...freshUserBase, role: 'owner', sessionVersion: 2 });
    const token = { id: 'user-1', role: 'owner', sessionVersion: 1 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (adminConfig.callbacks!.jwt as any)({ token });

    expect(result).toBeNull();
  });

  it('stamps token.sessionVersion (does not invalidate) on first decode after sign-in, when the token has no version yet', async () => {
    mockFindUnique.mockResolvedValue({ ...freshUserBase, role: 'owner', sessionVersion: 3 });
    const token = { id: 'user-1', role: 'owner' };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (adminConfig.callbacks!.jwt as any)({ token });

    expect(result).not.toBeNull();
    expect(result.sessionVersion).toBe(3);
  });
});

/**
 * ISSUE 4 regression: a successful sign-in on one instance must clear the
 * sibling instance's session cookie(s), so two different accounts never hold
 * concurrently-live sessions in the same browser. This unit test pins the
 * LOGIC (which names get expired). Deletion is emitted as an expired `set()`
 * (not a bare `delete()`) so the `__Secure-` prefixed cookie carries the
 * `Secure` attribute the prefix requires — a bare delete omits it and the
 * browser rejects the deletion under https (see src/lib/auth/session-cookies.ts).
 * Whether the cookies() mutation actually attaches to the outgoing NextAuth
 * response is a runtime property verified separately by
 * tests/e2e/rbac-dual-cookie-login.spec.ts.
 */
describe('ISSUE 4 — signIn callback clears the sibling session cookie', () => {
  const expiredWith = (secure: boolean) =>
    expect.objectContaining({
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 0,
      expires: new Date(0),
    });

  it('expires both sibling cookie-name variants on an admin-instance login', async () => {
    const signIn = getSignIn(adminConfig);

    const result = await signIn({
      user: { id: 'user-1', email: 'person@acme.com' },
      account: { provider: 'credentials' },
    });

    expect(result).toBe(true);
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      '__Secure-worker.session-token',
      '',
      expiredWith(true),
    );
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      'worker.session-token',
      '',
      expiredWith(false),
    );
  });

  it('expires both sibling cookie-name variants on a worker-instance login', async () => {
    const signIn = getSignIn(workerConfig);

    const result = await signIn({
      user: { id: 'user-1', email: 'person@acme.com' },
      account: { provider: 'credentials' },
    });

    expect(result).toBe(true);
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      '__Secure-admin.session-token',
      '',
      expiredWith(true),
    );
    expect(mockCookieStore.set).toHaveBeenCalledWith('admin.session-token', '', expiredWith(false));
  });

  it('expires the sibling cookies unconditionally (idempotent no-op when absent) and still returns true', async () => {
    const signIn = getSignIn(adminConfig);

    const result = await signIn({
      user: { id: 'user-1', email: 'person@acme.com' },
      account: { provider: 'credentials' },
    });

    // Expiring an absent cookie is a harmless no-op Set-Cookie, so the callback
    // no longer guards on presence — it always emits both sibling variants.
    expect(result).toBe(true);
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      '__Secure-worker.session-token',
      '',
      expect.anything(),
    );
    expect(mockCookieStore.set).toHaveBeenCalledWith('worker.session-token', '', expect.anything());
  });

  it('never throws and still returns true when cookies() rejects', async () => {
    mockCookies.mockImplementationOnce(() => Promise.reject(new Error('no request scope')));
    const signIn = getSignIn(adminConfig);

    const result = await signIn({
      user: { id: 'user-1', email: 'person@acme.com' },
      account: { provider: 'credentials' },
    });

    expect(result).toBe(true);
  });
});

/**
 * fix/worker-invite: the OAuth (Microsoft Entra ID) signIn callback's two
 * pending-invite branches — a brand-new OAuth user and an org-less existing
 * OAuth user (a removed staffer) rejoining — now call enrollInviteCourses
 * right after enrollUserForRoleTargets, so any course parked on the accepted
 * invite (see src/lib/enrollment/create.test.ts's invite branch) is
 * materialised into a real enrollment at OAuth sign-in time too, not only via
 * the credentials /api/invite/accept route.
 */
describe('OAuth signIn callback — pending-invite auto-enroll hooks (fix/worker-invite)', () => {
  const oauthAccount = { provider: 'microsoft-entra-id' };

  it('a brand-new OAuth user joining via a pending invite triggers role-target AND invite-course auto-enroll', async () => {
    mockFindUnique.mockResolvedValueOnce(null); // no existing dbUser
    mockInviteFindFirst.mockResolvedValue({
      id: 'invite-1',
      organizationId: 'org-1',
      role: 'nurse',
    });
    mockUserCreate.mockResolvedValue({ id: 'new-user-1', organizationId: 'org-1', role: 'nurse' });

    const signIn = getSignIn(workerConfig);
    const result = await signIn({
      user: { id: undefined, email: 'newhire@acme.com', name: 'New Hire' },
      account: oauthAccount,
    });

    expect(result).toBe(true);
    expect(mockInviteUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'invite-1' },
      data: { status: 'accepted' },
    });
    expect(mockEnrollUserForRoleTargets).toHaveBeenCalledExactlyOnceWith('new-user-1', 'org-1');
    expect(mockEnrollInviteCourses).toHaveBeenCalledExactlyOnceWith('new-user-1', 'invite-1');
  });

  it('does NOT call either auto-enroll hook for a brand-new OAuth user with no pending invite (no org to enroll into)', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    mockInviteFindFirst.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue({
      id: 'new-user-2',
      organizationId: null,
      role: 'front_desk_admin',
    });

    const signIn = getSignIn(workerConfig);
    const result = await signIn({
      user: { id: undefined, email: 'founder@acme.com', name: 'Founder' },
      account: oauthAccount,
    });

    expect(result).toBe(true);
    expect(mockEnrollUserForRoleTargets).not.toHaveBeenCalled();
    expect(mockEnrollInviteCourses).not.toHaveBeenCalled();
  });

  it('relinks an org-less existing OAuth user (a removed staffer) via a pending invite and materialises its parked courses', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'removed-user-1',
      organizationId: null,
      role: 'nurse',
    });
    mockInviteFindFirst.mockResolvedValue({
      id: 'invite-2',
      organizationId: 'org-2',
      role: 'nurse',
    });
    mockUpdate.mockResolvedValue({ id: 'removed-user-1', organizationId: 'org-2', role: 'nurse' });

    const signIn = getSignIn(workerConfig);
    const result = await signIn({
      user: { id: undefined, email: 'removed@acme.com', name: 'Removed Staffer' },
      account: oauthAccount,
    });

    expect(result).toBe(true);
    expect(mockEnrollUserForRoleTargets).toHaveBeenCalledExactlyOnceWith('removed-user-1', 'org-2');
    expect(mockEnrollInviteCourses).toHaveBeenCalledExactlyOnceWith('removed-user-1', 'invite-2');
  });

  it('does not call enrollInviteCourses for an existing OAuth user with no pending invite (ordinary re-login)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'existing-user-1',
      organizationId: 'org-1',
      role: 'nurse',
    });
    mockInviteFindFirst.mockResolvedValue(null);

    const signIn = getSignIn(workerConfig);
    const result = await signIn({
      user: { id: undefined, email: 'person@acme.com', name: 'Person' },
      account: oauthAccount,
    });

    expect(result).toBe(true);
    expect(mockEnrollUserForRoleTargets).not.toHaveBeenCalled();
    expect(mockEnrollInviteCourses).not.toHaveBeenCalled();
  });
});
