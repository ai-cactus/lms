/**
 * Unit tests for the server actions behind Settings → Notification:
 * updateDigestFrequency (summary cadence) and
 * updateNotificationCategoryPreferences (per-category email / in-app switches).
 *
 * Both gate on `organization.edit` (Owner/Admin/HR), which is what makes them
 * the Q13 surface — notification, reminder and escalation configuration. Because
 * a server action is a public endpoint regardless of what the page itself gates,
 * they re-enforce the admin-role guard (requireActionSession) AND the permission
 * rather than trusting the caller reached them through the gated page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockRevalidatePath, mockLogger, mockAudit } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: {
    organization: { update: vi.fn() },
    notificationCategoryPreference: { upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  mockRevalidatePath: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  mockAudit: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock('@/lib/audit', () => ({ audit: mockAudit, getClientContext: () => ({}) }));
vi.mock('@/lib/logger', () => ({ logger: mockLogger }));

import {
  updateDigestFrequency,
  updateNotificationCategoryPreferences,
} from './notification-settings';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organization.update.mockResolvedValue({});
  prismaMock.notificationCategoryPreference.upsert.mockImplementation((args: unknown) => args);
  prismaMock.$transaction.mockResolvedValue([]);
  mockAudit.mockResolvedValue(undefined);
});

function sessionFor(role: string, organizationId: string | null = 'org-1') {
  return { user: { id: 'user-1', role, organizationId } };
}

describe('updateDigestFrequency — authorization', () => {
  it('rejects an unauthenticated caller (no session) as Unauthorized', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await updateDigestFrequency({ frequency: 'weekly' });

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  it('rejects a worker role (not even an admin role) as Unauthorized', async () => {
    mockAuth.mockResolvedValue(sessionFor('nurse'));

    const result = await updateDigestFrequency({ frequency: 'weekly' });

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  // organization.edit resolves to Owner/Admin/HR — HR joined per the founder's
  // Q9 answer, which is also what settles Q13 (notification, reminder and
  // escalation configuration → Owner/Admin/HR), since this gate IS that surface.
  it.each(['supervisor', 'clinical_director', 'finance'])(
    'rejects a role without organization.edit (%s) with a distinct message',
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));

      const result = await updateDigestFrequency({ frequency: 'weekly' });

      expect(result).toEqual({
        success: false,
        error: 'Only an organization owner or admin can change this setting.',
      });
      expect(prismaMock.organization.update).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: expect.stringContaining('Digest frequency update denied'),
          role,
        }),
      );
    },
  );

  it('allows the owner role through', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner'));

    const result = await updateDigestFrequency({ frequency: 'weekly' });

    expect(result).toEqual({ success: true });
  });

  // `admin` is Owner-equivalent; `hr` joined per founder Q9, which is what
  // settles Q13 — this action IS the notification-configuration surface.
  it.each(['admin', 'hr'])('allows the %s role through', async (role) => {
    mockAuth.mockResolvedValue(sessionFor(role));

    const result = await updateDigestFrequency({ frequency: 'weekly' });

    expect(result).toEqual({ success: true });
  });
});

describe('updateDigestFrequency — validation', () => {
  it('rejects an invalid enum value even for the owner, without touching the DB', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner'));

    const result = await updateDigestFrequency({
      // @ts-expect-error deliberately invalid to exercise zod validation
      frequency: 'monthly',
    });

    expect(result).toEqual({
      success: false,
      error: 'Choose a real-time, daily, or weekly summary.',
    });
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  it('returns "No organization found" when the owner session has no organizationId', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner', null));

    const result = await updateDigestFrequency({ frequency: 'daily' });

    expect(result).toEqual({ success: false, error: 'No organization found' });
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });
});

describe('updateDigestFrequency — happy path', () => {
  it('updates the organization column, revalidates the settings path, and returns success', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner'));

    const result = await updateDigestFrequency({ frequency: 'weekly' });

    expect(prismaMock.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { notificationDigestFrequency: 'weekly' },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/settings');
    expect(result).toEqual({ success: true });
  });

  it('accepts "daily" as well', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner'));

    const result = await updateDigestFrequency({ frequency: 'daily' });

    expect(prismaMock.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { notificationDigestFrequency: 'daily' } }),
    );
    expect(result).toEqual({ success: true });
  });

  // SET-004 added a third cadence: digest-tier events are dispatched at emit
  // time instead of being batched.
  it('accepts the new "realtime" cadence', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner'));

    const result = await updateDigestFrequency({ frequency: 'realtime' });

    expect(prismaMock.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { notificationDigestFrequency: 'realtime' } }),
    );
    expect(result).toEqual({ success: true });
  });
});

describe('updateDigestFrequency — resilience', () => {
  it('returns a generic failure (not a thrown error) when the DB update fails', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner'));
    prismaMock.organization.update.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await updateDigestFrequency({ frequency: 'daily' });

    expect(result).toEqual({ success: false, error: 'Failed to update notification settings' });
  });
});

/**
 * Category switches suppress delivery for the WHOLE tenant, so the action
 * re-enforces the same `organization.edit` gate as the cadence rather than
 * trusting the gated page a caller may never have visited.
 */
describe('updateNotificationCategoryPreferences — authorization', () => {
  const payload = {
    categories: [{ category: 'training' as const, emailEnabled: true, inAppEnabled: false }],
  };

  it('rejects an unauthenticated caller as Unauthorized', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await updateNotificationCategoryPreferences(payload);

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each(['supervisor', 'clinical_director', 'finance'])(
    'rejects a role without organization.edit (%s)',
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));

      const result = await updateNotificationCategoryPreferences(payload);

      expect(result).toEqual({
        success: false,
        error: 'Only an organization owner or admin can change this setting.',
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'admin', 'hr'])('allows %s through', async (role) => {
    mockAuth.mockResolvedValue(sessionFor(role));

    const result = await updateNotificationCategoryPreferences(payload);

    expect(result).toEqual({ success: true });
  });
});

describe('updateNotificationCategoryPreferences — validation and persistence', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(sessionFor('owner'));
  });

  it('upserts one row per category inside a single transaction', async () => {
    const result = await updateNotificationCategoryPreferences({
      categories: [
        { category: 'training', emailEnabled: false, inAppEnabled: true },
        { category: 'documentation', emailEnabled: true, inAppEnabled: true },
      ],
    });

    expect(result).toEqual({ success: true });
    expect(prismaMock.notificationCategoryPreference.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.notificationCategoryPreference.upsert).toHaveBeenCalledWith({
      where: { organizationId_category: { organizationId: 'org-1', category: 'training' } },
      create: {
        organizationId: 'org-1',
        category: 'training',
        emailEnabled: false,
        inAppEnabled: true,
      },
      update: { emailEnabled: false, inAppEnabled: true },
    });
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/settings');
  });

  // The client renders the security row disabled; a submission still carrying
  // it is a stale form, so it is dropped rather than rejected.
  it('never writes the always-on security category', async () => {
    const result = await updateNotificationCategoryPreferences({
      categories: [
        { category: 'security', emailEnabled: false, inAppEnabled: false },
        { category: 'reports', emailEnabled: true, inAppEnabled: true },
      ],
    });

    expect(result).toEqual({ success: true });
    expect(prismaMock.notificationCategoryPreference.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.notificationCategoryPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_category: { organizationId: 'org-1', category: 'reports' } },
      }),
    );
  });

  it('rejects an unknown category without touching the DB', async () => {
    const result = await updateNotificationCategoryPreferences({
      // @ts-expect-error deliberately invalid to exercise zod validation
      categories: [{ category: 'billing', emailEnabled: true, inAppEnabled: true }],
    });

    expect(result).toEqual({ success: false, error: 'Invalid notification categories.' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns "No organization found" when the session has no organizationId', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner', null));

    const result = await updateNotificationCategoryPreferences({
      categories: [{ category: 'training', emailEnabled: true, inAppEnabled: true }],
    });

    expect(result).toEqual({ success: false, error: 'No organization found' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns a generic failure (not a thrown error) when the write fails', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await updateNotificationCategoryPreferences({
      categories: [{ category: 'training', emailEnabled: true, inAppEnabled: true }],
    });

    expect(result).toEqual({ success: false, error: 'Failed to update notification settings' });
  });
});
