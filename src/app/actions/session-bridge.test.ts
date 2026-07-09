/**
 * Tests for the Manage/Learn session-bridge server action.
 *
 * `enterLearnMode` must never widen who can LOG IN to the worker portal — it
 * only lets an already-authenticated admin mint a second, worker-scoped
 * session for themselves after a fresh DB role re-check. Any rejection path
 * must redirect without minting a cookie or writing an audit row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockAuth,
  mockFindUnique,
  mockEncode,
  mockAudit,
  mockRedirect,
  mockCookieStore,
  mockCookies,
} = vi.hoisted(() => {
  const mockCookieStore = { set: vi.fn(), delete: vi.fn() };
  return {
    mockAuth: vi.fn(),
    mockFindUnique: vi.fn(),
    mockEncode: vi.fn(),
    mockAudit: vi.fn(),
    mockRedirect: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    mockCookieStore,
    mockCookies: vi.fn(() => Promise.resolve(mockCookieStore)),
  };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: mockFindUnique } },
  default: { user: { findUnique: mockFindUnique } },
}));
vi.mock('next/headers', () => ({ cookies: mockCookies }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('next-auth/jwt', () => ({ encode: mockEncode }));
vi.mock('@/lib/audit', () => ({ audit: mockAudit }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => `masked:${email}`,
}));

import { enterLearnMode, clearSiblingSessionCookie } from './session-bridge';

const freshAdmin = {
  id: 'user-1',
  email: 'owner@acme.com',
  role: 'owner',
  organizationId: 'org-1',
  mfaEnabled: false,
  authProvider: 'credentials',
  passwordResetRequired: false,
  sessionVersion: 1,
  profile: { fullName: 'Owner Person' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCookies.mockImplementation(() => Promise.resolve(mockCookieStore));
  mockRedirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  vi.stubEnv('AUTH_SECRET', 'test-secret');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('INACTIVITY_TIMEOUT_MINUTES', '60');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('enterLearnMode — rejection paths', () => {
  it('redirects to /login and touches nothing when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(enterLearnMode()).rejects.toThrow('NEXT_REDIRECT:/login');

    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockEncode).not.toHaveBeenCalled();
    expect(mockCookieStore.set).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('redirects to /dashboard and mints nothing when the fresh DB user no longer exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockFindUnique.mockResolvedValue(null);

    await expect(enterLearnMode()).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    expect(mockEncode).not.toHaveBeenCalled();
    expect(mockCookieStore.set).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('redirects to /dashboard and mints nothing when the fresh DB role is no longer admin-tier', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockFindUnique.mockResolvedValue({ ...freshAdmin, role: 'nurse' });

    await expect(enterLearnMode()).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    expect(mockEncode).not.toHaveBeenCalled();
    expect(mockCookieStore.set).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe('enterLearnMode — happy path', () => {
  it('mints a worker-cookie session for a valid admin session and redirects to /worker', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Owner Person', sessionId: 'session-abc', mfaVerified: true },
    });
    mockFindUnique.mockResolvedValue(freshAdmin);
    mockEncode.mockResolvedValue('signed-jwt-token');

    await expect(enterLearnMode()).rejects.toThrow('NEXT_REDIRECT:/worker');

    expect(mockEncode).toHaveBeenCalledWith(
      expect.objectContaining({
        secret: 'test-secret',
        salt: 'worker.session-token',
        maxAge: 3600,
        token: expect.objectContaining({
          id: 'user-1',
          role: 'owner',
          organizationId: 'org-1',
          sessionId: 'session-abc',
          mfaVerified: true,
        }),
      }),
    );

    expect(mockCookieStore.set).toHaveBeenCalledWith(
      'worker.session-token',
      'signed-jwt-token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: false,
        maxAge: 3600,
      }),
    );

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.mode_switch',
        actorId: 'user-1',
        actorRole: 'owner',
        organizationId: 'org-1',
        metadata: { direction: 'learn' },
      }),
    );
  });

  it('mints a fresh sessionId and defaults mfaVerified to true when the admin session carries neither', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockFindUnique.mockResolvedValue(freshAdmin);
    mockEncode.mockResolvedValue('signed-jwt-token');

    await expect(enterLearnMode()).rejects.toThrow('NEXT_REDIRECT:/worker');

    const call = mockEncode.mock.calls[0][0] as {
      token: { sessionId: string; mfaVerified: boolean };
    };
    expect(typeof call.token.sessionId).toBe('string');
    expect(call.token.sessionId.length).toBeGreaterThan(0);
    expect(call.token.mfaVerified).toBe(true);
  });

  it('falls back to /dashboard and writes neither cookie nor audit row when minting fails', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockFindUnique.mockResolvedValue(freshAdmin);
    mockEncode.mockRejectedValue(new Error('encode blew up'));

    await expect(enterLearnMode()).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    expect(mockCookieStore.set).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe('clearSiblingSessionCookie', () => {
  it('deletes both cookie-name variants for the worker instance when logging out of admin', async () => {
    await clearSiblingSessionCookie('admin');

    expect(mockCookieStore.delete).toHaveBeenCalledWith('__Secure-worker.session-token');
    expect(mockCookieStore.delete).toHaveBeenCalledWith('worker.session-token');
  });

  it('deletes both cookie-name variants for the admin instance when logging out of worker', async () => {
    await clearSiblingSessionCookie('worker');

    expect(mockCookieStore.delete).toHaveBeenCalledWith('__Secure-admin.session-token');
    expect(mockCookieStore.delete).toHaveBeenCalledWith('admin.session-token');
  });

  it('never throws even when cookies() rejects', async () => {
    mockCookies.mockRejectedValueOnce(new Error('cookie store unavailable'));

    await expect(clearSiblingSessionCookie('admin')).resolves.toBeUndefined();
  });
});
