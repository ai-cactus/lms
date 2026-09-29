import 'server-only';

import prisma from '@/lib/prisma';
import { logger, maskEmail } from '@/lib/logger';
import { ADMIN_ROLES } from '@/lib/rbac/role-utils';
import { permissionForLink, roleHolds } from '@/lib/notifications/link-audience';
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

export interface AdminNotice {
  type: string;
  title: string;
  message: string;
  linkUrl?: string;
  metadata?: Record<string, unknown>;
}

/** One admin an admin-tier notice resolved to, with the contact details its email needs. */
export interface AdminNoticeRecipient {
  organizationUserId: string;
  email: string;
}

/**
 * The admins who should hear about a notice: the active admin tier, narrowed
 * to the members who can open its link, minus anyone who opted out of the type.
 *
 * "Can open its link" is Q-25: a `/dashboard/staff/{id}` notice goes only to
 * holders of `user.read`, a Status Tracker one only to holders of
 * `assignment.read` (see `link-audience.ts`). If that leaves nobody, the miss is
 * logged — a notice nobody receives must not be silent.
 *
 * The org's per-category channel switches are NOT applied here; each caller
 * applies the switch for the channel it delivers on.
 */
async function resolveAdminNoticeAudience(
  organizationId: string,
  notice: Pick<AdminNotice, 'type' | 'linkUrl'>,
) {
  const admins = await prisma.organizationUser.findMany({
    where: {
      organizationId,
      active: true,
      role: { in: [...ADMIN_ROLES] },
    },
    select: { id: true, role: true, user: { select: { email: true } } },
  });

  const permission = permissionForLink(notice.linkUrl);
  const audience = admins.filter((a) => roleHolds(a.role, permission));
  if (audience.length === 0) {
    logger.warn({
      msg: '[notifications] No admin can open this notice — nobody notified',
      orgId: organizationId,
      type: notice.type,
      requiredPermission: permission,
      adminCount: admins.length,
    });
    return [];
  }

  const optedOut = await prisma.notificationPreference.findMany({
    where: {
      organizationUserId: { in: audience.map((a) => a.id) },
      type: notice.type,
      enabled: false,
    },
    select: { organizationUserId: true },
  });
  const optedOutIds = new Set(optedOut.map((p) => p.organizationUserId));
  return audience.filter((a) => !optedOutIds.has(a.id));
}

async function writeAdminNotices(recipientIds: string[], notice: AdminNotice) {
  if (recipientIds.length === 0) return;

  await prisma.notification.createMany({
    data: recipientIds.map((organizationUserId) => ({
      organizationUserId,
      type: notice.type,
      title: notice.title,
      message: notice.message,
      linkUrl: notice.linkUrl,
      metadata: notice.metadata ? JSON.parse(JSON.stringify(notice.metadata)) : undefined,
    })),
  });
}

/**
 * Create notification for the admins of a specific organization who can open
 * its link, skipping the whole send when the organization has switched the
 * type's category off in-app, and skipping any admin who has opted out of this
 * notification type. See {@link resolveAdminNoticeAudience} for the audience.
 */
export async function notifyOrganizationAdmins(organizationId: string, data: AdminNotice) {
  try {
    if (!(await isNotificationChannelEnabled(organizationId, data.type, 'inApp'))) return;

    const recipients = await resolveAdminNoticeAudience(organizationId, data);
    await writeAdminNotices(
      recipients.map((admin) => admin.id),
      data,
    );
  } catch (error) {
    logger.error({ msg: 'Failed to notify admins:', err: error });
  }
}

/**
 * {@link notifyOrganizationAdmins} for a notice that is also emailed. Both legs
 * reach the same audience, so an admin who opted out of the type or cannot
 * open the link gets neither; the in-app leg alone honours the org's in-app
 * category switch. The emails are awaited — a fire-and-forget send can be cut
 * off when the request that triggered it ends. Never throws; each failed send
 * is logged.
 */
export async function notifyOrganizationAdminsWithEmail(
  organizationId: string,
  data: AdminNotice,
  sendEmail: (recipient: AdminNoticeRecipient) => Promise<{ success: boolean }>,
): Promise<void> {
  try {
    const audience = await resolveAdminNoticeAudience(organizationId, data);
    if (audience.length === 0) return;

    if (await isNotificationChannelEnabled(organizationId, data.type, 'inApp')) {
      await writeAdminNotices(
        audience.map((admin) => admin.id),
        data,
      );
    }

    await Promise.all(
      audience.map(async (admin) => {
        const recipient = { organizationUserId: admin.id, email: admin.user.email };
        try {
          const result = await sendEmail(recipient);
          if (!result.success) {
            logger.error({
              msg: '[notifications] Failed to email an admin notice',
              orgId: organizationId,
              type: data.type,
              organizationUserId: admin.id,
            });
          }
        } catch (err) {
          logger.error({
            msg: '[notifications] Admin notice email threw',
            orgId: organizationId,
            type: data.type,
            email: maskEmail(recipient.email),
            err,
          });
        }
      }),
    );
  } catch (error) {
    logger.error({
      msg: '[notifications] Failed to notify admins',
      orgId: organizationId,
      type: data.type,
      err: error,
    });
  }
}
