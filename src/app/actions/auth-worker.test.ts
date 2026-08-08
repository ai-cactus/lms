/**
 * Tests for authenticateWorker() — the worker-portal login action.
 *
 * Focus: the post-login destination. A membership-less identity must be routed
 * to /onboarding-worker by the ACTION itself; leaving it on /worker for the
 * proxy's onboarding gate to re-route makes the middleware redirect disagree
 * with the Server Action's own redirectTo, which stalls or crashes the client
 * (Next.js E394 — see src/proxy.ts). Plus the pre-existing admin-tier bounce,
 * which must keep short-circuiting before signIn.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockSignInWorker } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    organizationUser: { findMany: vi.fn(), count: vi.fn() },
  },
  mockSignInWorker: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth.worker', () => ({ signIn: mockSignInWorker }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { authenticateWorker } from './auth-worker';

function makeLoginFormData(email: string, password = 'whatever') {
  const fd = new FormData();
  fd.set('email', email);
  fd.set('password', password);
  return fd;
}

function membershipRow(role: string, organizationId = 'org-1') {
  return {
    id: `ou-${role}`,
    role,
    organizationId,
    organization: { name: 'Acme', slug: 'acme' },
  };
}

describe('authenticateWorker — post-login redirect target', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1' });
  });

  it('sends a membership-less identity to /onboarding-worker, never /worker', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.organizationUser.count.mockResolvedValue(0);

    await authenticateWorker(undefined, makeLoginFormData('joiner@example.com'));

    expect(mockSignInWorker).toHaveBeenCalledWith(
      'credentials',
      expect.objectContaining({ redirectTo: '/onboarding-worker' }),
    );
  });

  it('sends an onboarded worker membership to /worker', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([membershipRow('nurse')]);

    await authenticateWorker(undefined, makeLoginFormData('nurse@example.com'));

    expect(mockSignInWorker).toHaveBeenCalledWith(
      'credentials',
      expect.objectContaining({ redirectTo: '/worker' }),
    );
  });

  it('bounces an admin-tier account to the admin login without signing in', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([membershipRow('hr')]);

    const result = await authenticateWorker(undefined, makeLoginFormData('hr@example.com'));

    expect(result).toEqual({ redirect: '/login' });
    expect(mockSignInWorker).not.toHaveBeenCalled();
  });

  it('defaults to /worker when the submitted email matches no identity', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await authenticateWorker(undefined, makeLoginFormData('nobody@example.com'));

    expect(mockSignInWorker).toHaveBeenCalledWith(
      'credentials',
      expect.objectContaining({ redirectTo: '/worker' }),
    );
  });
});
