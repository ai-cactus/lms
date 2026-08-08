/**
 * Tests for the Manage/Learn and org-switch session-bridge server actions.
 *
 * `enterLearnMode` must never widen who can LOG IN to the worker portal — it
 * only lets an already-authenticated admin mint a second, worker-scoped
 * session for themselves after a fresh DB membership re-check. Any rejection
 * path must redirect without minting a cookie or writing an audit row.
 *
 * `switchOrganization` re-mints the session JWT against a different
 * `OrganizationUser` membership — membership is re-verified server-side
 * (via `getActiveMembership`), so a caller can never widen access by passing
 * another organization's id; the DB lookup for a non-membership simply
 * resolves to null and the switch is rejected.
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
  mockGetActiveMembership,
  mockListActiveMemberships,
  mockRecordMembershipLogin,
  mockExpireSiblingSessionCookies,
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
    mockGetActiveMembership: vi.fn(),
    mockListActiveMemberships: vi.fn(),
    mockRecordMembershipLogin: vi.fn(),
    mockExpireSiblingSessionCookies: vi.fn(),
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
vi.mock('@/lib/auth/session-cookies', () => ({
  expireSiblingSessionCookies: mockExpireSiblingSessionCookies,
}));
vi.mock('@/lib/auth/membership', () => ({
  getActiveMembership: mockGetActiveMembership,
  listActiveMemberships: mockListActiveMemberships,
  recordMembershipLogin: mockRecordMembershipLogin,
}));

import { enterLearnMode, clearSiblingSessionCookie, switchOrganization } from './session-bridge';

// User is global identity only post multi-org refactor — no role/organizationId/profile.
const freshUser = {
  id: 'user-1',
  email: 'owner@acme.com',
  fullName: 'Owner Person',
  mfaEnabled: false,
  authProvider: 'credentials',
  passwordResetRequired: false,
  sessionVersion: 1,
};

function membership(
  overrides: Partial<{ organizationUserId: string; organizationId: string; role: string }> = {},
) {
  return {
    organizationUserId: overrides.organizationUserId ?? 'ou-1',
    organizationId: overrides.organizationId ?? 'org-1',
    organizationName: 'Acme Health',
    organizationSlug: 'acme-health',
    role: overrides.role ?? 'owner',
  };
}

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
    mockAuth.mockResolvedValue({ user: { id: 'user-1', organizationId: 'org-1' } });
    mockFindUnique.mockResolvedValue(null);
    mockGetActiveMembership.mockResolvedValue(membership());

    await expect(enterLearnMode()).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    expect(mockEncode).not.toHaveBeenCalled();
    expect(mockCookieStore.set).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('redirects to /dashboard and mints nothing when the fresh active membership is no longer admin-tier', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', organizationId: 'org-1' } });
    mockFindUnique.mockResolvedValue(freshUser);
    mockGetActiveMembership.mockResolvedValue(membership({ role: 'nurse' }));

    await expect(enterLearnMode()).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    expect(mockEncode).not.toHaveBeenCalled();
    expect(mockCookieStore.set).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('redirects to /dashboard when the session carries no active organization at all', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } }); // no organizationId claim
    mockFindUnique.mockResolvedValue(freshUser);

    await expect(enterLearnMode()).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    expect(mockGetActiveMembership).not.toHaveBeenCalled();
    expect(mockEncode).not.toHaveBeenCalled();
  });
});

describe('enterLearnMode — happy path', () => {
  it('mints a worker-cookie session for a valid admin session and redirects to /worker', async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: 'user-1',
        name: 'Owner Person',
        organizationId: 'org-1',
        sessionId: 'session-abc',
        mfaVerified: true,
      },
    });
    mockFindUnique.mockResolvedValue(freshUser);
    mockGetActiveMembership.mockResolvedValue(membership());
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
          organizationUserId: 'ou-1',
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
    mockAuth.mockResolvedValue({ user: { id: 'user-1', organizationId: 'org-1' } });
    mockFindUnique.mockResolvedValue(freshUser);
    mockGetActiveMembership.mockResolvedValue(membership());
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
    mockAuth.mockResolvedValue({ user: { id: 'user-1', organizationId: 'org-1' } });
    mockFindUnique.mockResolvedValue(freshUser);
    mockGetActiveMembership.mockResolvedValue(membership());
    mockEncode.mockRejectedValue(new Error('encode blew up'));

    await expect(enterLearnMode()).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    expect(mockCookieStore.set).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

// ── switchOrganization: org-switch session re-mint (new critical logic) ────

describe('switchOrganization — rejection paths', () => {
  it('redirects to /login and mints nothing when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(switchOrganization('org-2')).rejects.toThrow('NEXT_REDIRECT:/login');

    expect(mockGetActiveMembership).not.toHaveBeenCalled();
    expect(mockEncode).not.toHaveBeenCalled();
  });

  it('redirects to /select-organization and mints nothing when the caller has no active membership in the target org', async () => {
    // Security: passing another organization's id must never widen access —
    // getActiveMembership re-verifies server-side and simply resolves null.
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockFindUnique.mockResolvedValue(freshUser);
    mockGetActiveMembership.mockResolvedValue(null);

    await expect(switchOrganization('org-not-mine')).rejects.toThrow(
      'NEXT_REDIRECT:/select-organization',
    );

    expect(mockGetActiveMembership).toHaveBeenCalledWith('user-1', 'org-not-mine');
    expect(mockEncode).not.toHaveBeenCalled();
    expect(mockCookieStore.set).not.toHaveBeenCalled();
    expect(mockRecordMembershipLogin).not.toHaveBeenCalled();
  });

  it('redirects to /select-organization when the fresh DB user no longer exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockFindUnique.mockResolvedValue(null);
    mockGetActiveMembership.mockResolvedValue(membership());

    await expect(switchOrganization('org-2')).rejects.toThrow('NEXT_REDIRECT:/select-organization');

    expect(mockEncode).not.toHaveBeenCalled();
  });
});

describe('switchOrganization — happy path re-mints the session for the new membership', () => {
  it('mints an admin-cookie session, sets it, clears the sibling cookie, and records the login when switching to an admin-tier membership', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Owner Person', sessionId: 'session-abc', mfaVerified: true },
    });
    mockFindUnique.mockResolvedValue(freshUser);
    mockGetActiveMembership.mockResolvedValue(
      membership({ organizationUserId: 'ou-2', organizationId: 'org-2', role: 'hr' }),
    );
    mockEncode.mockResolvedValue('signed-jwt-token');

    await expect(switchOrganization('org-2')).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    expect(mockGetActiveMembership).toHaveBeenCalledWith('user-1', 'org-2');
    expect(mockEncode).toHaveBeenCalledWith(
      expect.objectContaining({
        salt: 'admin.session-token',
        token: expect.objectContaining({
          id: 'user-1',
          role: 'hr',
          organizationId: 'org-2',
          organizationUserId: 'ou-2',
          sessionId: 'session-abc',
        }),
      }),
    );
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      'admin.session-token',
      'signed-jwt-token',
      expect.objectContaining({ httpOnly: true, maxAge: 3600 }),
    );
    // The two portals must never hold live sessions for different contexts.
    expect(mockExpireSiblingSessionCookies).toHaveBeenCalledWith(mockCookieStore, 'admin');
    // Stamps the per-org login timestamp and the picker-skip preference for next login.
    expect(mockRecordMembershipLogin).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ organizationUserId: 'ou-2', organizationId: 'org-2' }),
    );
  });

  it('mints a worker-cookie session and redirects to /worker when the target membership is a worker-tier role', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockFindUnique.mockResolvedValue(freshUser);
    mockGetActiveMembership.mockResolvedValue(
      membership({ organizationUserId: 'ou-3', organizationId: 'org-3', role: 'nurse' }),
    );
    mockEncode.mockResolvedValue('signed-jwt-token');

    await expect(switchOrganization('org-3')).rejects.toThrow('NEXT_REDIRECT:/worker');

    expect(mockEncode).toHaveBeenCalledWith(
      expect.objectContaining({ salt: 'worker.session-token' }),
    );
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      'worker.session-token',
      'signed-jwt-token',
      expect.anything(),
    );
    expect(mockExpireSiblingSessionCookies).toHaveBeenCalledWith(mockCookieStore, 'worker');
  });

  it('writes an audit row tagged organization_switch with the new membership’s org and role', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockFindUnique.mockResolvedValue(freshUser);
    mockGetActiveMembership.mockResolvedValue(
      membership({ organizationUserId: 'ou-2', organizationId: 'org-2', role: 'hr' }),
    );
    mockEncode.mockResolvedValue('signed-jwt-token');

    await expect(switchOrganization('org-2')).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.mode_switch',
        actorId: 'user-1',
        actorRole: 'hr',
        organizationId: 'org-2',
        metadata: { direction: 'organization_switch' },
      }),
    );
  });

  it('falls back to /select-organization and skips the cookie/audit/login-record when minting fails', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockFindUnique.mockResolvedValue(freshUser);
    mockGetActiveMembership.mockResolvedValue(membership());
    mockEncode.mockRejectedValue(new Error('encode blew up'));

    await expect(switchOrganization('org-1')).rejects.toThrow('NEXT_REDIRECT:/select-organization');

    expect(mockCookieStore.set).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockRecordMembershipLogin).not.toHaveBeenCalled();
  });
});

describe('clearSiblingSessionCookie', () => {
  // Deletion is emitted as an expired `set(..., '')` rather than a bare
  // `delete()` so the `__Secure-` prefixed name carries the `Secure` attribute
  // the prefix requires — a bare delete omits it and the browser rejects the
  // deletion under https. See src/lib/auth/session-cookies.ts.
  it('delegates to expireSiblingSessionCookies with the current instance', async () => {
    await clearSiblingSessionCookie('admin');

    expect(mockExpireSiblingSessionCookies).toHaveBeenCalledWith(mockCookieStore, 'admin');
  });

  it('never throws even when cookies() rejects', async () => {
    mockCookies.mockRejectedValueOnce(new Error('cookie store unavailable'));

    await expect(clearSiblingSessionCookie('admin')).resolves.toBeUndefined();
  });
});
