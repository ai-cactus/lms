import 'server-only';

import prisma from '@/lib/prisma';
import { logger, maskEmail } from '@/lib/logger';
import { ADMIN_ROLES } from '@/lib/rbac/role-utils';
import { ORG_WIDE_FACILITY_ROLES } from '@/lib/facility/org-wide-roles';
import { permissionForLink, roleHolds } from '@/lib/notifications/link-audience';
import { isNotificationChannelEnabled } from '@/lib/notifications/category-preferences';
import { createNotification, type AdminNotice } from '@/lib/notifications/create';

// Deliberately NOT a 'use server' module, for the same reason as `create.ts`:
// these take the recipients and content from the caller with no session check.

/** One admin a learner-scoped notice resolved to, with the contact details its email needs. */
export interface LearnerAdminRecipient {
  organizationUserId: string;
  email: string;
}

/**
 * The admins who can see one learner: the org-wide admin tier, plus the
 * facility-bound admins holding an active roster row in a facility where the
 * learner currently holds one (the current-roster rule — never where the
 * learner used to be). Narrowed, as every admin notice is (Q-25), to the
 * members who can open the notice's link, minus anyone who opted out of the
 * type. The learner is never their own audience.
 *
 * Unlike `notifyOrganizationAdmins`, which reaches the whole admin tier, this
 * keeps a supervisor from hearing about a learner in a facility they cannot
 * see. If nobody qualifies the miss is logged: a notice nobody receives must
 * not be silent.
 *
 * The org's per-category channel switches are NOT applied here; the caller
 * applies the switch for each channel it delivers on.
 */
export async function resolveLearnerAdminAudience(
  organizationId: string,
  learnerOrganizationUserId: string,
  notice: Pick<AdminNotice, 'type' | 'linkUrl'>,
): Promise<LearnerAdminRecipient[]> {
  const learnerFacilities = await prisma.organizationUserFacility.findMany({
    where: { organizationUserId: learnerOrganizationUserId, active: true },
    select: { facilityId: true },
  });
  const learnerFacilityIds = learnerFacilities.map((f) => f.facilityId);
  const orgWideAdminRoles = ADMIN_ROLES.filter((role) => ORG_WIDE_FACILITY_ROLES.includes(role));

  const admins = await prisma.organizationUser.findMany({
    where: {
      organizationId,
      active: true,
      id: { not: learnerOrganizationUserId },
      role: { in: [...ADMIN_ROLES] },
      OR: [
        { role: { in: orgWideAdminRoles } },
        { facilities: { some: { active: true, facilityId: { in: learnerFacilityIds } } } },
      ],
    },
    select: { id: true, role: true, user: { select: { email: true } } },
  });

  const permission = permissionForLink(notice.linkUrl);
  const audience = admins.filter((a) => roleHolds(a.role, permission));
  if (audience.length === 0) {
    logger.warn({
      msg: '[notifications] No admin who can see this learner can open the notice — nobody notified',
      orgId: organizationId,
      organizationUserId: learnerOrganizationUserId,
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
  return audience
    .filter((a) => !optedOutIds.has(a.id))
    .map((a) => ({ organizationUserId: a.id, email: a.user.email }));
}

/**
 * Deliver a notice about one learner to the admins who can see them
 * ({@link resolveLearnerAdminAudience}), in-app and by email. Each leg honours
 * the org's switch for its own channel; the in-app leg goes through
 * `createNotification`, so it applies the same checks as every other notice.
 * The emails are awaited — a fire-and-forget send can be cut off when the
 * request that triggered it ends. Never throws; each failure is logged.
 */
export async function notifyLearnerAdmins(
  organizationId: string,
  learnerOrganizationUserId: string,
  notice: AdminNotice,
  sendEmail: (recipient: LearnerAdminRecipient) => Promise<{ success: boolean }>,
): Promise<void> {
  try {
    const audience = await resolveLearnerAdminAudience(
      organizationId,
      learnerOrganizationUserId,
      notice,
    );
    if (audience.length === 0) return;

    const [inAppEnabled, emailEnabled] = await Promise.all([
      isNotificationChannelEnabled(organizationId, notice.type, 'inApp'),
      isNotificationChannelEnabled(organizationId, notice.type, 'email'),
    ]);

    if (inAppEnabled) {
      await Promise.all(
        audience.map((admin) =>
          createNotification({ organizationUserId: admin.organizationUserId, ...notice }),
        ),
      );
    }

    if (!emailEnabled) return;
    await Promise.all(
      audience.map(async (admin) => {
        try {
          const result = await sendEmail(admin);
          if (!result.success) {
            logger.error({
              msg: '[notifications] Failed to email a learner notice to an admin',
              orgId: organizationId,
              type: notice.type,
              organizationUserId: admin.organizationUserId,
            });
          }
        } catch (err) {
          logger.error({
            msg: '[notifications] Learner notice email threw',
            orgId: organizationId,
            type: notice.type,
            email: maskEmail(admin.email),
            err,
          });
        }
      }),
    );
  } catch (error) {
    logger.error({
      msg: '[notifications] Failed to notify the admins who can see a learner',
      orgId: organizationId,
      type: notice.type,
      err: error,
    });
  }
}
