/**
 * Regression tests for THER-016 (MFA enroll 500):
 *
 * verifyMfaSetup() and regenerateRecoveryCodes() previously ran 10 bcryptjs
 * cost-12 hashes INSIDE prisma.$transaction, exceeding Prisma's 5s
 * interactive-transaction timeout on slow hosts and throwing unhandled — a
 * 500 on a VALID code. The fix computes hashedCodes BEFORE the transaction
 * and wraps the transaction in try/catch, returning a typed
 * { success: false, error } shape instead of throwing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret-for-mfa-tests';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  prismaMock,
  txMock,
  mockHeaders,
  mockAdminAuth,
  mockWorkerAuth,
  mockMarkSessionMfaVerified,
  mockAudit,
  mockHashRecoveryCode,
} = vi.hoisted(() => {
  const txMock = {
    mfaFactor: { update: vi.fn(), deleteMany: vi.fn() },
    user: { update: vi.fn() },
    mfaRecoveryCode: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  const prismaMock = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    mfaFactor: { findFirst: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    mfaRecoveryCode: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return {
    prismaMock,
    txMock,
    mockHeaders: vi.fn(),
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockMarkSessionMfaVerified: vi.fn(),
    mockAudit: vi.fn(),
    mockHashRecoveryCode: vi.fn(),
  };
});

vi.mock('next/headers', () => ({ headers: mockHeaders }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitOnly: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 3, resetInSeconds: 900 }),
  recordRateLimitAttempt: vi.fn(),
}));
vi.mock('@/lib/session-mfa', () => ({ markSessionMfaVerified: mockMarkSessionMfaVerified }));
vi.mock('@/lib/audit', () => ({ audit: mockAudit, getClientContext: () => ({}) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Keep the real encrypt/decrypt/generate helpers (so we can construct genuinely
// valid/expired encrypted OTP payloads) but replace hashRecoveryCode so tests
// don't pay real bcrypt cost-12 work and so call order relative to
// $transaction can be asserted directly (the root cause of THER-016).
vi.mock('@/lib/mfa', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mfa')>('@/lib/mfa');
  return { ...actual, hashRecoveryCode: mockHashRecoveryCode };
});

import { verifyMfaSetup, regenerateRecoveryCodes, disableMfa } from './mfa';
import { encryptOtpPayload } from '@/lib/mfa';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION = { user: { id: 'user-1', role: 'owner', organizationId: 'org-1' } };

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockResolvedValue({ get: vi.fn().mockReturnValue(null) });
  mockAdminAuth.mockResolvedValue(SESSION as never);
  mockWorkerAuth.mockResolvedValue(null as never);
  mockHashRecoveryCode.mockImplementation(async (code: string) => `hashed:${code}`);
  prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof txMock) => unknown) =>
    cb(txMock),
  );
  mockMarkSessionMfaVerified.mockResolvedValue(undefined);
  mockAudit.mockResolvedValue(undefined);
  prismaMock.mfaRecoveryCode.findMany.mockResolvedValue([]);
  prismaMock.mfaRecoveryCode.update.mockResolvedValue({});
});

describe('verifyMfaSetup — not authenticated', () => {
  it('returns an error and never reads mfaFactor when there is no session', async () => {
    mockAdminAuth.mockResolvedValue(null as never);
    mockWorkerAuth.mockResolvedValue(null as never);

    const result = await verifyMfaSetup('123456');

    expect(result).toEqual({ success: false, error: 'Not authenticated' });
    expect(prismaMock.mfaFactor.findFirst).not.toHaveBeenCalled();
  });
});

describe('verifyMfaSetup — email OTP verification (THER-016)', () => {
  it('valid code: enables MFA, marks the factor verified, and returns 10 recovery codes', async () => {
    const secret = encryptOtpPayload('123456');
    prismaMock.mfaFactor.findFirst.mockResolvedValue({
      id: 'factor-1',
      secret,
      type: 'email',
      verified: false,
    } as never);

    const result = await verifyMfaSetup('123456');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    const recoveryCodes = result.data?.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);

    expect(txMock.mfaFactor.update).toHaveBeenCalledWith({
      where: { id: 'factor-1' },
      data: { verified: true },
    });
    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({ mfaEnabled: true }),
    });
    expect(txMock.mfaRecoveryCode.createMany).toHaveBeenCalledWith({
      data: recoveryCodes.map((c) => ({ userId: 'user-1', codeHash: `hashed:${c}` })),
    });
  });

  it('expired code: returns the expiry error and never attempts a transaction', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const secret = encryptOtpPayload('654321');
    vi.setSystemTime(new Date('2026-01-01T00:11:00.000Z')); // 11 min later, > 10 min OTP_EXPIRY_MS

    prismaMock.mfaFactor.findFirst.mockResolvedValue({
      id: 'factor-1',
      secret,
      type: 'email',
      verified: false,
    } as never);

    const result = await verifyMfaSetup('654321');

    expect(result).toEqual({
      success: false,
      error: 'Code has expired. Please request a new one.',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('wrong code: returns the invalid-code error and never attempts a transaction', async () => {
    const secret = encryptOtpPayload('111111');
    prismaMock.mfaFactor.findFirst.mockResolvedValue({
      id: 'factor-1',
      secret,
      type: 'email',
      verified: false,
    } as never);

    const result = await verifyMfaSetup('999999');

    expect(result).toEqual({
      success: false,
      error: 'Invalid verification code. Please try again.',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('regression: resolves (does not throw) with the enable-specific error when $transaction rejects — the original 500 cause', async () => {
    const secret = encryptOtpPayload('123456');
    prismaMock.mfaFactor.findFirst.mockResolvedValue({
      id: 'factor-1',
      secret,
      type: 'email',
      verified: false,
    } as never);
    prismaMock.$transaction.mockRejectedValueOnce(
      new Error('Transaction API error: Transaction already closed (interactive tx timeout)'),
    );

    await expect(verifyMfaSetup('123456')).resolves.toEqual({
      success: false,
      error: 'Could not enable two-factor authentication. Please try again.',
    });
  });

  it('regression: hashes all 10 recovery codes BEFORE the transaction starts, not inside it', async () => {
    const secret = encryptOtpPayload('123456');
    prismaMock.mfaFactor.findFirst.mockResolvedValue({
      id: 'factor-1',
      secret,
      type: 'email',
      verified: false,
    } as never);

    const callOrder: string[] = [];
    mockHashRecoveryCode.mockImplementation(async (code: string) => {
      callOrder.push('hash');
      return `hashed:${code}`;
    });
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof txMock) => unknown) => {
      callOrder.push('tx-start');
      const out = await cb(txMock);
      callOrder.push('tx-end');
      return out;
    });

    await verifyMfaSetup('123456');

    expect(callOrder.filter((e) => e === 'hash')).toHaveLength(10);
    const lastHashIndex = callOrder.lastIndexOf('hash');
    const txStartIndex = callOrder.indexOf('tx-start');
    expect(txStartIndex).toBeGreaterThan(lastHashIndex);
  });
});

describe('regenerateRecoveryCodes — THER-016 regression', () => {
  it('resolves (does not throw) with the regenerate-specific error when $transaction rejects', async () => {
    const secret = encryptOtpPayload('123456');
    prismaMock.mfaFactor.findFirst.mockResolvedValue({
      id: 'factor-1',
      secret,
      type: 'email',
      verified: true,
    } as never);
    prismaMock.mfaFactor.update.mockResolvedValue({} as never);
    prismaMock.$transaction.mockRejectedValueOnce(new Error('interactive tx timeout'));

    await expect(regenerateRecoveryCodes('123456')).resolves.toEqual({
      success: false,
      error: 'Could not regenerate recovery codes. Please try again.',
    });
  });

  it('hashes all 10 recovery codes BEFORE the transaction starts, not inside it', async () => {
    const secret = encryptOtpPayload('123456');
    prismaMock.mfaFactor.findFirst.mockResolvedValue({
      id: 'factor-1',
      secret,
      type: 'email',
      verified: true,
    } as never);
    prismaMock.mfaFactor.update.mockResolvedValue({} as never);

    const callOrder: string[] = [];
    mockHashRecoveryCode.mockImplementation(async (code: string) => {
      callOrder.push('hash');
      return `hashed:${code}`;
    });
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof txMock) => unknown) => {
      callOrder.push('tx-start');
      return cb(txMock);
    });

    const result = await regenerateRecoveryCodes('123456');

    expect(result.success).toBe(true);
    expect(callOrder.filter((e) => e === 'hash')).toHaveLength(10);
    expect(callOrder.indexOf('tx-start')).toBeGreaterThan(callOrder.lastIndexOf('hash'));
  });
});

/**
 * Regression: disableMfa() gated on `if (!isValid)` where `isValid` was the
 * whole { valid, error } object returned by verifyUserMfaCode — always
 * truthy, so ANY string (including garbage) "disabled" 2FA for any
 * authenticated user. Fixed to gate on `verification.valid`. These tests
 * confirm a wrong code is rejected with MFA left fully intact, and a correct
 * code disables it.
 */
describe('disableMfa — not authenticated / input validation', () => {
  it('returns an error and never reads the user when there is no session', async () => {
    mockAdminAuth.mockResolvedValue(null as never);
    mockWorkerAuth.mockResolvedValue(null as never);

    const result = await disableMfa('123456');

    expect(result).toEqual({ success: false, error: 'Not authenticated' });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns an error when no code is provided', async () => {
    const result = await disableMfa('');

    expect(result).toEqual({ success: false, error: 'Verification code is required' });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns an error when MFA is not enabled on the account', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ mfaEnabled: false } as never);

    const result = await disableMfa('123456');

    expect(result).toEqual({ success: false, error: 'MFA is not enabled' });
    expect(prismaMock.mfaFactor.findFirst).not.toHaveBeenCalled();
  });
});

describe('disableMfa — regression: gate on verification.valid, not object truthiness', () => {
  it('a WRONG code is rejected and MFA/recovery codes are left fully intact', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ mfaEnabled: true } as never);
    const secret = encryptOtpPayload('123456');
    prismaMock.mfaFactor.findFirst.mockResolvedValue({
      id: 'factor-1',
      secret,
      type: 'email',
      verified: true,
    } as never);

    const result = await disableMfa('999999');

    expect(result).toEqual({ success: false, error: 'Invalid verification code' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.mfaFactor.deleteMany).not.toHaveBeenCalled();
    expect(txMock.mfaRecoveryCode.deleteMany).not.toHaveBeenCalled();
    expect(txMock.user.update).not.toHaveBeenCalled();
  });

  it('an arbitrary junk string is rejected the same way a wrong numeric code is (the original bypass vector)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ mfaEnabled: true } as never);
    const secret = encryptOtpPayload('123456');
    prismaMock.mfaFactor.findFirst.mockResolvedValue({
      id: 'factor-1',
      secret,
      type: 'email',
      verified: true,
    } as never);

    const result = await disableMfa('not-a-real-code');

    expect(result.success).toBe(false);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('the CORRECT code disables MFA: deletes factors + recovery codes and flips mfaEnabled false', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ mfaEnabled: true } as never);
    const secret = encryptOtpPayload('123456');
    prismaMock.mfaFactor.findFirst.mockResolvedValue({
      id: 'factor-1',
      secret,
      type: 'email',
      verified: true,
    } as never);

    const result = await disableMfa('123456');

    expect(result).toEqual({ success: true });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.mfaFactor.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(txMock.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { mfaEnabled: false },
    });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.mfa.disable', actorId: 'user-1' }),
    );
  });

  it('a valid recovery code also disables MFA (verification.valid via usedRecoveryCode path)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ mfaEnabled: true } as never);
    // No usable primary OTP factor — forces the recovery-code branch.
    prismaMock.mfaFactor.findFirst.mockResolvedValue(null as never);
    // Real (low-cost) bcrypt hash so the actual (unmocked) verifyRecoveryCode
    // genuinely matches — this exercises the real compare, not a stub.
    const bcrypt = (await import('bcryptjs')).default;
    const codeHash = await bcrypt.hash('RECOVERY-CODE', 4);
    prismaMock.mfaRecoveryCode.findMany.mockResolvedValue([
      { id: 'rc-1', codeHash, usedAt: null },
    ] as never);

    const result = await disableMfa('RECOVERY-CODE');

    expect(result).toEqual({ success: true });
    expect(prismaMock.mfaRecoveryCode.update).toHaveBeenCalledWith({
      where: { id: 'rc-1' },
      data: { usedAt: expect.any(Date) },
    });
  });
});
