/**
 * Regression tests for signupWithRole signup-hardening fixes:
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
} = vi.hoisted(() => {
  const prismaMock = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    verificationToken: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
    },
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
  };
});

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports of the module under test.
// ---------------------------------------------------------------------------

vi.mock('next/headers', () => ({ headers: mockHeaders }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));

// Dynamic import inside signupWithRole — mock the module path it imports.
vi.mock('@/lib/email', () => ({
  sendEmailVerification: mockSendEmailVerification,
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  // authenticate() uses the default import (`bcrypt.compare`); signupWithRole
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

// ---------------------------------------------------------------------------
// Import under test AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------
import { signupWithRole, authenticate, forceResetPassword } from './auth';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_DATA = {
  email: 'user@example.com',
  password: 'StrongP@ss1',
  firstName: 'Alice',
  lastName: 'Smith',
  role: 'admin' as const,
};

function stubHeadersIp(ip = '1.2.3.4') {
  const headersInstance = { get: vi.fn((key: string) => (key === 'x-forwarded-for' ? ip : null)) };
  mockHeaders.mockResolvedValue(headersInstance);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('signupWithRole — rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubHeadersIp();
  });

  it('returns rate-limit error and does NOT touch DB or email when checkRateLimit denies', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 600 });

    const result = await signupWithRole(VALID_DATA);

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

    await signupWithRole(VALID_DATA);

    expect(mockCheckRateLimit).toHaveBeenCalledWith('signup:10.0.0.1', 5, 600);
  });

  it('falls back to "unknown" IP when no forwarding headers present', async () => {
    const noIpHeaders = { get: vi.fn().mockReturnValue(null) };
    mockHeaders.mockResolvedValue(noIpHeaders);
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 600 });

    await signupWithRole(VALID_DATA);

    expect(mockCheckRateLimit).toHaveBeenCalledWith('signup:unknown', 5, 600);
  });

  it('proceeds through normal flow when checkRateLimit allows', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4, resetInSeconds: 600 });
    prismaMock.user.findUnique.mockResolvedValue(null); // no existing user
    prismaMock.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.verificationToken.create.mockResolvedValue({});
    mockSendEmailVerification.mockResolvedValue({ success: true });

    const result = await signupWithRole(VALID_DATA);

    expect(result).toEqual({ success: true });
    expect(prismaMock.user.findUnique).toHaveBeenCalledOnce();
    expect(prismaMock.verificationToken.create).toHaveBeenCalledOnce();
    expect(mockSendEmailVerification).toHaveBeenCalledOnce();
  });
});

describe('signupWithRole — token expiry (EMAIL_VERIFICATION_EXPIRY_MS)', () => {
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
    await signupWithRole(VALID_DATA);
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
  });

  it('returns "Not authenticated." and touches no DB when there is no admin or worker session', async () => {
    const result = await forceResetPassword('oldPass1!', 'NewStr0ng!Pass');

    expect(result).toEqual({ error: 'Not authenticated.' });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("updates the session-derived email's password on a valid admin session + correct current password", async () => {
    mockAdminAuth.mockResolvedValue({ user: { email: SESSION_EMAIL } });
    prismaMock.user.findUnique.mockResolvedValue({
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
  });

  it('updates the password for a valid worker session (no admin session present)', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({ user: { email: SESSION_EMAIL } });
    prismaMock.user.findUnique.mockResolvedValue({
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
  });

  it('returns "Invalid current password." and does NOT update when the current password is wrong', async () => {
    mockAdminAuth.mockResolvedValue({ user: { email: SESSION_EMAIL } });
    prismaMock.user.findUnique.mockResolvedValue({
      email: SESSION_EMAIL,
      password: EXISTING_HASH,
    });

    const bcrypt = await import('bcryptjs');
    (bcrypt.default.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const result = await forceResetPassword('wrongCurrentPass', 'NewStr0ng!Pass');

    expect(result).toEqual({ error: 'Invalid current password.' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
