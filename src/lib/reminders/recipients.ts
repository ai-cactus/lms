import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { isAdminRole, ADMIN_ROLES } from '@/lib/rbac/role-utils';

/**
 * Escalation recipient resolution.
 *
 * Escalation targets a worker's manager when one is set and that manager is a
 * same-org admin (managers must be admin-role for now — full RBAC is a separate
 * effort). Otherwise it falls back to every admin in the worker's organization,
 * mirroring the query shape in `notifyOrganizationAdmins`.
 */

export interface EscalationRecipients {
  /** In-app notification targets. */
  userIds: string[];
  /** Email targets, with display name when available. */
  emails: { email: string; name: string | null }[];
}

const EMPTY: EscalationRecipients = { userIds: [], emails: [] };

export async function resolveEscalationRecipients(enrollment: {
  userId: string;
}): Promise<EscalationRecipients> {
  const worker = await prisma.user.findUnique({
    where: { id: enrollment.userId },
    select: { id: true, organizationId: true, managerId: true },
  });

  if (!worker?.organizationId) {
    logger.warn({
      msg: '[reminders] Cannot resolve escalation recipients — worker has no organization',
      userId: enrollment.userId,
    });
    return EMPTY;
  }

  // Prefer a directly-assigned manager, but only if they are a same-org admin.
  if (worker.managerId) {
    const manager = await prisma.user.findUnique({
      where: { id: worker.managerId },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        profile: { select: { fullName: true } },
      },
    });

    if (manager && manager.organizationId === worker.organizationId && isAdminRole(manager.role)) {
      return {
        userIds: [manager.id],
        emails: [{ email: manager.email, name: manager.profile?.fullName ?? null }],
      };
    }
  }

  // Fall back to all org admins.
  const admins = await prisma.user.findMany({
    where: { organizationId: worker.organizationId, role: { in: [...ADMIN_ROLES] } },
    select: { id: true, email: true, profile: { select: { fullName: true } } },
  });

  if (admins.length === 0) {
    logger.warn({
      msg: '[reminders] No escalation recipients — no manager and no org admins',
      userId: enrollment.userId,
      orgId: worker.organizationId,
    });
    return EMPTY;
  }

  return {
    userIds: admins.map((a) => a.id),
    emails: admins.map((a) => ({ email: a.email, name: a.profile?.fullName ?? null })),
  };
}
