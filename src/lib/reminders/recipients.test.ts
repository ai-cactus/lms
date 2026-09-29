/**
 * Unit tests for src/lib/reminders/recipients.ts
 *
 * Covers: same-org active admin manager preferred; cross-org/non-admin/inactive
 * manager falls back to org admins; no manager → org admins; membership not
 * found → empty + warn; no admins → empty + warn; Q-25 — only members holding
 * the permission the escalation's link needs are returned, a manager lacking it
 * is passed over, and nobody qualifying → empty + warn.
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
import {
  LADDER_ESCALATION_PERMISSION,
  REASSIGN_ESCALATION_PERMISSION,
  permissionForLink,
} from '@/lib/notifications/link-audience';

const LADDER = LADDER_ESCALATION_PERMISSION;

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
  role: 'admin',
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

    const result = await resolveEscalationRecipients({
      organizationUserId: 'orgUser-1',
      requiredPermission: LADDER,
    });

    expect(result.organizationUserIds).toEqual(['mgr-1']);
    expect(result.emails).toEqual([{ email: 'manager@test.com', name: 'Alice Manager' }]);
    expect(result.members).toEqual([
      { organizationUserId: 'mgr-1', email: 'manager@test.com', name: 'Alice Manager' },
    ]);
    // No fallback query — the org-admin findMany should not have run
    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
  });

  it('falls back to org admins when the manager is not in the same org', async () => {
    prismaMock.organizationUser.findUnique
      .mockResolvedValueOnce({ ...WORKER, managerId: 'mgr-3' })
      .mockResolvedValueOnce(MANAGER_CROSS_ORG); // cross-org manager → ignored
    prismaMock.organizationUser.findMany.mockResolvedValue([ORG_ADMIN]);

    const result = await resolveEscalationRecipients({
      organizationUserId: 'orgUser-1',
      requiredPermission: LADDER,
    });

    expect(result.organizationUserIds).toEqual(['admin-1']);
    expect(result.emails).toEqual([{ email: 'admin@test.com', name: 'Bob Admin' }]);
    expect(result.members).toEqual([
      { organizationUserId: 'admin-1', email: 'admin@test.com', name: 'Bob Admin' },
    ]);
  });

  it('falls back to org admins when the manager exists but is not an admin role', async () => {
    prismaMock.organizationUser.findUnique
      .mockResolvedValueOnce({ ...WORKER, managerId: 'mgr-2' })
      .mockResolvedValueOnce(MANAGER_NON_ADMIN); // worker-role manager → ignored
    prismaMock.organizationUser.findMany.mockResolvedValue([ORG_ADMIN]);

    const result = await resolveEscalationRecipients({
      organizationUserId: 'orgUser-1',
      requiredPermission: LADDER,
    });

    expect(result.organizationUserIds).toEqual(['admin-1']);
  });

  it('falls back to org admins when the manager membership is deactivated', async () => {
    // New in the multi-org model: a deactivated manager membership must not be
    // treated as a valid escalation target even if role/org still match.
    prismaMock.organizationUser.findUnique
      .mockResolvedValueOnce({ ...WORKER, managerId: 'mgr-4' })
      .mockResolvedValueOnce(MANAGER_INACTIVE);
    prismaMock.organizationUser.findMany.mockResolvedValue([ORG_ADMIN]);

    const result = await resolveEscalationRecipients({
      organizationUserId: 'orgUser-1',
      requiredPermission: LADDER,
    });

    expect(result.organizationUserIds).toEqual(['admin-1']);
  });

  it('falls back to org admins directly when the worker has no manager (managerId: null)', async () => {
    prismaMock.organizationUser.findUnique.mockResolvedValueOnce(WORKER); // managerId is null — skip manager lookup
    prismaMock.organizationUser.findMany.mockResolvedValue([ORG_ADMIN]);

    const result = await resolveEscalationRecipients({
      organizationUserId: 'orgUser-1',
      requiredPermission: LADDER,
    });

    // Only one findUnique call (worker); no manager findUnique
    expect(prismaMock.organizationUser.findUnique).toHaveBeenCalledTimes(1);
    expect(result.organizationUserIds).toEqual(['admin-1']);
  });

  it('returns empty recipients and logs a warning when the membership is not found', async () => {
    // OrganizationUser.organizationId is a required FK — there is no longer a
    // "worker with no organization" state to model. The equivalent dead end is
    // the membership lookup itself missing (e.g. a stale/removed membership id).
    prismaMock.organizationUser.findUnique.mockResolvedValueOnce(null);

    const result = await resolveEscalationRecipients({
      organizationUserId: 'orgUser-1',
      requiredPermission: LADDER,
    });

    expect(result.organizationUserIds).toHaveLength(0);
    expect(result.members).toHaveLength(0);
    expect(result.emails).toHaveLength(0);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('membership not found') }),
    );
  });

  it('returns empty recipients and logs a warning when no admins exist in the org', async () => {
    prismaMock.organizationUser.findUnique.mockResolvedValueOnce(WORKER); // no managerId
    prismaMock.organizationUser.findMany.mockResolvedValue([]); // no org admins

    const result = await resolveEscalationRecipients({
      organizationUserId: 'orgUser-1',
      requiredPermission: LADDER,
    });

    expect(result.organizationUserIds).toHaveLength(0);
    expect(result.emails).toHaveLength(0);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('No escalation recipients') }),
    );
  });

  it('returns multiple org admins when the fallback finds several', async () => {
    const admin2 = {
      id: 'admin-2',
      role: 'hr',
      user: { email: 'admin2@test.com', fullName: null },
    };
    prismaMock.organizationUser.findUnique.mockResolvedValueOnce(WORKER);
    prismaMock.organizationUser.findMany.mockResolvedValue([ORG_ADMIN, admin2]);

    const result = await resolveEscalationRecipients({
      organizationUserId: 'orgUser-1',
      requiredPermission: LADDER,
    });

    expect(result.organizationUserIds).toEqual(['admin-1', 'admin-2']);
    // admin2 has null fullName → name is null
    expect(result.emails).toContainEqual({ email: 'admin2@test.com', name: null });
  });

  it('only queries active admins, scoped to the org, when falling back', async () => {
    prismaMock.organizationUser.findUnique.mockResolvedValueOnce(WORKER);
    prismaMock.organizationUser.findMany.mockResolvedValue([ORG_ADMIN]);

    await resolveEscalationRecipients({
      organizationUserId: 'orgUser-1',
      requiredPermission: LADDER,
    });

    expect(prismaMock.organizationUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1', active: true }),
      }),
    );
  });

  describe('narrowed to who can open the link (Q-25)', () => {
    const CLINICAL_DIRECTOR = {
      id: 'cd-1',
      role: 'clinical_director',
      user: { email: 'cd@test.com', fullName: 'Casey Director' },
    };
    const FINANCE = {
      id: 'fin-1',
      role: 'finance',
      user: { email: 'fin@test.com', fullName: 'Fran Finance' },
    };

    it('pins each escalation permission to the link its notice actually opens', () => {
      expect(permissionForLink('/dashboard/status-tracker')).toBe(LADDER_ESCALATION_PERMISSION);
      expect(permissionForLink('/dashboard/staff/ou-1')).toBe(REASSIGN_ESCALATION_PERMISSION);
    });

    it('leaves Finance out of a Status Tracker escalation (no assignment.read)', async () => {
      prismaMock.organizationUser.findUnique.mockResolvedValueOnce(WORKER);
      prismaMock.organizationUser.findMany.mockResolvedValue([
        ORG_ADMIN,
        CLINICAL_DIRECTOR,
        FINANCE,
      ]);

      const result = await resolveEscalationRecipients({
        organizationUserId: 'orgUser-1',
        requiredPermission: LADDER_ESCALATION_PERMISSION,
      });

      expect(result.organizationUserIds).toEqual(['admin-1', 'cd-1']);
      expect(result.emails.map((e) => e.email)).toEqual(['admin@test.com', 'cd@test.com']);
    });

    it('leaves Clinical Director and Finance out of a staff-profile escalation (no user.read)', async () => {
      prismaMock.organizationUser.findUnique.mockResolvedValueOnce(WORKER);
      prismaMock.organizationUser.findMany.mockResolvedValue([
        ORG_ADMIN,
        CLINICAL_DIRECTOR,
        FINANCE,
      ]);

      const result = await resolveEscalationRecipients({
        organizationUserId: 'orgUser-1',
        requiredPermission: REASSIGN_ESCALATION_PERMISSION,
      });

      expect(result.organizationUserIds).toEqual(['admin-1']);
      expect(result.members.map((m) => m.email)).toEqual(['admin@test.com']);
    });

    it('passes over a manager who cannot open the link, for the admins who can', async () => {
      prismaMock.organizationUser.findUnique
        .mockResolvedValueOnce({ ...WORKER, managerId: 'cd-1' })
        .mockResolvedValueOnce({ ...MANAGER_ADMIN, id: 'cd-1', role: 'clinical_director' });
      prismaMock.organizationUser.findMany.mockResolvedValue([ORG_ADMIN, CLINICAL_DIRECTOR]);

      const result = await resolveEscalationRecipients({
        organizationUserId: 'orgUser-1',
        requiredPermission: REASSIGN_ESCALATION_PERMISSION,
      });

      expect(result.organizationUserIds).toEqual(['admin-1']);
    });

    it('keeps a Clinical Director manager for a Status Tracker escalation they can open', async () => {
      prismaMock.organizationUser.findUnique
        .mockResolvedValueOnce({ ...WORKER, managerId: 'cd-1' })
        .mockResolvedValueOnce({ ...MANAGER_ADMIN, id: 'cd-1', role: 'clinical_director' });

      const result = await resolveEscalationRecipients({
        organizationUserId: 'orgUser-1',
        requiredPermission: LADDER_ESCALATION_PERMISSION,
      });

      expect(result.organizationUserIds).toEqual(['cd-1']);
      expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
    });

    it('warns — never silently drops — when nobody in the tier can open the link', async () => {
      prismaMock.organizationUser.findUnique.mockResolvedValueOnce(WORKER);
      prismaMock.organizationUser.findMany.mockResolvedValue([FINANCE]);

      const result = await resolveEscalationRecipients({
        organizationUserId: 'orgUser-1',
        requiredPermission: LADDER_ESCALATION_PERMISSION,
      });

      expect(result.organizationUserIds).toHaveLength(0);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: expect.stringContaining('No escalation recipients'),
          requiredPermission: 'assignment.read',
          adminCount: 1,
        }),
      );
    });
  });
});
