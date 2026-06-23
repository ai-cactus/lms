'use server';

import prisma from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { logger } from '@/lib/logger';

// Helper: resolve the active session from either auth instance
async function resolveSession() {
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Cheap unread-count query. Used for the header badge so the count stays
 * correct even when there are more unread notifications than a single page.
 */
export async function getUnreadCount() {
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false as const, error: 'Unauthorized' };
  }
  try {
    const unreadCount = await prisma.notification.count({
      where: { userId: session.user.id, isRead: false },
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
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false as const, error: 'Unauthorized' };
  }

  const limit = Math.min(Math.max(options?.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const cursor = options?.cursor ?? undefined;
  const type = options?.type ?? undefined;

  try {
    const rows = await prisma.notification.findMany({
      where: { userId: session.user.id, ...(type ? { type } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // fetch one extra to detect whether more remain
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const notifications = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? notifications[notifications.length - 1].id : null;

    const unreadCount = await prisma.notification.count({
      where: { userId: session.user.id, isRead: false },
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
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    await prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId: session.user.id, // Ensure they own it
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
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    await prisma.notification.updateMany({
      where: {
        userId: session.user.id,
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
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    await prisma.notification.deleteMany({
      where: { id: notificationId, userId: session.user.id },
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
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    await prisma.notification.deleteMany({ where: { userId: session.user.id } });
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
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false as const, error: 'Unauthorized' };
  }
  try {
    const rows = await prisma.notificationPreference.findMany({
      where: { userId: session.user.id },
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
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' };
  }
  try {
    await prisma.notificationPreference.upsert({
      where: { userId_type: { userId: session.user.id, type } },
      create: { userId: session.user.id, type, enabled },
      update: { enabled },
    });
    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Failed to set notification preference:', err: error });
    return { success: false, error: 'Failed to update preference' };
  }
}

/** True unless the user has an explicit opt-out row for this type. */
async function isTypeEnabled(userId: string, type: string) {
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_type: { userId, type } },
    select: { enabled: true },
  });
  return pref ? pref.enabled : true;
}

/**
 * Internal helper to create a notification. Not exposed directly to client.
 * Respects the recipient's per-type opt-out preference.
 */
export async function createNotification(data: {
  userId: string;
  type: string;
  title: string;
  message: string;
  linkUrl?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    if (!(await isTypeEnabled(data.userId, data.type))) return;

    await prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        linkUrl: data.linkUrl,
        metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
      },
    });
  } catch (error) {
    logger.error({ msg: 'Failed to create notification:', err: error });
    // We don't throw here to avoid disrupting the main flow (like course assignment)
  }
}

/**
 * Create notification for all admins of a specific organization, skipping any
 * admin who has opted out of this notification type.
 */
export async function notifyOrganizationAdmins(
  organizationId: string,
  data: {
    type: string;
    title: string;
    message: string;
    linkUrl?: string;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    const admins = await prisma.user.findMany({
      where: {
        organizationId: organizationId,
        role: 'admin',
      },
      select: { id: true },
    });

    if (admins.length === 0) return;

    // Exclude admins who have explicitly opted out of this type.
    const optedOut = await prisma.notificationPreference.findMany({
      where: {
        userId: { in: admins.map((a) => a.id) },
        type: data.type,
        enabled: false,
      },
      select: { userId: true },
    });
    const optedOutIds = new Set(optedOut.map((p) => p.userId));
    const recipients = admins.filter((a) => !optedOutIds.has(a.id));

    if (recipients.length === 0) return;

    await prisma.notification.createMany({
      data: recipients.map((admin) => ({
        userId: admin.id,
        type: data.type,
        title: data.title,
        message: data.message,
        linkUrl: data.linkUrl,
        metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
      })),
    });
  } catch (error) {
    logger.error({ msg: 'Failed to notify admins:', err: error });
  }
}
