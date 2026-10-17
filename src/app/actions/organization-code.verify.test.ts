/**
 * BUG-62: after BUG-59 an existing member (active or deactivated) was refused
 * only when they pressed Join. The verify step now gives them the same message
 * up front, and tells a non-member nothing it did not already show.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockWorkerAuth, mockAdminAuth } = vi.hoisted(() => ({
  prismaMock: {
    organization: { findUnique: vi.fn() },
    organizationUser: { findUnique: vi.fn() },
  },
  mockWorkerAuth: vi.fn(),
  mockAdminAuth: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('@/lib/notifications/create', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/notifications/emit', () => ({ emitNotificationEvent: vi.fn() }));
vi.mock('@/lib/enrollment/role-targets', () => ({ enrollUserForRoleTargets: vi.fn() }));

import { verifyOrganizationCode } from './organization-code';

const ORG_ROW = {
  id: 'org-1',
  name: 'Acme Health',
  joinCodeExpiresAt: null,
  primaryBusinessType: 'clinic',
  primaryContact: 'Ola Owner',
  facilities: [{ programServices: ['Nursing'], country: 'US', phone: '555-0100' }],
};

describe('verifyOrganizationCode — existing members (BUG-62)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkerAuth.mockResolvedValue({ user: { id: 'user-1', email: 'a@example.com' } });
    mockAdminAuth.mockResolvedValue(null);
    prismaMock.organization.findUnique.mockResolvedValue(ORG_ROW);
    prismaMock.organizationUser.findUnique.mockResolvedValue(null);
  });

  it('shows a non-member the organization, unchanged', async () => {
    const result = await verifyOrganizationCode('123456');

    expect(result).toEqual({
      success: true,
      organization: {
        id: 'org-1',
        name: 'Acme Health',
        type: 'clinic',
        services: ['Nursing'],
        country: 'US',
        phone: '555-0100',
        contactName: 'Ola Owner',
      },
    });
    expect(prismaMock.organizationUser.findUnique).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: 'user-1', organizationId: 'org-1' } },
      select: { active: true },
    });
  });

  it('refuses an active member up front with the join step’s message', async () => {
    prismaMock.organizationUser.findUnique.mockResolvedValue({ active: true });

    await expect(verifyOrganizationCode('123456')).resolves.toEqual({
      success: false,
      error: 'You are already a member of this organization.',
    });
  });

  it('refuses a deactivated member up front with the join step’s message', async () => {
    prismaMock.organizationUser.findUnique.mockResolvedValue({ active: false });

    await expect(verifyOrganizationCode('123456')).resolves.toEqual({
      success: false,
      error: 'Your access to this organization was removed. Ask an administrator to restore it.',
    });
  });

  it('reads the admin session when there is no worker session', async () => {
    mockWorkerAuth.mockResolvedValue(null);
    mockAdminAuth.mockResolvedValue({ user: { id: 'admin-9', email: 'b@example.com' } });
    prismaMock.organizationUser.findUnique.mockResolvedValue({ active: true });

    const result = await verifyOrganizationCode('123456');

    expect(result.success).toBe(false);
    expect(prismaMock.organizationUser.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_organizationId: { userId: 'admin-9', organizationId: 'org-1' } },
      }),
    );
  });

  it('runs no membership lookup for an invalid code, so it reveals nothing new', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null);

    await expect(verifyOrganizationCode('000000')).resolves.toEqual({
      success: false,
      error: 'Invalid code.',
    });
    expect(prismaMock.organizationUser.findUnique).not.toHaveBeenCalled();
  });

  it('runs no membership lookup for an expired code', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      ...ORG_ROW,
      joinCodeExpiresAt: new Date('2000-01-01T00:00:00Z'),
    });

    await expect(verifyOrganizationCode('123456')).resolves.toEqual({
      success: false,
      error: 'This code has expired.',
    });
    expect(prismaMock.organizationUser.findUnique).not.toHaveBeenCalled();
  });
});

describe('verifyOrganizationCode — soft-deleted organization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkerAuth.mockResolvedValue({ user: { id: 'user-1', email: 'a@example.com' } });
    mockAdminAuth.mockResolvedValue(null);
    prismaMock.organizationUser.findUnique.mockResolvedValue(null);
  });

  /** A tiny store that honours the `deletedAt: null` filter the way the database does. */
  function storeWith(org: typeof ORG_ROW & { deletedAt: Date | null }) {
    prismaMock.organization.findUnique.mockImplementation(
      async ({ where }: { where: { joinCode: string; deletedAt?: null } }) => {
        if (where.joinCode !== '123456') return null;
        if (where.deletedAt === null && org.deletedAt !== null) return null;
        return org;
      },
    );
  }

  it('answers a deleted organization code exactly like an unknown one', async () => {
    storeWith({ ...ORG_ROW, deletedAt: new Date('2026-10-08') });

    const deleted = await verifyOrganizationCode('123456');
    const unknown = await verifyOrganizationCode('999999');

    expect(deleted).toEqual({ success: false, error: 'Invalid code.' });
    expect(deleted).toEqual(unknown);
    expect(JSON.stringify(deleted)).not.toContain('Acme Health');
    expect(prismaMock.organizationUser.findUnique).not.toHaveBeenCalled();
  });

  it('still verifies the same code once the organization is live', async () => {
    storeWith({ ...ORG_ROW, deletedAt: null });

    const result = await verifyOrganizationCode('123456');

    expect(result.success).toBe(true);
  });

  it('looks the code up with the live-organization filter', async () => {
    storeWith({ ...ORG_ROW, deletedAt: null });

    await verifyOrganizationCode('123456');

    expect(prismaMock.organization.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { joinCode: '123456', deletedAt: null } }),
    );
  });
});
