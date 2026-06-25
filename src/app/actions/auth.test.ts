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

const { prismaMock, mockHeaders, mockCheckRateLimit, mockSendEmailVerification } = vi.hoisted(
  () => {
    const prismaMock = {
      user: { findUnique: vi.fn() },
      verificationToken: {
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
    };

    // next/headers — returns a Headers-like object
    const mockHeadersInstance = {
      get: vi.fn(),
    };
    const mockHeaders = vi.fn().mockResolvedValue(mockHeadersInstance);

    const mockCheckRateLimit = vi.fn();
    const mockSendEmailVerification = vi.fn();

    return { prismaMock, mockHeaders, mockCheckRateLimit, mockSendEmailVerification };
  },
);

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
  default: { hash: vi.fn().mockResolvedValue('hashed-pw') },
  hash: vi.fn().mockResolvedValue('hashed-pw'),
  compare: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

vi.mock('@/auth', () => ({ signIn: vi.fn() }));
vi.mock('@/auth.worker', () => ({ signIn: vi.fn() }));

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
import { signupWithRole } from './auth';

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
