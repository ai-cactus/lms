/**
 * Regression tests for POST /api/auth/mfa/verify — the 2FA consolidation fix.
 *
 * Root cause recap: the route used to REDEEM (consume) the challenge before
 * validating the code, so a wrong code burned the single-use challenge
 * (Issue 1) — and the session stamp could silently fail while still
 * returning {success:true} (Issue 2), trapping the user in a second
 * /verify-2fa challenge because the cookie mirror was never actually
 * verified. The fix reorders to peek -> validate -> stamp -> redeem, and the
 * instance to stamp comes from the challenge's recorded role, never from
 * sniffing the request's Cookie header.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  mockVerifyUserMfaCode,
  mockPeekMfaChallenge,
  mockRedeemMfaChallenge,
  mockStampSessionMfaVerified,
} = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
  mockVerifyUserMfaCode: vi.fn(),
  mockPeekMfaChallenge: vi.fn(),
  mockRedeemMfaChallenge: vi.fn(),
  mockStampSessionMfaVerified: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/app/actions/mfa', () => ({ verifyUserMfaCode: mockVerifyUserMfaCode }));
vi.mock('@/lib/mfa-challenge', () => ({
  peekMfaChallenge: mockPeekMfaChallenge,
  redeemMfaChallenge: mockRedeemMfaChallenge,
}));
vi.mock('@/lib/auth/mfa-session-stamp', () => ({
  stampSessionMfaVerified: mockStampSessionMfaVerified,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from './route';

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/auth/mfa/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const CHALLENGE_DATA = { userId: 'user-1', role: 'admin' as const, createdAt: Date.now() };
const STAMP_OK = {
  ok: true as const,
  cookieName: 'admin.session-token',
  newToken: 'new-jwt-token',
  maxAge: 3600,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', mfaEnabled: true });
  prismaMock.user.update.mockResolvedValue({});
  mockPeekMfaChallenge.mockResolvedValue(CHALLENGE_DATA);
  mockRedeemMfaChallenge.mockResolvedValue(CHALLENGE_DATA);
  mockStampSessionMfaVerified.mockResolvedValue(STAMP_OK);
});

describe('POST /api/auth/mfa/verify — input validation', () => {
  it('400s when challenge or code is missing, without peeking anything', async () => {
    const res = await POST(makeRequest({ code: '123456' }));
    expect(res.status).toBe(400);
    expect(mockPeekMfaChallenge).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/mfa/verify — invalid/expired challenge', () => {
  it('401s and never calls verifyUserMfaCode when the challenge does not resolve', async () => {
    mockPeekMfaChallenge.mockResolvedValue(null);

    const res = await POST(makeRequest({ challenge: 'a'.repeat(64), code: '123456' }));

    expect(res.status).toBe(401);
    expect(mockVerifyUserMfaCode).not.toHaveBeenCalled();
    expect(mockStampSessionMfaVerified).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/mfa/verify — Issue 1: a wrong code must not consume the challenge', () => {
  it('401s, leaves the challenge unredeemed, and a subsequent correct code on the SAME challenge succeeds', async () => {
    mockVerifyUserMfaCode.mockResolvedValueOnce({
      valid: false,
      error: 'Invalid verification code',
    });

    const wrongRes = await POST(makeRequest({ challenge: 'a'.repeat(64), code: '000000' }));
    const wrongBody = await wrongRes.json();

    expect(wrongRes.status).toBe(401);
    expect(wrongBody.error).toBe('Invalid verification code');
    expect(mockRedeemMfaChallenge).not.toHaveBeenCalled();
    expect(mockStampSessionMfaVerified).not.toHaveBeenCalled();

    // Same challenge token, now with the correct code — peek is non-destructive
    // so the challenge is still resolvable.
    mockVerifyUserMfaCode.mockResolvedValueOnce({ valid: true });

    const rightRes = await POST(makeRequest({ challenge: 'a'.repeat(64), code: '123456' }));
    const rightBody = await rightRes.json();

    expect(rightRes.status).toBe(200);
    expect(rightBody).toEqual({ success: true, role: 'admin' });
    expect(mockPeekMfaChallenge).toHaveBeenCalledTimes(2);
    expect(mockPeekMfaChallenge).toHaveBeenNthCalledWith(1, 'a'.repeat(64));
    expect(mockPeekMfaChallenge).toHaveBeenNthCalledWith(2, 'a'.repeat(64));
    expect(mockRedeemMfaChallenge).toHaveBeenCalledTimes(1);
    expect(mockRedeemMfaChallenge).toHaveBeenCalledWith('a'.repeat(64));
  });
});

describe('POST /api/auth/mfa/verify — happy path', () => {
  it('correct code on first try: stamps, redeems the challenge exactly once, sets the cookie, and returns 200', async () => {
    mockVerifyUserMfaCode.mockResolvedValue({ valid: true });

    const res = await POST(makeRequest({ challenge: 'b'.repeat(64), code: '123456' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, role: 'admin' });
    expect(mockStampSessionMfaVerified).toHaveBeenCalledWith('user-1', 'admin');
    expect(mockRedeemMfaChallenge).toHaveBeenCalledTimes(1);
    expect(mockRedeemMfaChallenge).toHaveBeenCalledWith('b'.repeat(64));

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('admin.session-token=new-jwt-token');
  });

  it('resolves the stamp instance from challengeData.role, not from any Cookie header — regression for header-sniffing', async () => {
    mockPeekMfaChallenge.mockResolvedValue({ ...CHALLENGE_DATA, role: 'worker' });
    mockVerifyUserMfaCode.mockResolvedValue({ valid: true });
    mockStampSessionMfaVerified.mockResolvedValue({
      ok: true,
      cookieName: 'worker.session-token',
      newToken: 'worker-jwt',
      maxAge: 3600,
    });

    // Even though the incoming request carries an admin session cookie
    // (simulating both admin+worker cookies present on the same browser), the
    // instance to stamp must come from the challenge's recorded role.
    const req = new Request('http://localhost/api/auth/mfa/verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'admin.session-token=some-admin-cookie-value',
      },
      body: JSON.stringify({ challenge: 'c'.repeat(64), code: '123456' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(mockStampSessionMfaVerified).toHaveBeenCalledWith('user-1', 'worker');
    expect(body).toEqual({ success: true, role: 'worker' });
  });
});

describe('POST /api/auth/mfa/verify — Issue 2: a stamp failure must be a hard error, never a false success', () => {
  it('returns a 5xx, does NOT return {success:true}, and leaves the challenge unredeemed', async () => {
    mockVerifyUserMfaCode.mockResolvedValue({ valid: true });
    mockStampSessionMfaVerified.mockResolvedValue({ ok: false, reason: 'decode_failed' });

    const res = await POST(makeRequest({ challenge: 'd'.repeat(64), code: '123456' }));
    const body = await res.json();

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(body.success).not.toBe(true);
    expect(mockRedeemMfaChallenge).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/mfa/verify — user gate', () => {
  it('400s when the challenge resolves but the user no longer has MFA enabled', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', mfaEnabled: false });

    const res = await POST(makeRequest({ challenge: 'e'.repeat(64), code: '123456' }));

    expect(res.status).toBe(400);
    expect(mockVerifyUserMfaCode).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/mfa/verify — mfaVerifiedAt backfill is best-effort', () => {
  it('still returns 200 success when the legacy mfaVerifiedAt write fails', async () => {
    mockVerifyUserMfaCode.mockResolvedValue({ valid: true });
    prismaMock.user.update.mockRejectedValue(new Error('DB unavailable'));

    const res = await POST(makeRequest({ challenge: 'f'.repeat(64), code: '123456' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, role: 'admin' });
  });
});
