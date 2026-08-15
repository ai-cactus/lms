import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  ALWAYS_ON_NOTIFICATION_CATEGORY,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_DEFAULTS,
  categoryForNotificationType,
  type NotificationCategoryPreferenceMap,
} from './catalog';

/**
 * Org-wide delivery switches, resolved against the shipped defaults.
 *
 * Reads deliberately fail open: a missing row, an unclassified type, or a
 * failed lookup must never be the reason a notification silently vanishes. The
 * security category ignores storage entirely — it is always on.
 */

export type NotificationChannel = 'email' | 'inApp';

/** Every category's effective setting for one organization. */
export async function getNotificationCategoryPreferences(
  organizationId: string,
): Promise<NotificationCategoryPreferenceMap> {
  const rows = await prisma.notificationCategoryPreference.findMany({
    where: { organizationId },
    select: { category: true, emailEnabled: true, inAppEnabled: true },
  });

  const stored = new Map(
    rows.map((row) => [
      row.category,
      { emailEnabled: row.emailEnabled, inAppEnabled: row.inAppEnabled },
    ]),
  );

  const resolved = {} as NotificationCategoryPreferenceMap;
  for (const category of NOTIFICATION_CATEGORIES) {
    resolved[category] =
      category === ALWAYS_ON_NOTIFICATION_CATEGORY
        ? { emailEnabled: true, inAppEnabled: true }
        : (stored.get(category) ?? NOTIFICATION_CATEGORY_DEFAULTS[category]);
  }
  return resolved;
}

/** Whether an organization still wants this notification type on this channel. */
export async function isNotificationChannelEnabled(
  organizationId: string,
  type: string,
  channel: NotificationChannel,
): Promise<boolean> {
  const category = categoryForNotificationType(type);
  if (!category || category === ALWAYS_ON_NOTIFICATION_CATEGORY) return true;

  try {
    const row = await prisma.notificationCategoryPreference.findUnique({
      where: { organizationId_category: { organizationId, category } },
      select: { emailEnabled: true, inAppEnabled: true },
    });
    const preference = row ?? NOTIFICATION_CATEGORY_DEFAULTS[category];
    return channel === 'email' ? preference.emailEnabled : preference.inAppEnabled;
  } catch (err) {
    logger.error({
      msg: '[notifications] Failed to read category preference',
      orgId: organizationId,
      category,
      err,
    });
    return true;
  }
}

/**
 * In-app variant for call sites that only hold the recipient's membership — the
 * switch is org-wide, so the membership is resolved back to its organization.
 */
export async function isInAppEnabledForMembership(
  organizationUserId: string,
  type: string,
): Promise<boolean> {
  const category = categoryForNotificationType(type);
  if (!category || category === ALWAYS_ON_NOTIFICATION_CATEGORY) return true;

  const membership = await prisma.organizationUser.findUnique({
    where: { id: organizationUserId },
    select: { organizationId: true },
  });
  if (!membership) return true;

  return isNotificationChannelEnabled(membership.organizationId, type, 'inApp');
}
