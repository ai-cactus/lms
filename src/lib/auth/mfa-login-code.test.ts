/**
 * SEC-13: the login-MFA helpers now live in a server-only module instead of
 * the `'use server'` actions file. These pin that `sendLoginMfaCode` still
 * sends, and still refuses what it refused before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret-for-mfa-tests';

const { prismaMock, mockCheck, mockRecord, mockSendEmail } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    mfaFactor: { update: vi.fn() },
  },
  mockCheck: vi.fn(),
  mockRecord: vi.fn(),
  mockSendEmail: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitOnly: mockCheck,
  recordRateLimitAttempt: mockRecord,
}));
vi.mock('@/lib/email', () => ({ sendMfaOtpEmail: mockSendEmail }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { sendLoginMfaCode } from './mfa-login-code';

beforeEach(() => {
  vi.clearAllMocks();
  mockCheck.mockResolvedValue({ allowed: true, remaining: 2, resetInSeconds: 900 });
});

describe('sendLoginMfaCode', () => {
  it('stores a fresh encrypted OTP on the email factor and emails the code', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      email: 'person@acme.com',
      deletedAt: null,
      mfaFactors: [{ id: 'factor-1' }],
    });

    const result = await sendLoginMfaCode('user-1');

    expect(result).toEqual({ success: true });
    expect(prismaMock.mfaFactor.update).toHaveBeenCalledWith({
      where: { id: 'factor-1' },
      data: { secret: expect.any(String) },
    });
    expect(mockSendEmail).toHaveBeenCalledWith('person@acme.com', expect.stringMatching(/^\d{6}$/));
    expect(mockRecord).toHaveBeenCalledWith('mfa-send:user-1', 900);
  });

  it('refuses when rate-limited, without touching the database', async () => {
    mockCheck.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 600 });

    const result = await sendLoginMfaCode('user-1');

    expect(result).toEqual({
      success: false,
      error: 'Too many code requests. Please try again later.',
    });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('never sends a code to a deleted identity (Q-23)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      email: 'person@acme.com',
      deletedAt: new Date('2026-09-28'),
      mfaFactors: [{ id: 'factor-1' }],
    });

    const result = await sendLoginMfaCode('user-1');

    expect(result).toEqual({ success: false, error: 'User not found' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
