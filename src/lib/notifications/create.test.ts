/**
 * Unit tests for notifyOrganizationAdmins (src/lib/notifications/create.ts),
 * Q-25: the admin fan-out reaches only the members who can open the notice's
 * link, and a notice nobody can open is logged rather than dropped silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockWarn, mockIsChannelEnabled } = vi.hoisted(() => ({
  prismaMock: {
    organizationUser: { findMany: vi.fn() },
    notificationPreference: { findMany: vi.fn(), findUnique: vi.fn() },
    notification: { createMany: vi.fn(), create: vi.fn() },
  },
  mockWarn: vi.fn(),
  mockIsChannelEnabled: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: mockWarn, error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/notifications/category-preferences', () => ({
  isNotificationChannelEnabled: mockIsChannelEnabled,
  isInAppEnabledForMembership: vi.fn().mockResolvedValue(true),
}));

import { notifyOrganizationAdmins } from './create';

const TIER = [
  { id: 'owner-1', role: 'owner' },
  { id: 'hr-1', role: 'hr' },
  { id: 'cd-1', role: 'clinical_director' },
  { id: 'fin-1', role: 'finance' },
];

const notice = (linkUrl?: string) => ({
  type: 'COURSE_PASSED',
  title: 'Course Completed',
  message: 'Dana completed Safety.',
  linkUrl,
});

function recipients(): string[] {
  const [args] = prismaMock.notification.createMany.mock.calls[0];
  return args.data.map((row: { organizationUserId: string }) => row.organizationUserId);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsChannelEnabled.mockResolvedValue(true);
  prismaMock.organizationUser.findMany.mockResolvedValue(TIER);
  prismaMock.notificationPreference.findMany.mockResolvedValue([]);
  prismaMock.notification.createMany.mockResolvedValue({ count: 0 });
});

describe('notifyOrganizationAdmins — audience follows the link (Q-25)', () => {
  it('sends a staff-profile notice only to user.read holders (not Clinical Director, not Finance)', async () => {
    await notifyOrganizationAdmins('org-1', notice('/dashboard/staff/ou-9'));

    expect(recipients()).toEqual(['owner-1', 'hr-1']);
  });

  it('sends a Status Tracker notice to every assignment.read holder (not Finance)', async () => {
    await notifyOrganizationAdmins('org-1', notice('/dashboard/status-tracker'));

    expect(recipients()).toEqual(['owner-1', 'hr-1', 'cd-1']);
  });

  it('narrows nobody for a link the whole tier can open', async () => {
    await notifyOrganizationAdmins('org-1', notice('/dashboard'));

    expect(recipients()).toEqual(['owner-1', 'hr-1', 'cd-1', 'fin-1']);
  });

  it('checks opt-outs only for the narrowed audience and still honours them', async () => {
    prismaMock.notificationPreference.findMany.mockResolvedValue([{ organizationUserId: 'hr-1' }]);

    await notifyOrganizationAdmins('org-1', notice('/dashboard/staff/ou-9'));

    expect(prismaMock.notificationPreference.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationUserId: { in: ['owner-1', 'hr-1'] } }),
      }),
    );
    expect(recipients()).toEqual(['owner-1']);
  });

  it('warns and writes nothing when no admin can open the link', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([
      { id: 'cd-1', role: 'clinical_director' },
      { id: 'fin-1', role: 'finance' },
    ]);

    await notifyOrganizationAdmins('org-1', notice('/dashboard/staff/ou-9'));

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        type: 'COURSE_PASSED',
        requiredPermission: 'user.read',
        adminCount: 2,
      }),
    );
  });
});
