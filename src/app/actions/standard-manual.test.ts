/**
 * `getStandardManualHistory` gated on the coarse `isAdminRole`, which admits
 * every manager seat — Finance and Supervisor included — while ignoring the
 * `standardManual.*` permissions the registry already defines. The accreditation
 * manuals behind the RAG knowledge base are now behind `standardManual.read`.
 *
 * The `/system` panel reaches this action through the system-admin cookie, not
 * a member session, so that path must stay open regardless of role.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAuth, mockVerifySystemAdminCookie } = vi.hoisted(() => ({
  prismaMock: { standardManual: { findMany: vi.fn(), findFirst: vi.fn() } },
  mockAuth: vi.fn(),
  mockVerifySystemAdminCookie: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/system-auth', () => ({ verifySystemAdminCookie: mockVerifySystemAdminCookie }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { getStandardManualHistory } from './standard-manual';
import { logger } from '@/lib/logger';

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySystemAdminCookie.mockResolvedValue(false);
  prismaMock.standardManual.findMany.mockResolvedValue([]);
});

describe('getStandardManualHistory', () => {
  it('refuses an unauthenticated caller', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(getStandardManualHistory()).rejects.toThrow('Unauthorized');
    expect(prismaMock.standardManual.findMany).not.toHaveBeenCalled();
  });

  // The two roles the old `isAdminRole` check wrongly admitted. Supervisor is
  // the read-everything-except-billing role and DOES hold standardManual.read,
  // so the regression this pins is Finance — plus every worker role.
  it.each(['finance', 'nurse', 'front_desk_admin'])(
    'refuses role=%s — missing standardManual.read',
    async (role) => {
      mockAuth.mockResolvedValue({ user: { id: 'user-x', role } });

      await expect(getStandardManualHistory()).rejects.toThrow('Forbidden');
      expect(prismaMock.standardManual.findMany).not.toHaveBeenCalled();
    },
  );

  it('logs the denial with userId and role, and never an email', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-x', role: 'finance', email: 'f@example.com' } });

    await expect(getStandardManualHistory()).rejects.toThrow('Forbidden');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-x', role: 'finance' }),
    );
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('f@example.com');
  });

  it.each(['owner', 'admin', 'clinical_director', 'supervisor'])(
    'allows role=%s through to the query',
    async (role) => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1', role } });

      await expect(getStandardManualHistory()).resolves.toEqual([]);
      expect(prismaMock.standardManual.findMany).toHaveBeenCalledTimes(1);
    },
  );

  // The /system panel authenticates by cookie and has no member role at all.
  it('allows the system admin with no member session', async () => {
    mockVerifySystemAdminCookie.mockResolvedValue(true);
    mockAuth.mockResolvedValue(null);

    await expect(getStandardManualHistory()).resolves.toEqual([]);
    expect(prismaMock.standardManual.findMany).toHaveBeenCalledTimes(1);
  });
});
