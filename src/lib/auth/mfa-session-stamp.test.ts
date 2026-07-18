/**
 * Regression tests for the 2FA double-challenge root cause.
 *
 * The old verify route decoded the session cookie with NEXTAUTH_SECRET only.
 * Whenever AUTH_SECRET was also set — and differed from NEXTAUTH_SECRET, as it
 * does in this environment — create-auth-instance.ts (which ENCRYPTS the
 * cookie) resolves the secret as `AUTH_SECRET || NEXTAUTH_SECRET`, so the old
 * decode with NEXTAUTH_SECRET-only silently failed, the `mfaVerified` stamp
 * never landed, and the middleware bounced the user to a second challenge.
 *
 * stampSessionMfaVerified() must resolve the secret with the SAME variable
 * and the SAME order the encoder uses: AUTH_SECRET first, then NEXTAUTH_SECRET.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `server-only` throws outside a React Server Component module graph (Next's
// `react-server` resolve condition isn't set under vitest/jsdom) — see the
// identical crash in src/lib/billing-prices.test.ts.
vi.mock('server-only', () => ({}));

const { mockCookies, mockCookieStore, mockDecode, mockEncode, mockMarkSessionMfaVerified } =
  vi.hoisted(() => {
    const mockCookieStore = { get: vi.fn() };
    return {
      mockCookies: vi.fn(() => Promise.resolve(mockCookieStore)),
      mockCookieStore,
      mockDecode: vi.fn(),
      mockEncode: vi.fn(),
      mockMarkSessionMfaVerified: vi.fn(),
    };
  });

vi.mock('next/headers', () => ({ cookies: mockCookies }));
vi.mock('next-auth/jwt', () => ({ decode: mockDecode, encode: mockEncode }));
vi.mock('@/lib/session-mfa', () => ({ markSessionMfaVerified: mockMarkSessionMfaVerified }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { stampSessionMfaVerified } from './mfa-session-stamp';

const DECODED_TOKEN = {
  id: 'user-1',
  role: 'owner',
  organizationId: 'org-1',
  sessionId: 'session-abc',
  sessionVersion: 3,
  mfaVerified: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCookies.mockImplementation(() => Promise.resolve(mockCookieStore));
  mockCookieStore.get.mockReturnValue({ value: 'raw-cookie-token' });
  mockDecode.mockResolvedValue({ ...DECODED_TOKEN });
  mockEncode.mockResolvedValue('re-encoded-jwt');
  mockMarkSessionMfaVerified.mockResolvedValue(undefined);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('INACTIVITY_TIMEOUT_MINUTES', '60');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('stampSessionMfaVerified — secret resolution (root-cause regression)', () => {
  it('decodes and re-encodes with AUTH_SECRET when AUTH_SECRET and NEXTAUTH_SECRET differ', async () => {
    vi.stubEnv('AUTH_SECRET', 'auth-secret-value');
    vi.stubEnv('NEXTAUTH_SECRET', 'nextauth-secret-value-DIFFERENT');

    const result = await stampSessionMfaVerified('user-1', 'admin');

    expect(result.ok).toBe(true);
    expect(mockDecode).toHaveBeenCalledWith(
      expect.objectContaining({ secret: 'auth-secret-value' }),
    );
    expect(mockEncode).toHaveBeenCalledWith(
      expect.objectContaining({ secret: 'auth-secret-value' }),
    );
    // Never falls back to NEXTAUTH_SECRET while AUTH_SECRET is set.
    expect(mockDecode).not.toHaveBeenCalledWith(
      expect.objectContaining({ secret: 'nextauth-secret-value-DIFFERENT' }),
    );
  });

  it('falls back to NEXTAUTH_SECRET when AUTH_SECRET is unset', async () => {
    vi.stubEnv('AUTH_SECRET', '');
    vi.stubEnv('NEXTAUTH_SECRET', 'nextauth-secret-value');

    const result = await stampSessionMfaVerified('user-1', 'admin');

    expect(result.ok).toBe(true);
    expect(mockDecode).toHaveBeenCalledWith(
      expect.objectContaining({ secret: 'nextauth-secret-value' }),
    );
    expect(mockEncode).toHaveBeenCalledWith(
      expect.objectContaining({ secret: 'nextauth-secret-value' }),
    );
  });

  it('returns a typed no_secret failure (never throws) when neither secret is configured', async () => {
    vi.stubEnv('AUTH_SECRET', '');
    vi.stubEnv('NEXTAUTH_SECRET', '');

    const result = await stampSessionMfaVerified('user-1', 'admin');

    expect(result).toEqual({ ok: false, reason: 'no_secret' });
    expect(mockCookies).not.toHaveBeenCalled();
    expect(mockDecode).not.toHaveBeenCalled();
  });
});

describe('stampSessionMfaVerified — cookie name / salt selection', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_SECRET', 'auth-secret-value');
  });

  it.each([
    ['admin', false, 'admin.session-token'],
    ['worker', false, 'worker.session-token'],
    ['admin', true, '__Secure-admin.session-token'],
    ['worker', true, '__Secure-worker.session-token'],
  ] as const)(
    'instance=%s useSecureCookies(NODE_ENV=production)=%s -> cookieName/salt = %s',
    async (instance, secure, expectedName) => {
      vi.stubEnv('NODE_ENV', secure ? 'production' : 'test');

      const result = await stampSessionMfaVerified('user-1', instance);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok result');
      expect(result.cookieName).toBe(expectedName);
      expect(mockCookieStore.get).toHaveBeenCalledWith(expectedName);
      expect(mockDecode).toHaveBeenCalledWith(
        expect.objectContaining({ salt: expectedName, token: 'raw-cookie-token' }),
      );
      expect(mockEncode).toHaveBeenCalledWith(expect.objectContaining({ salt: expectedName }));
    },
  );
});

describe('stampSessionMfaVerified — claim preservation and maxAge', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_SECRET', 'auth-secret-value');
  });

  it('preserves role/organizationId/sessionId/sessionVersion while flipping mfaVerified to true', async () => {
    await stampSessionMfaVerified('user-1', 'admin');

    expect(mockEncode).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.objectContaining({
          id: 'user-1',
          role: 'owner',
          organizationId: 'org-1',
          sessionId: 'session-abc',
          sessionVersion: 3,
          mfaVerified: true,
        }),
      }),
    );
  });

  it('marks the session verified in Redis with the decoded sessionId', async () => {
    await stampSessionMfaVerified('user-1', 'admin');

    expect(mockMarkSessionMfaVerified).toHaveBeenCalledWith('user-1', 'session-abc');
  });

  it('defaults maxAge to 3600s (60 min) when INACTIVITY_TIMEOUT_MINUTES is unset', async () => {
    vi.stubEnv('INACTIVITY_TIMEOUT_MINUTES', '');

    const result = await stampSessionMfaVerified('user-1', 'admin');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.maxAge).toBe(3600);
    expect(mockEncode).toHaveBeenCalledWith(expect.objectContaining({ maxAge: 3600 }));
  });

  it('honors a custom INACTIVITY_TIMEOUT_MINUTES', async () => {
    vi.stubEnv('INACTIVITY_TIMEOUT_MINUTES', '30');

    const result = await stampSessionMfaVerified('user-1', 'admin');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.maxAge).toBe(1800);
    expect(mockEncode).toHaveBeenCalledWith(expect.objectContaining({ maxAge: 1800 }));
  });

  it('returns the newly encoded token on success', async () => {
    const result = await stampSessionMfaVerified('user-1', 'admin');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.newToken).toBe('re-encoded-jwt');
  });
});

describe('stampSessionMfaVerified — typed failures (no throw)', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_SECRET', 'auth-secret-value');
  });

  it('returns no_cookie when the session cookie is missing, and never calls decode', async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const result = await stampSessionMfaVerified('user-1', 'admin');

    expect(result).toEqual({ ok: false, reason: 'no_cookie' });
    expect(mockDecode).not.toHaveBeenCalled();
    expect(mockMarkSessionMfaVerified).not.toHaveBeenCalled();
  });

  it('returns decode_failed (does not throw) when decode() rejects', async () => {
    mockDecode.mockRejectedValue(new Error('JWTSessionError: invalid signature'));

    await expect(stampSessionMfaVerified('user-1', 'admin')).resolves.toEqual({
      ok: false,
      reason: 'decode_failed',
    });
    expect(mockMarkSessionMfaVerified).not.toHaveBeenCalled();
    expect(mockEncode).not.toHaveBeenCalled();
  });

  it('returns no_session_id when decode succeeds but the token has no sessionId', async () => {
    mockDecode.mockResolvedValue({ id: 'user-1', role: 'owner' });

    const result = await stampSessionMfaVerified('user-1', 'admin');

    expect(result).toEqual({ ok: false, reason: 'no_session_id' });
    expect(mockMarkSessionMfaVerified).not.toHaveBeenCalled();
    expect(mockEncode).not.toHaveBeenCalled();
  });

  it('returns no_session_id (not a throw) when decode resolves null', async () => {
    mockDecode.mockResolvedValue(null);

    await expect(stampSessionMfaVerified('user-1', 'admin')).resolves.toEqual({
      ok: false,
      reason: 'no_session_id',
    });
  });
});
