/**
 * Unit tests for the org-wide notification category switches.
 *
 * The invariant under test is that every read FAILS OPEN: an unclassified type,
 * a missing row, or a failed lookup must never be the reason a notification
 * silently vanishes. The security category is the one hard-coded exception in
 * the other direction — it is always on regardless of what is stored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockLogger } = vi.hoisted(() => ({
  prismaMock: {
    notificationCategoryPreference: { findMany: vi.fn(), findUnique: vi.fn() },
    organizationUser: { findUnique: vi.fn() },
  },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/logger', () => ({ logger: mockLogger }));

import {
  getNotificationCategoryPreferences,
  isInAppEnabledForMembership,
  isNotificationChannelEnabled,
} from './category-preferences';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.notificationCategoryPreference.findMany.mockResolvedValue([]);
  prismaMock.notificationCategoryPreference.findUnique.mockResolvedValue(null);
  prismaMock.organizationUser.findUnique.mockResolvedValue({ organizationId: 'org-1' });
});

describe('getNotificationCategoryPreferences', () => {
  it('falls back to the shipped defaults for every category with no stored row', async () => {
    const preferences = await getNotificationCategoryPreferences('org-1');

    expect(preferences).toEqual({
      training: { emailEnabled: false, inAppEnabled: true },
      documentation: { emailEnabled: true, inAppEnabled: true },
      workforce: { emailEnabled: false, inAppEnabled: true },
      reports: { emailEnabled: true, inAppEnabled: true },
      security: { emailEnabled: true, inAppEnabled: true },
    });
  });

  it('overlays stored rows onto the defaults', async () => {
    prismaMock.notificationCategoryPreference.findMany.mockResolvedValue([
      { category: 'training', emailEnabled: true, inAppEnabled: false },
    ]);

    const preferences = await getNotificationCategoryPreferences('org-1');

    expect(preferences.training).toEqual({ emailEnabled: true, inAppEnabled: false });
    expect(preferences.documentation).toEqual({ emailEnabled: true, inAppEnabled: true });
  });

  it('reports security as on even when a stored row says otherwise', async () => {
    prismaMock.notificationCategoryPreference.findMany.mockResolvedValue([
      { category: 'security', emailEnabled: false, inAppEnabled: false },
    ]);

    const preferences = await getNotificationCategoryPreferences('org-1');

    expect(preferences.security).toEqual({ emailEnabled: true, inAppEnabled: true });
  });
});

describe('isNotificationChannelEnabled', () => {
  it('applies the default when the category has no stored row', async () => {
    // STAFF_ADDED is a workforce type, and workforce ships email-off/in-app-on.
    expect(await isNotificationChannelEnabled('org-1', 'STAFF_ADDED', 'email')).toBe(false);
    expect(await isNotificationChannelEnabled('org-1', 'STAFF_ADDED', 'inApp')).toBe(true);
  });

  it('honours the stored row over the default', async () => {
    prismaMock.notificationCategoryPreference.findUnique.mockResolvedValue({
      emailEnabled: true,
      inAppEnabled: false,
    });

    expect(await isNotificationChannelEnabled('org-1', 'STAFF_ADDED', 'email')).toBe(true);
    expect(await isNotificationChannelEnabled('org-1', 'STAFF_ADDED', 'inApp')).toBe(false);
  });

  it('leaves a type that is not in the catalog ungated, without querying', async () => {
    expect(await isNotificationChannelEnabled('org-1', 'SOMETHING_UNCLASSIFIED', 'email')).toBe(
      true,
    );
    expect(prismaMock.notificationCategoryPreference.findUnique).not.toHaveBeenCalled();
  });

  it('fails open when the lookup throws', async () => {
    prismaMock.notificationCategoryPreference.findUnique.mockRejectedValue(new Error('DB down'));

    expect(await isNotificationChannelEnabled('org-1', 'STAFF_ADDED', 'email')).toBe(true);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe('isInAppEnabledForMembership', () => {
  it('resolves the membership to its organization and applies that switch', async () => {
    prismaMock.notificationCategoryPreference.findUnique.mockResolvedValue({
      emailEnabled: true,
      inAppEnabled: false,
    });

    expect(await isInAppEnabledForMembership('ou-1', 'STAFF_ADDED')).toBe(false);
    expect(prismaMock.organizationUser.findUnique).toHaveBeenCalledWith({
      where: { id: 'ou-1' },
      select: { organizationId: true },
    });
  });

  it('fails open when the membership no longer exists', async () => {
    prismaMock.organizationUser.findUnique.mockResolvedValue(null);

    expect(await isInAppEnabledForMembership('ou-gone', 'STAFF_ADDED')).toBe(true);
  });

  it('skips the membership lookup entirely for an unclassified type', async () => {
    expect(await isInAppEnabledForMembership('ou-1', 'SOMETHING_UNCLASSIFIED')).toBe(true);
    expect(prismaMock.organizationUser.findUnique).not.toHaveBeenCalled();
  });
});
