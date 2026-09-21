'use server';

// Every export of a 'use server' module is a publicly callable endpoint, so this
// file holds ONLY inbox actions scoped to the caller's own membership. Creating
// notifications is server-internal and lives in `@/lib/notifications/create`.

import prisma from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { logger } from '@/lib/logger';

// Helper: resolve the active session from either auth instance
async function resolveSession() {
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

/**
 * The membership whose inbox the current session reads. Notifications belong to
 * an OrganizationUser, not an identity, so a user in two orgs has two separate
 * inboxes and never sees the other org's items.
 */
async function resolveOrganizationUserId(): Promise<string | null> {
  const session = await resolveSession();
  return session?.user?.organizationUserId ?? null;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Cheap unread-count query. Used for the header badge so the count stays
 * correct even when there are more unread notifications than a single page.
 */
export async function getUnreadCount() {
  const organizationUserId = await resolveOrganizationUserId();
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
export async function getNotifications(options?: {
  cursor?: string | null;
  limit?: number;
  type?: string | null;
}) {
  const organizationUserId = await resolveOrganizationUserId();
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
    const notifications = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? notifications[notifications.length - 1].id : null;

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
export async function markAsRead(notificationId: string) {
  const organizationUserId = await resolveOrganizationUserId();
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
export async function markAllAsRead() {
  const organizationUserId = await resolveOrganizationUserId();
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
export async function deleteNotification(notificationId: string) {
  const organizationUserId = await resolveOrganizationUserId();
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
export async function clearAllNotifications() {
  const organizationUserId = await resolveOrganizationUserId();
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
export async function getNotificationPreferences() {
  const organizationUserId = await resolveOrganizationUserId();
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
export async function setNotificationPreference(type: string, enabled: boolean) {
  const organizationUserId = await resolveOrganizationUserId();
  if (!organizationUserId) {
    return { success: false, error: 'Unauthorized' };
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
