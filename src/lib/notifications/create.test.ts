/**
 * Unit tests for notifyOrganizationAdmins (src/lib/notifications/create.ts),
 * Q-25: the admin fan-out reaches only the members who can open the notice's
 * link, and a notice nobody can open is logged rather than dropped silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockWarn, mockError, mockIsChannelEnabled } = vi.hoisted(() => ({
  prismaMock: {
    organizationUser: { findMany: vi.fn() },
    notificationPreference: { findMany: vi.fn(), findUnique: vi.fn() },
    notification: { createMany: vi.fn(), create: vi.fn() },
  },
  mockWarn: vi.fn(),
  mockError: vi.fn(),
  mockIsChannelEnabled: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: mockWarn, error: mockError, debug: vi.fn() },
  maskEmail: () => '[masked]',
}));
vi.mock('@/lib/notifications/category-preferences', () => ({
  isNotificationChannelEnabled: mockIsChannelEnabled,
  isInAppEnabledForMembership: vi.fn().mockResolvedValue(true),
}));

import { notifyOrganizationAdmins, notifyOrganizationAdminsWithEmail } from './create';

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

describe('notifyOrganizationAdminsWithEmail — one audience for the bell and the email (BUG-55)', () => {
  const TIER_WITH_EMAIL = TIER.map((admin) => ({
    ...admin,
    user: { email: `${admin.id}@acme.com` },
  }));
  const STAFF_NOTICE = { ...notice('/dashboard/staff/ou-9'), type: 'QUIZ_RETRY_LIMIT_REACHED' };

  beforeEach(() => {
    prismaMock.organizationUser.findMany.mockResolvedValue(TIER_WITH_EMAIL);
  });

  it('writes the bell row and emails exactly the Q-25 audience minus opt-outs', async () => {
    prismaMock.notificationPreference.findMany.mockResolvedValue([{ organizationUserId: 'hr-1' }]);
    const sendEmail = vi.fn().mockResolvedValue({ success: true });

    await notifyOrganizationAdminsWithEmail('org-1', STAFF_NOTICE, sendEmail);

    expect(recipients()).toEqual(['owner-1']);
    expect(sendEmail).toHaveBeenCalledExactlyOnceWith({
      organizationUserId: 'owner-1',
      email: 'owner-1@acme.com',
    });
  });

  it('still emails when the org switched the category off in-app', async () => {
    mockIsChannelEnabled.mockImplementation(async (_org, _type, channel) => channel === 'email');
    const sendEmail = vi.fn().mockResolvedValue({ success: true });

    await notifyOrganizationAdminsWithEmail('org-1', STAFF_NOTICE, sendEmail);

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  // Q-34 (ruled 2026-10-07: honour the switch): the quiz-locked email follows
  // the organisation's Training email switch, as every other Training email does.
  it('sends no email when the org switched the category off for email, keeping the bell row', async () => {
    mockIsChannelEnabled.mockImplementation(async (_org, _type, channel) => channel === 'inApp');
    const sendEmail = vi.fn().mockResolvedValue({ success: true });

    await notifyOrganizationAdminsWithEmail('org-1', STAFF_NOTICE, sendEmail);

    expect(mockIsChannelEnabled).toHaveBeenCalledWith('org-1', 'QUIZ_RETRY_LIMIT_REACHED', 'email');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(recipients()).toEqual(['owner-1', 'hr-1']);
  });

  it('emails the audience when the org switched the category on for email', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true });

    await notifyOrganizationAdminsWithEmail('org-1', STAFF_NOTICE, sendEmail);

    expect(mockIsChannelEnabled).toHaveBeenCalledWith('org-1', 'QUIZ_RETRY_LIMIT_REACHED', 'email');
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(recipients()).toEqual(['owner-1', 'hr-1']);
  });

  it('sends nothing at all when both switches are off', async () => {
    mockIsChannelEnabled.mockResolvedValue(false);
    const sendEmail = vi.fn();

    await notifyOrganizationAdminsWithEmail('org-1', STAFF_NOTICE, sendEmail);

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends nothing on either channel when no admin can open the link', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue(
      TIER_WITH_EMAIL.filter((a) => a.role === 'finance'),
    );
    const sendEmail = vi.fn();

    await notifyOrganizationAdminsWithEmail('org-1', STAFF_NOTICE, sendEmail);

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('logs a failed or throwing send, delivers the rest, and never throws', async () => {
    const sendEmail = vi
      .fn()
      .mockResolvedValueOnce({ success: false })
      .mockRejectedValueOnce(new Error('SMTP down'));

    await expect(
      notifyOrganizationAdminsWithEmail('org-1', STAFF_NOTICE, sendEmail),
    ).resolves.toBeUndefined();

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(mockError).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mockError.mock.calls)).not.toContain('@acme.com');
  });

  it('never throws when the audience lookup fails', async () => {
    prismaMock.organizationUser.findMany.mockRejectedValue(new Error('db down'));
    const sendEmail = vi.fn();

    await expect(
      notifyOrganizationAdminsWithEmail('org-1', STAFF_NOTICE, sendEmail),
    ).resolves.toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
