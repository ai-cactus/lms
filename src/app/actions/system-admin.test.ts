/**
 * Tests for the system-admin authentication gate.
 *
 * This file had NO tests at all (F-096) despite guarding cross-organization
 * powers including irreversible user deletion. Starting with the auth gate
 * because that is where the hardening landed:
 *
 *   F-097 — brute-force protection. The gate previously accepted unlimited
 *           attempts against one shared static password.
 *   F-056 — constant-time comparison. A plain `===` short-circuits on the first
 *           differing byte, leaking how much of a guess was right.
 *   F-094 — every outcome is audited, since a shared credential means the trail
 *           is the only record that anyone used it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockAudit, mockAuditCritical, mockCheckRateLimit, mockCookieSet, mockLogger } = vi.hoisted(
  () => ({
    mockAudit: vi.fn(),
    mockAuditCritical: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockCookieSet: vi.fn(),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }),
);

vi.mock('@/lib/prisma', () => ({ prisma: {}, default: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: mockCookieSet, get: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
}));
vi.mock('@/lib/logger', () => ({ logger: mockLogger, maskEmail: (e: string) => e }));
vi.mock('@/lib/audit', () => ({
  audit: mockAudit,
  auditCritical: mockAuditCritical,
  // Real behaviour, so the IP the tests assert on is genuinely derived from headers.
  getClientContext: (h: Headers) => ({
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: h.get('user-agent') ?? undefined,
  }),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock('@/lib/system-auth', () => ({
  verifySystemAdminCookie: vi.fn().mockResolvedValue(false),
  SYSTEM_ADMIN_COOKIE: 'system_admin_auth',
}));

import { verifySystemPassword } from './system-admin';

const PASSWORD = 'correct-horse-battery-staple';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SYSTEM_ADMIN_PASSWORD', PASSWORD);
  vi.stubEnv('NEXTAUTH_SECRET', 'test-secret');
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4, resetInSeconds: 900 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('verifySystemPassword — feature flag', () => {
  it('refuses when SYSTEM_ADMIN_PASSWORD is unset, without consuming a rate-limit token', async () => {
    vi.stubEnv('SYSTEM_ADMIN_PASSWORD', '');

    const result = await verifySystemPassword('anything');

    expect(result).toEqual({ success: false, error: 'System admin is not enabled' });
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockCookieSet).not.toHaveBeenCalled();
  });
});

describe('verifySystemPassword — brute-force protection (F-097)', () => {
  it('rate-limits per IP, fail-closed, before comparing the password', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 42 });

    const result = await verifySystemPassword(PASSWORD);

    // Even the CORRECT password is refused once the limit is hit — the limiter
    // must gate before the comparison, or it is not a brute-force control.
    expect(result.success).toBe(false);
    expect(result.error).toContain('42');
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it('keys the limiter on the client IP and fails closed', async () => {
    await verifySystemPassword('wrong');

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      'system-admin-login:203.0.113.9',
      5,
      900,
      // failClosed is not a preference here: a Redis outage must not open an
      // unmetered brute-force window on a shared credential.
      { failClosed: true },
    );
  });

  it('audits a rate-limited attempt', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 42 });

    await verifySystemPassword(PASSWORD);

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'system.auth.rate_limited' }),
    );
  });
});

/**
 * Honest scope note: these pin the FUNCTIONAL behaviour of the comparison, not
 * its timing. Swapping timingSafeEquals back to `===` fails none of them, because
 * the two are functionally identical and only the timing differs — which a unit
 * test cannot measure without being hopelessly flaky.
 *
 * The length-mismatch case below is not filler, though: crypto.timingSafeEqual
 * THROWS on unequal buffer lengths, so without the explicit length pre-check the
 * action would reject with an exception instead of "Invalid password". That test
 * guards a real bug in the implementation.
 */
describe('verifySystemPassword — comparison (F-056)', () => {
  it('rejects a wrong password and issues no cookie', async () => {
    const result = await verifySystemPassword('wrong');

    expect(result).toEqual({ success: false, error: 'Invalid password' });
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  // A length-only difference must not be treated as a match, and must not throw:
  // crypto.timingSafeEqual raises on unequal buffer lengths, so the length check
  // has to come first.
  it('rejects a password that differs only in length', async () => {
    const result = await verifySystemPassword(PASSWORD + 'x');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid password');
  });

  it('rejects an empty password', async () => {
    const result = await verifySystemPassword('');

    expect(result.success).toBe(false);
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it('accepts the correct password and issues an httpOnly cookie', async () => {
    const result = await verifySystemPassword(PASSWORD);

    expect(result).toEqual({ success: true });
    expect(mockCookieSet).toHaveBeenCalledTimes(1);

    const [name, token, opts] = mockCookieSet.mock.calls[0];
    expect(name).toBe('system_admin_auth');
    // payload.hmac — the signature is appended after the JSON payload.
    expect(token).toMatch(/^\{.*\}\.[0-9a-f]{64}$/);
    expect(opts).toMatchObject({ httpOnly: true, path: '/' });
  });
});

describe('verifySystemPassword — audit trail (F-094)', () => {
  it('audits a failure', async () => {
    await verifySystemPassword('wrong');

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'system.auth.failure', actorRole: 'system_admin' }),
    );
  });

  it('audits a success', async () => {
    await verifySystemPassword(PASSWORD);

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'system.auth.success', actorRole: 'system_admin' }),
    );
  });

  /**
   * There is no actorId to record, because the credential is shared (F-056). The
   * trail can prove someone holding it acted, and from where — not who. A
   * fabricated actorId would make the record look authoritative while being
   * fiction, so its ABSENCE is the correct behaviour and is pinned here.
   */
  it('records IP and role but never invents an actorId', async () => {
    await verifySystemPassword(PASSWORD);

    const entry = mockAudit.mock.calls.at(-1)?.[0];
    expect(entry.ip).toBe('203.0.113.9');
    expect(entry.actorRole).toBe('system_admin');
    expect(entry.actorId).toBeUndefined();
  });
});
