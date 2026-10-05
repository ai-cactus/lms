'use server';

// Every export of a 'use server' module is a publicly callable endpoint, so this
// file holds ONLY inbox actions scoped to the caller's own membership. Creating
// notifications is server-internal and lives in `@/lib/notifications/create`.

import prisma from '@/lib/prisma';
import { getRealmSession, type PortalRealm } from '@/lib/auth/portal-sessions';
import { logger } from '@/lib/logger';
import { categoryForNotificationType } from '@/lib/notifications/catalog';
import { withLiveCourseLinks } from '@/lib/notifications/live-course-links';

/**
 * The membership whose inbox the calling portal's session reads. Notifications
 * belong to an OrganizationUser, not an identity, so a user in two orgs has two
 * separate inboxes and never sees the other org's items.
 *
 * BUG-47: both portals render an inbox, and one browser can hold an admin and a
 * worker session for two DIFFERENT accounts. The caller names its portal; a
 * guess that preferred the admin session served the worker header the admin's
 * inbox and let its mutations land there.
 */
async function resolveOrganizationUserId(realm: PortalRealm): Promise<string | null> {
  const session = await getRealmSession(realm);
  return session?.user?.organizationUserId ?? null;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Cheap unread-count query. Used for the header badge so the count stays
 * correct even when there are more unread notifications than a single page.
 */
export async function getUnreadCount(realm: PortalRealm) {
  const organizationUserId = await resolveOrganizationUserId(realm);
  if (!organizationUserId) {
    return { success: false as const, error: 'Unauthorized' };
  }
  try {
    const unreadCount = await prisma.notification.count({
      where: { organizationUserId, isRead: false },
    });
    return { success: true as const, unreadCount };
  } catch (error) {
    logger.error({ msg: 'Failed to count notifications:', err: error });
    return { success: false as const, error: 'Failed to count notifications' };
  }
}

/**
 * Fetch a page of notifications for the current user, newest first.
 * Cursor-based: pass the previous page's `nextCursor` to load older items.
 * `unreadCount` is the global unread total (independent of the `type` filter).
 */
export async function getNotifications(
  realm: PortalRealm,
  options?: {
    cursor?: string | null;
    limit?: number;
    type?: string | null;
  },
) {
  const session = await getRealmSession(realm);
  const organizationUserId = session?.user?.organizationUserId ?? null;
  if (!organizationUserId) {
    return { success: false as const, error: 'Unauthorized' };
  }

  const limit = Math.min(Math.max(options?.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const cursor = options?.cursor ?? undefined;
  const type = options?.type ?? undefined;

  try {
    const rows = await prisma.notification.findMany({
      where: { organizationUserId, ...(type ? { type } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // fetch one extra to detect whether more remain
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;
    const notifications = await withLiveCourseLinks(page, session?.user?.role);

    const unreadCount = await prisma.notification.count({
      where: { organizationUserId, isRead: false },
    });

    return { success: true as const, notifications, nextCursor, hasMore, unreadCount };
  } catch (error) {
    logger.error({ msg: 'Failed to get notifications:', err: error });
    return { success: false as const, error: 'Failed to fetch notifications' };
  }
}

/**
 * Mark a specific notification as read.
 */
export async function markAsRead(realm: PortalRealm, notificationId: string) {
  const organizationUserId = await resolveOrganizationUserId(realm);
  if (!organizationUserId) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    await prisma.notification.updateMany({
      where: {
        id: notificationId,
        organizationUserId, // Ensure they own it
      },
      data: { isRead: true },
    });

    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Failed to mark read:', err: error });
    return { success: false, error: 'Failed to update' };
  }
}

/**
 * Mark all unread notifications for the user as read.
 */
export async function markAllAsRead(realm: PortalRealm) {
  const organizationUserId = await resolveOrganizationUserId(realm);
  if (!organizationUserId) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    await prisma.notification.updateMany({
      where: {
        organizationUserId,
        isRead: false,
      },
      data: { isRead: true },
    });

    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Failed to mark all as read:', err: error });
    return { success: false, error: 'Failed to update' };
  }
}

/**
 * Delete a single notification owned by the current user.
 */
export async function deleteNotification(realm: PortalRealm, notificationId: string) {
  const organizationUserId = await resolveOrganizationUserId(realm);
  if (!organizationUserId) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    await prisma.notification.deleteMany({
      where: { id: notificationId, organizationUserId },
    });
    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Failed to delete notification:', err: error });
    return { success: false, error: 'Failed to delete' };
  }
}

/**
 * Delete all notifications for the current user.
 */
export async function clearAllNotifications(realm: PortalRealm) {
  const organizationUserId = await resolveOrganizationUserId(realm);
  if (!organizationUserId) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    await prisma.notification.deleteMany({ where: { organizationUserId } });
    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Failed to clear notifications:', err: error });
    return { success: false, error: 'Failed to clear' };
  }
}

/**
 * Return the current user's per-type opt-out map. Types without a row default
 * to enabled, so the result only ever contains explicit `false` overrides plus
 * any explicit `true` rows.
 */
export async function getNotificationPreferences(realm: PortalRealm) {
  const organizationUserId = await resolveOrganizationUserId(realm);
  if (!organizationUserId) {
    return { success: false as const, error: 'Unauthorized' };
  }
  try {
    const rows = await prisma.notificationPreference.findMany({
      where: { organizationUserId },
      select: { type: true, enabled: true },
    });
    const preferences: Record<string, boolean> = {};
    for (const row of rows) preferences[row.type] = row.enabled;
    return { success: true as const, preferences };
  } catch (error) {
    logger.error({ msg: 'Failed to get notification preferences:', err: error });
    return { success: false as const, error: 'Failed to fetch preferences' };
  }
}

/**
 * Enable or disable a notification type for the current user.
 */
export async function setNotificationPreference(
  realm: PortalRealm,
  type: string,
  enabled: boolean,
) {
  const organizationUserId = await resolveOrganizationUserId(realm);
  if (!organizationUserId) {
    return { success: false, error: 'Unauthorized' };
  }
  // Server Action arguments arrive unchecked; without this a caller could park
  // arbitrary junk rows on its own membership that no reader ever consults.
  if (typeof type !== 'string' || categoryForNotificationType(type) === null) {
    logger.warn({
      msg: '[notifications] Refused a preference for an unknown notification type',
      organizationUserId,
    });
    return { success: false, error: 'Unknown notification type' };
  }
  if (typeof enabled !== 'boolean') {
    return { success: false, error: 'Invalid preference value' };
  }
  try {
    await prisma.notificationPreference.upsert({
      where: { organizationUserId_type: { organizationUserId, type } },
      create: { organizationUserId, type, enabled },
      update: { enabled },
    });
    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Failed to set notification preference:', err: error });
    return { success: false, error: 'Failed to update preference' };
  }
}
