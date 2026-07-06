/**
 * Unit tests for src/lib/reminders/recipients.ts
 *
 * Covers: same-org admin manager preferred; cross-org/non-admin manager falls
 * back to org admins; no manager → org admins; no org → empty + warn;
 * no admins → empty + warn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockLoggerWarn } = vi.hoisted(() => {
  const prismaMock = {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const mockLoggerWarn = vi.fn();
  return { prismaMock, mockLoggerWarn };
});

vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  },
  maskEmail: (e: string) => e,
}));

import { resolveEscalationRecipients } from './recipients';

const WORKER = { id: 'user-1', organizationId: 'org-1', managerId: null };
const MANAGER_ADMIN = {
  id: 'mgr-1',
  email: 'manager@test.com',
  role: 'owner',
  organizationId: 'org-1',
  profile: { fullName: 'Alice Manager' },
};
const MANAGER_NON_ADMIN = { ...MANAGER_ADMIN, id: 'mgr-2', role: 'worker' };
const MANAGER_CROSS_ORG = { ...MANAGER_ADMIN, id: 'mgr-3', organizationId: 'org-2' };
const ORG_ADMIN = {
  id: 'admin-1',
  email: 'admin@test.com',
  profile: { fullName: 'Bob Admin' },
};

describe('resolveEscalationRecipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the direct manager when they are an admin in the same org', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ ...WORKER, managerId: 'mgr-1' }) // worker lookup
      .mockResolvedValueOnce(MANAGER_ADMIN); // manager lookup

    const result = await resolveEscalationRecipients({ userId: 'user-1' });

    expect(result.userIds).toEqual(['mgr-1']);
    expect(result.emails).toEqual([{ email: 'manager@test.com', name: 'Alice Manager' }]);
    // No fallback query — the org-admin findMany should not have run
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('falls back to org admins when the manager is not in the same org', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ ...WORKER, managerId: 'mgr-3' })
      .mockResolvedValueOnce(MANAGER_CROSS_ORG); // cross-org manager → ignored
    prismaMock.user.findMany.mockResolvedValue([ORG_ADMIN]);

    const result = await resolveEscalationRecipients({ userId: 'user-1' });

    expect(result.userIds).toEqual(['admin-1']);
    expect(result.emails).toEqual([{ email: 'admin@test.com', name: 'Bob Admin' }]);
  });

  it('falls back to org admins when the manager exists but is not an admin role', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ ...WORKER, managerId: 'mgr-2' })
      .mockResolvedValueOnce(MANAGER_NON_ADMIN); // worker-role manager → ignored
    prismaMock.user.findMany.mockResolvedValue([ORG_ADMIN]);

    const result = await resolveEscalationRecipients({ userId: 'user-1' });

    expect(result.userIds).toEqual(['admin-1']);
  });

  it('falls back to org admins directly when the worker has no manager (managerId: null)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(WORKER); // managerId is null — skip manager lookup
    prismaMock.user.findMany.mockResolvedValue([ORG_ADMIN]);

    const result = await resolveEscalationRecipients({ userId: 'user-1' });

    // Only one findUnique call (worker); no manager findUnique
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    expect(result.userIds).toEqual(['admin-1']);
  });

  it('returns empty recipients and logs a warning when the worker has no organization', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      organizationId: null,
      managerId: null,
    });

    const result = await resolveEscalationRecipients({ userId: 'user-1' });

    expect(result.userIds).toHaveLength(0);
    expect(result.emails).toHaveLength(0);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('no organization') }),
    );
  });

  it('returns empty recipients and logs a warning when no admins exist in the org', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(WORKER); // no managerId
    prismaMock.user.findMany.mockResolvedValue([]); // no org admins

    const result = await resolveEscalationRecipients({ userId: 'user-1' });

    expect(result.userIds).toHaveLength(0);
    expect(result.emails).toHaveLength(0);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('No escalation recipients') }),
    );
  });

  it('returns multiple org admins when the fallback finds several', async () => {
    const admin2 = { id: 'admin-2', email: 'admin2@test.com', profile: null };
    prismaMock.user.findUnique.mockResolvedValueOnce(WORKER);
    prismaMock.user.findMany.mockResolvedValue([ORG_ADMIN, admin2]);

    const result = await resolveEscalationRecipients({ userId: 'user-1' });

    expect(result.userIds).toEqual(['admin-1', 'admin-2']);
    // admin2 has null profile → name is null
    expect(result.emails).toContainEqual({ email: 'admin2@test.com', name: null });
  });
});
