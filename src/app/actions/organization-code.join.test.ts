/**
 * BUG-59: an existing member who enters their own organization's join code was
 * upserted to the default worker role — a silent downgrade for an admin, HR or
 * supervisor, and a self-serve undo of a revocation for a removed member. The
 * join code now refuses any existing membership and changes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  mockWorkerAuth,
  mockAdminAuth,
  mockCreateMembership,
  mockEnrollUserForRoleTargets,
  mockCreateNotification,
  mockEmitNotificationEvent,
} = vi.hoisted(() => ({
  prismaMock: {
    organization: { findUnique: vi.fn() },
    facility: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  mockWorkerAuth: vi.fn(),
  mockAdminAuth: vi.fn(),
  mockCreateMembership: vi.fn(),
  mockEnrollUserForRoleTargets: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockEmitNotificationEvent: vi.fn(),
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
vi.mock('@/lib/notifications/create', () => ({ createNotification: mockCreateNotification }));
vi.mock('@/lib/notifications/emit', () => ({ emitNotificationEvent: mockEmitNotificationEvent }));
vi.mock('@/lib/enrollment/role-targets', () => ({
  enrollUserForRoleTargets: mockEnrollUserForRoleTargets,
}));
vi.mock('@/lib/auth/membership', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/membership')>()),
  createMembership: mockCreateMembership,
}));

import { joinOrganization } from './organization-code';
import { ExistingMembershipError } from '@/lib/auth/membership';
import { DEFAULT_SELF_SERVE_WORKER_ROLE } from '@/lib/rbac/role-utils';

describe('joinOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkerAuth.mockResolvedValue({ user: { id: 'user-1', email: 'a@example.com' } });
    prismaMock.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Acme Health',
      joinCodeExpiresAt: null,
      primaryBusinessType: null,
      primaryContact: null,
      facilities: [],
    });
    prismaMock.facility.findFirst.mockResolvedValue({ id: 'facility-1' });
    prismaMock.user.findUnique.mockResolvedValue({ email: 'a@example.com', fullName: 'Ada' });
  });

  it('joins a newcomer as the default worker role without re-roling any existing membership', async () => {
    mockCreateMembership.mockResolvedValue({
      organizationUserId: 'ou-1',
      organizationId: 'org-1',
      organizationName: 'Acme Health',
      organizationSlug: 'acme-health',
      role: DEFAULT_SELF_SERVE_WORKER_ROLE,
    });

    const result = await joinOrganization('123456');

    expect(result).toEqual({ success: true, organizationId: 'org-1' });
    expect(mockCreateMembership).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      role: DEFAULT_SELF_SERVE_WORKER_ROLE,
      onExisting: 'refuse',
    });
  });

  it('returns a refusal for an active member and runs no join side effects', async () => {
    mockCreateMembership.mockRejectedValue(new ExistingMembershipError(true));

    const result = await joinOrganization('123456');

    expect(result).toEqual({
      success: false,
      error: 'You are already a member of this organization.',
    });
    expect(mockEnrollUserForRoleTargets).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockEmitNotificationEvent).not.toHaveBeenCalled();
  });

  it('returns a refusal for a deactivated member instead of restoring their access', async () => {
    mockCreateMembership.mockRejectedValue(new ExistingMembershipError(false));

    const result = await joinOrganization('123456');

    expect(result).toEqual({
      success: false,
      error: 'Your access to this organization was removed. Ask an administrator to restore it.',
    });
    expect(mockEnrollUserForRoleTargets).not.toHaveBeenCalled();
    expect(mockEmitNotificationEvent).not.toHaveBeenCalled();
  });
});
