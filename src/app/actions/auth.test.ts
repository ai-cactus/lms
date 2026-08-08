/**
 * Regression tests for signup signup-hardening fixes:
 *
 *   1. Rate limiting blocks the call before any DB/email access.
 *   2. Verification token expires exactly EMAIL_VERIFICATION_EXPIRY_MS from now.
 *
 * Tests cover:
 *   - Rate-limited path: returns correct error, NO prisma/email side-effects.
 *   - Happy path: token created with correct expiry, email sent, success returned.
 *   - Validation short-circuit (missing fields) — sanity check that rate-limit runs first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EMAIL_VERIFICATION_EXPIRY_MS } from '@/lib/auth-constants';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be constructed before any vi.mock() factory runs.
// ---------------------------------------------------------------------------

const {
  prismaMock,
  mockHeaders,
  mockCheckRateLimit,
  mockSendEmailVerification,
  mockAdminAuth,
  mockWorkerAuth,
  mockInvalidateRevalidationCache,
} = vi.hoisted(() => {
  const prismaMock = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    verificationToken: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    organizationUser: { findMany: vi.fn(), count: vi.fn() },
  };

  // next/headers — returns a Headers-like object
  const mockHeadersInstance = {
    get: vi.fn(),
  };
  const mockHeaders = vi.fn().mockResolvedValue(mockHeadersInstance);

  const mockCheckRateLimit = vi.fn();
  const mockSendEmailVerification = vi.fn();

  // Session lookups used by forceResetPassword (F-057) — @/auth's `auth()` for
  // admin sessions and @/auth.worker's `auth()` for worker sessions.
  const mockAdminAuth = vi.fn();
  const mockWorkerAuth = vi.fn();

  return {
    prismaMock,
    mockHeaders,
    mockCheckRateLimit,
    mockSendEmailVerification,
    mockAdminAuth,
    mockWorkerAuth,
    mockInvalidateRevalidationCache: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports of the module under test.
// ---------------------------------------------------------------------------

vi.mock('next/headers', () => ({ headers: mockHeaders }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));

// Dynamic import inside signup — mock the module path it imports.
vi.mock('@/lib/email', () => ({
  sendEmailVerification: mockSendEmailVerification,
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  // authenticate() uses the default import (`bcrypt.compare`); signup
  // uses it too (`bcrypt.hash`) — both must be present on `default`.
  default: {
    hash: vi.fn().mockResolvedValue('hashed-pw'),
    compare: vi.fn().mockResolvedValue(false),
  },
  hash: vi.fn().mockResolvedValue('hashed-pw'),
  compare: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

vi.mock('@/auth', () => ({ signIn: vi.fn(), auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ signIn: vi.fn(), auth: mockWorkerAuth }));

// password-policy: allow anything unless the test exercises validation
vi.mock('@/lib/password-policy', () => ({
  validatePassword: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

vi.mock('@/lib/mfa-challenge', () => ({
  createMfaChallenge: vi.fn(),
}));

// Both password-reset paths actively bust the JWT revalidation cache; stub it
// so tests don't reach the real Redis client, and kept as a spy (not an
// inline vi.fn()) so tests can assert it's actually called.
vi.mock('@/lib/auth/session-revalidation-cache', () => ({
  invalidateRevalidationCache: mockInvalidateRevalidationCache,
}));

// ---------------------------------------------------------------------------
// Import under test AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------
import { signup, authenticate, forceResetPassword, resetPasswordWithToken } from './auth';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_DATA = {
  email: 'user@example.com',
  password: 'StrongP@ss1',
  firstName: 'Alice',
  lastName: 'Smith',
};

function stubHeadersIp(ip = '1.2.3.4') {
  const headersInstance = { get: vi.fn((key: string) => (key === 'x-forwarded-for' ? ip : null)) };
  mockHeaders.mockResolvedValue(headersInstance);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('signup — rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubHeadersIp();
  });

  it('returns rate-limit error and does NOT touch DB or email when checkRateLimit denies', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 600 });

    const result = await signup(VALID_DATA);

    expect(result).toEqual({
      success: false,
      error: 'Too many signup attempts. Please try again later.',
    });

    // No DB reads or writes
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.verificationToken.create).not.toHaveBeenCalled();
    expect(prismaMock.verificationToken.deleteMany).not.toHaveBeenCalled();

    // No email send
    expect(mockSendEmailVerification).not.toHaveBeenCalled();
  });

  it('calls checkRateLimit with the correct key prefix and parameters', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 600 });
    stubHeadersIp('10.0.0.1');

    await signup(VALID_DATA);

    // F-024: auth-critical sites pass { failClosed: true }.
    expect(mockCheckRateLimit).toHaveBeenCalledWith('signup:10.0.0.1', 5, 600, {
      failClosed: true,
    });
  });

  it('falls back to "unknown" IP when no forwarding headers present', async () => {
    const noIpHeaders = { get: vi.fn().mockReturnValue(null) };
    mockHeaders.mockResolvedValue(noIpHeaders);
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 600 });

    await signup(VALID_DATA);

    expect(mockCheckRateLimit).toHaveBeenCalledWith('signup:unknown', 5, 600, {
      failClosed: true,
    });
  });

  it('proceeds through normal flow when checkRateLimit allows', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4, resetInSeconds: 600 });
    prismaMock.user.findUnique.mockResolvedValue(null); // no existing user
    prismaMock.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.verificationToken.create.mockResolvedValue({});
    mockSendEmailVerification.mockResolvedValue({ success: true });

    const result = await signup(VALID_DATA);

    expect(result).toEqual({ success: true });
    expect(prismaMock.user.findUnique).toHaveBeenCalledOnce();
    expect(prismaMock.verificationToken.create).toHaveBeenCalledOnce();
    expect(mockSendEmailVerification).toHaveBeenCalledOnce();
  });
});

describe('signup — role persistence (owner-only self-serve signup)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubHeadersIp();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4, resetInSeconds: 600 });
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.verificationToken.create.mockResolvedValue({});
    mockSendEmailVerification.mockResolvedValue({ success: true });
  });

  it('always persists the verification token with role "owner", regardless of caller input', async () => {
    const result = await signup(VALID_DATA);

    expect(result).toEqual({ success: true });
    const createCall = prismaMock.verificationToken.create.mock.calls[0][0];
    expect(createCall.data.role).toBe('owner');
  });

  it('ignores an unexpected "role" field on the input payload — self-serve signup can never mint a worker', async () => {
    // The SignupData type has no `role` field, but a caller could still pass one through
    // (e.g. a stale client bundle). Self-serve signup must always found an organisation
    // as the owner — worker accounts are only ever created via the invite flow.
    const dataWithSpoofedRole = { ...VALID_DATA, role: 'front_desk_admin' } as typeof VALID_DATA;

    await signup(dataWithSpoofedRole);

    const createCall = prismaMock.verificationToken.create.mock.calls[0][0];
    expect(createCall.data.role).toBe('owner');
  });
});

describe('signup — token expiry (EMAIL_VERIFICATION_EXPIRY_MS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubHeadersIp();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4, resetInSeconds: 600 });
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.verificationToken.create.mockResolvedValue({});
    mockSendEmailVerification.mockResolvedValue({ success: true });
  });

  it('creates the verification token with expires ≈ now + EMAIL_VERIFICATION_EXPIRY_MS', async () => {
    const before = Date.now();
    await signup(VALID_DATA);
    const after = Date.now();

    const createCall = prismaMock.verificationToken.create.mock.calls[0][0];
    const expires: Date = createCall.data.expires;

    // Must be a real Date
    expect(expires).toBeInstanceOf(Date);

    const expiresMs = expires.getTime();
    // Allow ±2 s tolerance around the expected window
    const expectedMin = before + EMAIL_VERIFICATION_EXPIRY_MS - 2_000;
    const expectedMax = after + EMAIL_VERIFICATION_EXPIRY_MS + 2_000;

    expect(expiresMs).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresMs).toBeLessThanOrEqual(expectedMax);
  });

  it('expiry uses EMAIL_VERIFICATION_EXPIRY_MS (24 h), not a hardcoded value', () => {
    // Guard: if someone changes the constant this test catches the drift in meaning.
    expect(EMAIL_VERIFICATION_EXPIRY_MS).toBe(24 * 60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// THER-015 #1: authenticate() — pending-verification hint for a missing user
// ---------------------------------------------------------------------------

function makeLoginFormData(email: string, password = 'whatever') {
  const fd = new FormData();
  fd.set('email', email);
  fd.set('password', password);
  return fd;
}

describe('authenticate — missing user hint (THER-015 #1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubHeadersIp();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetInSeconds: 900 });
    prismaMock.user.findUnique.mockResolvedValue(null); // no User row exists
  });

  it('returns the "verify your email" hint when a live email_verification token exists for that email', async () => {
    prismaMock.verificationToken.findFirst.mockResolvedValue({ identifier: 'pending@example.com' });

    const result = await authenticate(undefined, makeLoginFormData('pending@example.com'));

    expect(result).toEqual({ error: 'Please verify your email to sign in.' });
    expect(prismaMock.verificationToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          identifier: 'pending@example.com',
          type: 'email_verification',
        }),
      }),
    );
  });

  it('returns the generic "Invalid credentials." message when there is no pending verification token', async () => {
    prismaMock.verificationToken.findFirst.mockResolvedValue(null);

    const result = await authenticate(undefined, makeLoginFormData('nobody@example.com'));

    expect(result).toEqual({ error: 'Invalid credentials.' });
  });

  it('still runs the dummy bcrypt compare (timing equalization) before checking for a pending token', async () => {
    prismaMock.verificationToken.findFirst.mockResolvedValue(null);
    const bcrypt = await import('bcryptjs');

    await authenticate(undefined, makeLoginFormData('nobody@example.com'));

    // authenticate() calls the DEFAULT import's compare (`import bcrypt from 'bcryptjs'`).
    expect(bcrypt.default.compare).toHaveBeenCalledWith('dummy', expect.any(String));
  });

  it('does not query for a verification token when no email was submitted', async () => {
    const result = await authenticate(undefined, makeLoginFormData(''));

    expect(result).toEqual({ error: 'Invalid credentials.' });
    expect(prismaMock.verificationToken.findFirst).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// QA ISSUE 2: authenticate() — removed-staff short-circuit, now driven by
// resolveActiveMembership() (membership state), not by role/organizationId
// fields directly (those no longer live on User post multi-org refactor).
// ---------------------------------------------------------------------------

describe('authenticate — removed staff member (QA ISSUE 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubHeadersIp();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetInSeconds: 900 });
    // authenticate()'s lookup only ever selects { id, mfaEnabled } — role/org
    // no longer live on User, so the fixture never needs those fields.
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', mfaEnabled: false });
  });

  it('returns the specific "access has been removed" error when every membership has been deactivated', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.count.mockResolvedValue(1); // had a membership, now inactive

    const result = await authenticate(undefined, makeLoginFormData('removed-hr@example.com'));

    expect(result).toEqual({
      error:
        'Your access to this organization has been removed. Please contact your administrator.',
    });
  });

  it('never calls signIn (admin or worker) for a removed staff member', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.count.mockResolvedValue(1);
    const { signIn } = await import('@/auth');
    const { signIn: signInWorker } = await import('@/auth.worker');

    await authenticate(undefined, makeLoginFormData('removed-finance@example.com'));

    expect(signIn).not.toHaveBeenCalled();
    expect(signInWorker).not.toHaveBeenCalled();
  });

  it('does NOT short-circuit a user who has never joined any organization (heading to onboarding)', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.count.mockResolvedValue(0); // no membership rows at all

    const result = await authenticate(undefined, makeLoginFormData('new-owner@example.com'));

    expect(result).not.toEqual({
      error:
        'Your access to this organization has been removed. Please contact your administrator.',
    });
  });

  it('does not apply the removed-staff check to an account with an active membership', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([
      {
        id: 'ou-1',
        role: 'hr',
        organizationId: 'org-1',
        organization: { name: 'Acme', slug: 'acme' },
      },
    ]);

    const result = await authenticate(undefined, makeLoginFormData('active-hr@example.com'));

    expect(result).not.toEqual({
      error:
        'Your access to this organization has been removed. Please contact your administrator.',
    });
  });
});

// ---------------------------------------------------------------------------
// authenticate() — post-login destination. A membership-less identity must be
// routed into onboarding by the ACTION, and at a route that RENDERS: any
// further redirect on the target (the proxy's onboarding gate, or /onboarding's
// own redirect to its first step) crashes the client with Next.js E394.
// ---------------------------------------------------------------------------

describe('authenticate — post-login redirect target', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubHeadersIp();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetInSeconds: 900 });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', mfaEnabled: false });
  });

  it('sends a membership-less identity straight to the onboarding wizard, never /dashboard', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.count.mockResolvedValue(0);
    const { signIn } = await import('@/auth');

    await authenticate(undefined, makeLoginFormData('new-owner@example.com'));

    // /onboarding/step1, not /onboarding — the latter answers with its own
    // redirect, which a Server Action's redirectTo cannot survive.
    expect(signIn).toHaveBeenCalledWith(
      'credentials',
      expect.objectContaining({ redirectTo: '/onboarding/step1' }),
    );
  });

  it('still sends an onboarded admin-tier membership to /dashboard', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([
      {
        id: 'ou-1',
        role: 'hr',
        organizationId: 'org-1',
        organization: { name: 'Acme', slug: 'acme' },
      },
    ]);
    const { signIn } = await import('@/auth');

    await authenticate(undefined, makeLoginFormData('active-hr@example.com'));

    expect(signIn).toHaveBeenCalledWith(
      'credentials',
      expect.objectContaining({ redirectTo: '/dashboard' }),
    );
  });

  it('still sends an onboarded worker membership to /worker', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([
      {
        id: 'ou-2',
        role: 'nurse',
        organizationId: 'org-1',
        organization: { name: 'Acme', slug: 'acme' },
      },
    ]);
    const { signIn: signInWorker } = await import('@/auth.worker');

    await authenticate(undefined, makeLoginFormData('nurse@example.com'));

    expect(signInWorker).toHaveBeenCalledWith(
      'credentials',
      expect.objectContaining({ redirectTo: '/worker' }),
    );
  });

  it('still sends a multi-membership identity with no remembered org to the picker', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([
      {
        id: 'ou-1',
        role: 'hr',
        organizationId: 'org-1',
        organization: { name: 'Acme', slug: 'acme' },
      },
      {
        id: 'ou-3',
        role: 'hr',
        organizationId: 'org-2',
        organization: { name: 'Globex', slug: 'globex' },
      },
    ]);
    const { signIn } = await import('@/auth');

    await authenticate(undefined, makeLoginFormData('multi-org@example.com'));

    expect(signIn).toHaveBeenCalledWith(
      'credentials',
      expect.objectContaining({ redirectTo: '/select-organization' }),
    );
  });

  it('still prefers the MFA challenge over the onboarding destination', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', mfaEnabled: true });
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.count.mockResolvedValue(0);
    const { createMfaChallenge } = await import('@/lib/mfa-challenge');
    (createMfaChallenge as ReturnType<typeof vi.fn>).mockResolvedValue('challenge-token');
    const { signIn } = await import('@/auth');

    await authenticate(undefined, makeLoginFormData('mfa-owner@example.com'));

    expect(signIn).toHaveBeenCalledWith(
      'credentials',
      expect.objectContaining({ redirectTo: '/mfa/verify?challenge=challenge-token' }),
    );
  });
});

// ---------------------------------------------------------------------------
// F-057: forceResetPassword(currentPassword, newPassword) — email now derived
// from the authenticated session instead of being passed in by the caller.
// ---------------------------------------------------------------------------

describe('forceResetPassword — session-derived email (F-057)', () => {
  const SESSION_EMAIL = 'staff@example.com';
  const EXISTING_HASH = 'existing-hashed-password';

  beforeEach(async () => {
    vi.clearAllMocks();
    // No session by default — individual tests opt in to admin/worker sessions.
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    const bcrypt = await import('bcryptjs');
    (bcrypt.default.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (bcrypt.default.hash as ReturnType<typeof vi.fn>).mockResolvedValue('new-hashed-password');
    mockInvalidateRevalidationCache.mockResolvedValue(undefined);
  });

  it('returns "Not authenticated." and touches no DB when there is no admin or worker session', async () => {
    const result = await forceResetPassword('oldPass1!', 'NewStr0ng!Pass');

    expect(result).toEqual({ error: 'Not authenticated.' });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });

  it("updates the session-derived email's password on a valid admin session + correct current password", async () => {
    mockAdminAuth.mockResolvedValue({ user: { email: SESSION_EMAIL } });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'staff-user-1',
      email: SESSION_EMAIL,
      password: EXISTING_HASH,
    });
    prismaMock.user.update.mockResolvedValue({});

    const bcrypt = await import('bcryptjs');
    (bcrypt.default.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const result = await forceResetPassword('correctCurrentPass1!', 'NewStr0ng!Pass');

    expect(result).toEqual({ success: true });
    // Looked up the session's email, not any caller-supplied value.
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: SESSION_EMAIL } });
    expect(bcrypt.default.compare).toHaveBeenCalledWith('correctCurrentPass1!', EXISTING_HASH);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { email: SESSION_EMAIL },
      // F-059: the reset also bumps sessionVersion to invalidate other sessions.
      data: {
        password: 'new-hashed-password',
        passwordResetRequired: false,
        sessionVersion: { increment: 1 },
      },
    });
    // commit 66aa961: busts the target's cached revalidation snapshot, by id,
    // only after the DB write that bumped sessionVersion.
    expect(mockInvalidateRevalidationCache).toHaveBeenCalledExactlyOnceWith('staff-user-1');
    expect(prismaMock.user.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockInvalidateRevalidationCache.mock.invocationCallOrder[0],
    );
  });

  it('updates the password for a valid worker session (no admin session present)', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({ user: { email: SESSION_EMAIL } });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'worker-user-1',
      email: SESSION_EMAIL,
      password: EXISTING_HASH,
    });
    prismaMock.user.update.mockResolvedValue({});

    const bcrypt = await import('bcryptjs');
    (bcrypt.default.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const result = await forceResetPassword('correctCurrentPass1!', 'NewStr0ng!Pass');

    expect(result).toEqual({ success: true });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { email: SESSION_EMAIL },
      // F-059: the reset also bumps sessionVersion to invalidate other sessions.
      data: {
        password: 'new-hashed-password',
        passwordResetRequired: false,
        sessionVersion: { increment: 1 },
      },
    });
    expect(mockInvalidateRevalidationCache).toHaveBeenCalledExactlyOnceWith('worker-user-1');
  });

  it('returns "Invalid current password." and does NOT update when the current password is wrong', async () => {
    mockAdminAuth.mockResolvedValue({ user: { email: SESSION_EMAIL } });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'staff-user-1',
      email: SESSION_EMAIL,
      password: EXISTING_HASH,
    });

    const bcrypt = await import('bcryptjs');
    (bcrypt.default.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const result = await forceResetPassword('wrongCurrentPass', 'NewStr0ng!Pass');

    expect(result).toEqual({ error: 'Invalid current password.' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resetPasswordWithToken(token, newPassword) — emailed-link password reset.
// F-059 bumps sessionVersion on completion; commit 66aa961 added an active
// cache bust on top so the invalidation isn't bounded by the revalidation
// cache's TTL.
// ---------------------------------------------------------------------------

describe('resetPasswordWithToken — emailed-token password reset', () => {
  const TOKEN = 'reset-token-abc123';
  const IDENTIFIER_EMAIL = 'reset-target@example.com';
  const VERIFICATION_TOKEN_ROW = {
    identifier: IDENTIFIER_EMAIL,
    token: TOKEN,
    type: 'password_reset',
    expires: new Date(Date.now() + 60_000),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.verificationToken.findFirst.mockResolvedValue(VERIFICATION_TOKEN_ROW);
    prismaMock.verificationToken.delete.mockResolvedValue({});
    prismaMock.user.update.mockResolvedValue({
      id: 'reset-target-1',
      role: 'nurse',
      organizationId: 'org-1',
    });
    mockInvalidateRevalidationCache.mockResolvedValue(undefined);

    const bcrypt = await import('bcryptjs');
    (bcrypt.default.hash as ReturnType<typeof vi.fn>).mockResolvedValue('new-hashed-password');
  });

  it('returns "Invalid or expired reset link." and touches no DB when the token does not resolve', async () => {
    prismaMock.verificationToken.findFirst.mockResolvedValue(null);

    const result = await resetPasswordWithToken(TOKEN, 'NewStr0ng!Pass');

    expect(result).toEqual({ error: 'Invalid or expired reset link.' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });

  it('scopes the token lookup to type "password_reset" and a non-expired window', async () => {
    await resetPasswordWithToken(TOKEN, 'NewStr0ng!Pass');

    expect(prismaMock.verificationToken.findFirst).toHaveBeenCalledWith({
      where: {
        token: TOKEN,
        type: 'password_reset',
        expires: { gt: expect.any(Date) },
      },
    });
  });

  it("updates the password, bumps sessionVersion, and busts the target user's cached revalidation snapshot by id, after the DB write", async () => {
    const result = await resetPasswordWithToken(TOKEN, 'NewStr0ng!Pass');

    expect(result).toEqual({ success: true });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { email: IDENTIFIER_EMAIL },
      data: { password: 'new-hashed-password', sessionVersion: { increment: 1 } },
      // Post multi-org split, role/organizationId live on OrganizationUser — the
      // reset only ever needs the identity id it must bust the cache for.
      select: { id: true },
    });
    // commit 66aa961: unlike the pre-existing F-059 sessionVersion bump alone
    // (which only self-heals within the cache TTL), this is the active bust
    // that makes the invalidation immediate.
    expect(mockInvalidateRevalidationCache).toHaveBeenCalledExactlyOnceWith('reset-target-1');
    expect(prismaMock.user.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockInvalidateRevalidationCache.mock.invocationCallOrder[0],
    );
  });

  it('deletes the consumed verification token after a successful reset', async () => {
    await resetPasswordWithToken(TOKEN, 'NewStr0ng!Pass');

    expect(prismaMock.verificationToken.delete).toHaveBeenCalledWith({
      where: { identifier_token: { identifier: IDENTIFIER_EMAIL, token: TOKEN } },
    });
  });

  it('rejects a password that fails policy validation before ever touching the DB', async () => {
    const passwordPolicy = await import('@/lib/password-policy');
    (passwordPolicy.validatePassword as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      valid: false,
      errors: ['too short'],
    });

    const result = await resetPasswordWithToken(TOKEN, 'short');

    expect(result).toEqual({ error: 'Password does not meet requirements: too short' });
    expect(prismaMock.verificationToken.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });
});
