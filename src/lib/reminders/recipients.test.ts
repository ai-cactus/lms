/**
 * Unit tests for src/lib/reminders/recipients.ts
 *
 * Covers: same-org active admin manager preferred; cross-org/non-admin/inactive
 * manager falls back to org admins; no manager → org admins; membership not
 * found → empty + warn; no admins → empty + warn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockLoggerWarn } = vi.hoisted(() => {
  const prismaMock = {
    organizationUser: {
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

const WORKER = { organizationId: 'org-1', managerId: null };
const MANAGER_ADMIN = {
  id: 'mgr-1',
  role: 'owner',
  organizationId: 'org-1',
  active: true,
  user: { email: 'manager@test.com', fullName: 'Alice Manager' },
};
const MANAGER_NON_ADMIN = { ...MANAGER_ADMIN, id: 'mgr-2', role: 'nurse' };
const MANAGER_CROSS_ORG = { ...MANAGER_ADMIN, id: 'mgr-3', organizationId: 'org-2' };
const MANAGER_INACTIVE = { ...MANAGER_ADMIN, id: 'mgr-4', active: false };
const ORG_ADMIN = {
  id: 'admin-1',
  user: { email: 'admin@test.com', fullName: 'Bob Admin' },
};

describe('resolveEscalationRecipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the direct manager when they are an active admin in the same org', async () => {
    prismaMock.organizationUser.findUnique
      .mockResolvedValueOnce({ ...WORKER, managerId: 'mgr-1' }) // worker lookup
      .mockResolvedValueOnce(MANAGER_ADMIN); // manager lookup

    const result = await resolveEscalationRecipients({ organizationUserId: 'orgUser-1' });

    expect(result.organizationUserIds).toEqual(['mgr-1']);
    expect(result.emails).toEqual([{ email: 'manager@test.com', name: 'Alice Manager' }]);
    // No fallback query — the org-admin findMany should not have run
    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
  });

  it('falls back to org admins when the manager is not in the same org', async () => {
    prismaMock.organizationUser.findUnique
      .mockResolvedValueOnce({ ...WORKER, managerId: 'mgr-3' })
      .mockResolvedValueOnce(MANAGER_CROSS_ORG); // cross-org manager → ignored
    prismaMock.organizationUser.findMany.mockResolvedValue([ORG_ADMIN]);

    const result = await resolveEscalationRecipients({ organizationUserId: 'orgUser-1' });

    expect(result.organizationUserIds).toEqual(['admin-1']);
    expect(result.emails).toEqual([{ email: 'admin@test.com', name: 'Bob Admin' }]);
  });

  it('falls back to org admins when the manager exists but is not an admin role', async () => {
    prismaMock.organizationUser.findUnique
      .mockResolvedValueOnce({ ...WORKER, managerId: 'mgr-2' })
      .mockResolvedValueOnce(MANAGER_NON_ADMIN); // worker-role manager → ignored
    prismaMock.organizationUser.findMany.mockResolvedValue([ORG_ADMIN]);

    const result = await resolveEscalationRecipients({ organizationUserId: 'orgUser-1' });

    expect(result.organizationUserIds).toEqual(['admin-1']);
  });

  it('falls back to org admins when the manager membership is deactivated', async () => {
    // New in the multi-org model: a deactivated manager membership must not be
    // treated as a valid escalation target even if role/org still match.
    prismaMock.organizationUser.findUnique
      .mockResolvedValueOnce({ ...WORKER, managerId: 'mgr-4' })
      .mockResolvedValueOnce(MANAGER_INACTIVE);
    prismaMock.organizationUser.findMany.mockResolvedValue([ORG_ADMIN]);

    const result = await resolveEscalationRecipients({ organizationUserId: 'orgUser-1' });

    expect(result.organizationUserIds).toEqual(['admin-1']);
  });

  it('falls back to org admins directly when the worker has no manager (managerId: null)', async () => {
    prismaMock.organizationUser.findUnique.mockResolvedValueOnce(WORKER); // managerId is null — skip manager lookup
    prismaMock.organizationUser.findMany.mockResolvedValue([ORG_ADMIN]);

    const result = await resolveEscalationRecipients({ organizationUserId: 'orgUser-1' });

    // Only one findUnique call (worker); no manager findUnique
    expect(prismaMock.organizationUser.findUnique).toHaveBeenCalledTimes(1);
    expect(result.organizationUserIds).toEqual(['admin-1']);
  });

  it('returns empty recipients and logs a warning when the membership is not found', async () => {
    // OrganizationUser.organizationId is a required FK — there is no longer a
    // "worker with no organization" state to model. The equivalent dead end is
    // the membership lookup itself missing (e.g. a stale/removed membership id).
    prismaMock.organizationUser.findUnique.mockResolvedValueOnce(null);

    const result = await resolveEscalationRecipients({ organizationUserId: 'orgUser-1' });

    expect(result.organizationUserIds).toHaveLength(0);
    expect(result.emails).toHaveLength(0);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('membership not found') }),
    );
  });

  it('returns empty recipients and logs a warning when no admins exist in the org', async () => {
    prismaMock.organizationUser.findUnique.mockResolvedValueOnce(WORKER); // no managerId
    prismaMock.organizationUser.findMany.mockResolvedValue([]); // no org admins

    const result = await resolveEscalationRecipients({ organizationUserId: 'orgUser-1' });

    expect(result.organizationUserIds).toHaveLength(0);
    expect(result.emails).toHaveLength(0);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('No escalation recipients') }),
    );
  });

  it('returns multiple org admins when the fallback finds several', async () => {
    const admin2 = { id: 'admin-2', user: { email: 'admin2@test.com', fullName: null } };
    prismaMock.organizationUser.findUnique.mockResolvedValueOnce(WORKER);
    prismaMock.organizationUser.findMany.mockResolvedValue([ORG_ADMIN, admin2]);

    const result = await resolveEscalationRecipients({ organizationUserId: 'orgUser-1' });

    expect(result.organizationUserIds).toEqual(['admin-1', 'admin-2']);
    // admin2 has null fullName → name is null
    expect(result.emails).toContainEqual({ email: 'admin2@test.com', name: null });
  });

  it('only queries active admins, scoped to the org, when falling back', async () => {
    prismaMock.organizationUser.findUnique.mockResolvedValueOnce(WORKER);
    prismaMock.organizationUser.findMany.mockResolvedValue([ORG_ADMIN]);

    await resolveEscalationRecipients({ organizationUserId: 'orgUser-1' });

    expect(prismaMock.organizationUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1', active: true }),
      }),
    );
  });
});
