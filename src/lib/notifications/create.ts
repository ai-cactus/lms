import 'server-only';

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ADMIN_ROLES } from '@/lib/rbac/role-utils';
import {
  isInAppEnabledForMembership,
  isNotificationChannelEnabled,
} from '@/lib/notifications/category-preferences';

// Deliberately NOT a 'use server' module: these take the recipient and content
// from the caller with no session check, so exposing them as Server Actions
// would let anyone write arbitrary notifications into any tenant's inbox.

/** True unless the membership has an explicit opt-out row for this type. */
async function isTypeEnabled(organizationUserId: string, type: string) {
  const pref = await prisma.notificationPreference.findUnique({
    where: { organizationUserId_type: { organizationUserId, type } },
    select: { enabled: true },
  });
  return pref ? pref.enabled : true;
}

/**
 * Create a notification for one membership. Respects both the organization's
 * per-category in-app switch and the recipient's own per-type opt-out.
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
    if (!(await isInAppEnabledForMembership(data.organizationUserId, data.type))) return;
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
 * Create notification for all admins of a specific organization, skipping the
 * whole send when the organization has switched the type's category off in-app,
 * and skipping any admin who has opted out of this notification type.
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
    if (!(await isNotificationChannelEnabled(organizationId, data.type, 'inApp'))) return;

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
