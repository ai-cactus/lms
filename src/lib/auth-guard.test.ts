/**
 * Unit tests for the shared authz guard (F-012).
 * Covers the claim matrix (unauthenticated / MFA / admin role) across both
 * entry points, plus the requireMfa:false carve-out for MFA-verify endpoints.
 */
import { describe, it, expect } from 'vitest';
import type { Session } from 'next-auth';
import {
  AuthzError,
  requireActionSession,
  guardApiSession,
  type AuthGuardOptions,
} from './auth-guard';

type TestUser = {
  id: string;
  email: string;
  role?: string;
  organizationId?: string | null;
  mfaEnabled?: boolean;
  mfaVerified?: boolean;
};

function makeSession(user: TestUser): Session {
  return { user, expires: '2999-01-01T00:00:00.000Z' } as unknown as Session;
}

const adminVerified: TestUser = {
  id: 'u1',
  email: 'a@example.com',
  role: 'owner',
  organizationId: 'org1',
  mfaEnabled: true,
  mfaVerified: true,
};

const workerNoMfa: TestUser = {
  id: 'u2',
  email: 'w@example.com',
  role: 'nurse',
  organizationId: 'org1',
  mfaEnabled: false,
  mfaVerified: true,
};

const mfaPending: TestUser = {
  id: 'u3',
  email: 'p@example.com',
  role: 'owner',
  organizationId: 'org1',
  mfaEnabled: true,
  mfaVerified: false,
};

describe('requireActionSession', () => {
  it('throws UNAUTHENTICATED when session is null or undefined', () => {
    expect(() => requireActionSession(null)).toThrowError(AuthzError);
    try {
      requireActionSession(undefined);
    } catch (err) {
      expect(err).toBeInstanceOf(AuthzError);
      expect((err as AuthzError).code).toBe('UNAUTHENTICATED');
    }
  });

  it('throws UNAUTHENTICATED when session has no user', () => {
    try {
      requireActionSession({ expires: '2999-01-01T00:00:00.000Z' } as unknown as Session);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthzError);
      expect((err as AuthzError).code).toBe('UNAUTHENTICATED');
    }
  });

  it('throws MFA_REQUIRED when MFA is enabled but not verified', () => {
    try {
      requireActionSession(makeSession(mfaPending));
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as AuthzError).code).toBe('MFA_REQUIRED');
    }
  });

  it('does not throw MFA_REQUIRED when requireMfa is false (verify endpoints)', () => {
    expect(() =>
      requireActionSession(makeSession(mfaPending), { requireMfa: false }),
    ).not.toThrow();
  });

  it('throws FORBIDDEN when admin role is required but user is a worker', () => {
    const opts: AuthGuardOptions = { role: 'admin' };
    try {
      requireActionSession(makeSession(workerNoMfa), opts);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as AuthzError).code).toBe('FORBIDDEN');
    }
  });

  it('passes for a verified admin when admin role is required', () => {
    expect(() => requireActionSession(makeSession(adminVerified), { role: 'admin' })).not.toThrow();
  });

  it('passes for an authenticated MFA-disabled worker with no role requirement', () => {
    expect(() => requireActionSession(makeSession(workerNoMfa))).not.toThrow();
  });
});

describe('guardApiSession', () => {
  it('returns a 401 for an unauthenticated session', async () => {
    const res = guardApiSession(null);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    await expect(res!.json()).resolves.toEqual({ error: 'UNAUTHENTICATED' });
  });

  it('returns a 401 when MFA is required', async () => {
    const res = guardApiSession(makeSession(mfaPending));
    expect(res!.status).toBe(401);
    await expect(res!.json()).resolves.toEqual({ error: 'MFA_REQUIRED' });
  });

  it('returns a 403 when admin role is required but caller is a worker', async () => {
    const res = guardApiSession(makeSession(workerNoMfa), { role: 'admin' });
    expect(res!.status).toBe(403);
    await expect(res!.json()).resolves.toEqual({ error: 'FORBIDDEN' });
  });

  it('returns null (continue) for an authorized admin', () => {
    expect(guardApiSession(makeSession(adminVerified), { role: 'admin' })).toBeNull();
  });

  it('returns null when MFA is pending but requireMfa is false', () => {
    expect(guardApiSession(makeSession(mfaPending), { requireMfa: false })).toBeNull();
  });
});
