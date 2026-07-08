/**
 * Regression tests for the resend-verification POST route fixes:
 *
 *   1. Rate limiting returns 429 and does NOT create a token or send email.
 *   2. Role is preserved on the newly created token (role: existingToken.role).
 *   3. New token expires ≈ now + EMAIL_VERIFICATION_EXPIRY_MS.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EMAIL_VERIFICATION_EXPIRY_MS } from '@/lib/auth-constants';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { prismaMock, mockCheckRateLimit, mockSendEmailVerification } = vi.hoisted(() => {
  const prismaMock = {
    user: { findUnique: vi.fn() },
    verificationToken: {
      findFirst: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
  };
  const mockCheckRateLimit = vi.fn();
  const mockSendEmailVerification = vi.fn();

  return { prismaMock, mockCheckRateLimit, mockSendEmailVerification };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock('@/lib/email', () => ({
  sendEmailVerification: mockSendEmailVerification,
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

// ---------------------------------------------------------------------------
// Import under test AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------
import { POST } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>, ip = '1.2.3.4'): Request {
  return new Request('http://localhost/api/auth/resend-verification', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

const EXISTING_TOKEN = {
  identifier: 'user@example.com',
  token: 'old-token-uuid',
  type: 'email_verification',
  role: 'admin',
  password: 'hashed-pw',
  firstName: 'Alice',
  lastName: 'Smith',
  expires: new Date(Date.now() + 1_000),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/auth/resend-verification — rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 429 when checkRateLimit denies and does NOT create token or send email', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 600 });

    const res = await POST(makeRequest({ email: 'user@example.com' }) as never);

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.success).toBe(false);

    // No DB token creation and no email send
    expect(prismaMock.verificationToken.create).not.toHaveBeenCalled();
    expect(mockSendEmailVerification).not.toHaveBeenCalled();
  });

  it('calls checkRateLimit with the correct key and parameters', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 600 });

    await POST(makeRequest({ email: 'user@example.com' }, '5.5.5.5') as never);

    expect(mockCheckRateLimit).toHaveBeenCalledWith('resend-verification:5.5.5.5', 5, 600);
  });
});

describe('POST /api/auth/resend-verification — role preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4, resetInSeconds: 600 });
    prismaMock.user.findUnique.mockResolvedValue(null); // not yet verified
    prismaMock.verificationToken.findFirst.mockResolvedValue(EXISTING_TOKEN);
    prismaMock.verificationToken.delete.mockResolvedValue({});
    prismaMock.verificationToken.create.mockResolvedValue({});
    mockSendEmailVerification.mockResolvedValue({ success: true });
  });

  it('creates the new token with role copied from the existing token', async () => {
    const res = await POST(makeRequest({ email: 'user@example.com' }) as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const createCall = prismaMock.verificationToken.create.mock.calls[0][0];
    expect(createCall.data.role).toBe('admin'); // preserves role from EXISTING_TOKEN
  });

  it('preserves role: "nurse" from the existing token', async () => {
    prismaMock.verificationToken.findFirst.mockResolvedValue({
      ...EXISTING_TOKEN,
      role: 'nurse',
    });

    const res = await POST(makeRequest({ email: 'user@example.com' }) as never);

    expect(res.status).toBe(200);
    const createCall = prismaMock.verificationToken.create.mock.calls[0][0];
    expect(createCall.data.role).toBe('nurse');
  });

  it('also sends the verification email on success', async () => {
    await POST(makeRequest({ email: 'user@example.com' }) as never);

    expect(mockSendEmailVerification).toHaveBeenCalledOnce();
    // First arg is the email address
    expect(mockSendEmailVerification.mock.calls[0][0]).toBe('user@example.com');
  });
});

describe('POST /api/auth/resend-verification — token expiry (EMAIL_VERIFICATION_EXPIRY_MS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4, resetInSeconds: 600 });
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.verificationToken.findFirst.mockResolvedValue(EXISTING_TOKEN);
    prismaMock.verificationToken.delete.mockResolvedValue({});
    prismaMock.verificationToken.create.mockResolvedValue({});
    mockSendEmailVerification.mockResolvedValue({ success: true });
  });

  it('creates the new token with expires ≈ now + EMAIL_VERIFICATION_EXPIRY_MS', async () => {
    const before = Date.now();
    await POST(makeRequest({ email: 'user@example.com' }) as never);
    const after = Date.now();

    const createCall = prismaMock.verificationToken.create.mock.calls[0][0];
    const expires: Date = createCall.data.expires;

    expect(expires).toBeInstanceOf(Date);

    const expiresMs = expires.getTime();
    const expectedMin = before + EMAIL_VERIFICATION_EXPIRY_MS - 2_000;
    const expectedMax = after + EMAIL_VERIFICATION_EXPIRY_MS + 2_000;

    expect(expiresMs).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresMs).toBeLessThanOrEqual(expectedMax);
  });
});
