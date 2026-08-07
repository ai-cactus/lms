import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { isAdminRole, ADMIN_ROLES } from '@/lib/rbac/role-utils';

/**
 * Escalation recipient resolution.
 *
 * Escalation targets a worker's manager when one is set and that manager is a
 * same-org admin. Otherwise it falls back to every admin in the worker's
 * organization, mirroring the query shape in `notifyOrganizationAdmins`.
 *
 * This is the *per-worker* chain (manager first, then all admins). Events that
 * target a specific role instead — HR, clinical/quality director — resolve
 * through `resolveRoleRecipients` in `src/lib/notifications/recipients.ts`,
 * which owns the owner-fallback escalation pathway.
 */

export interface EscalationRecipients {
  /** In-app notification targets — `OrganizationUser.id` (createNotification's key). */
  organizationUserIds: string[];
  /** Email targets, with display name when available. */
  emails: { email: string; name: string | null }[];
}

const EMPTY: EscalationRecipients = { organizationUserIds: [], emails: [] };

export async function resolveEscalationRecipients(enrollment: {
  organizationUserId: string;
}): Promise<EscalationRecipients> {
  const worker = await prisma.organizationUser.findUnique({
    where: { id: enrollment.organizationUserId },
    select: { organizationId: true, managerId: true },
  });

  if (!worker) {
    logger.warn({
      msg: '[reminders] Cannot resolve escalation recipients — membership not found',
      organizationUserId: enrollment.organizationUserId,
    });
    return EMPTY;
  }

  // Prefer a directly-assigned manager, but only if they are an active same-org admin.
  if (worker.managerId) {
    const manager = await prisma.organizationUser.findUnique({
      where: { id: worker.managerId },
      select: {
        id: true,
        role: true,
        organizationId: true,
        active: true,
        user: { select: { email: true, fullName: true } },
      },
    });

    if (
      manager &&
      manager.active &&
      manager.organizationId === worker.organizationId &&
      isAdminRole(manager.role)
    ) {
      return {
        organizationUserIds: [manager.id],
        emails: [{ email: manager.user.email, name: manager.user.fullName }],
      };
    }
  }

  const admins = await prisma.organizationUser.findMany({
    where: { organizationId: worker.organizationId, active: true, role: { in: [...ADMIN_ROLES] } },
    select: { id: true, user: { select: { email: true, fullName: true } } },
  });

  if (admins.length === 0) {
    logger.warn({
      msg: '[reminders] No escalation recipients — no manager and no org admins',
      organizationUserId: enrollment.organizationUserId,
      orgId: worker.organizationId,
    });
    return EMPTY;
  }

  return {
    organizationUserIds: admins.map((a) => a.id),
    emails: admins.map((a) => ({ email: a.user.email, name: a.user.fullName })),
  };
}
