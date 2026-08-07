'use server';

import prisma from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { logger } from '@/lib/logger';
import { ADMIN_ROLES } from '@/lib/rbac/role-utils';

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

/** True unless the membership has an explicit opt-out row for this type. */
async function isTypeEnabled(organizationUserId: string, type: string) {
  const pref = await prisma.notificationPreference.findUnique({
    where: { organizationUserId_type: { organizationUserId, type } },
    select: { enabled: true },
  });
  return pref ? pref.enabled : true;
}

/**
 * Internal helper to create a notification. Not exposed directly to client.
 * Respects the recipient's per-type opt-out preference.
 */
export async function createNotification(data: {
  /** The membership that receives it — notifications are per-org, not per-identity. */
  organizationUserId: string;
  type: string;
  title: string;
  message: string;
  linkUrl?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    if (!(await isTypeEnabled(data.organizationUserId, data.type))) return;

    await prisma.notification.create({
      data: {
        organizationUserId: data.organizationUserId,
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
    const admins = await prisma.organizationUser.findMany({
      where: {
        organizationId,
        active: true,
        role: { in: [...ADMIN_ROLES] },
      },
      select: { id: true },
    });

    if (admins.length === 0) return;

    // Exclude admins who have explicitly opted out of this type.
    const optedOut = await prisma.notificationPreference.findMany({
      where: {
        organizationUserId: { in: admins.map((a) => a.id) },
        type: data.type,
        enabled: false,
      },
      select: { organizationUserId: true },
    });
    const optedOutIds = new Set(optedOut.map((p) => p.organizationUserId));
    const recipients = admins.filter((a) => !optedOutIds.has(a.id));

    if (recipients.length === 0) return;

    await prisma.notification.createMany({
      data: recipients.map((admin) => ({
        organizationUserId: admin.id,
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
