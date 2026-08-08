import prisma from '@/lib/prisma';
import { logger, maskEmail } from '@/lib/logger';
import type { Role } from '@/types/next-auth';

/**
 * Role-targeted recipient resolution for the notification engine.
 *
 * A system event names the *role* it concerns (HR, clinical/quality director,
 * owner) rather than a specific person. This resolves those roles to the users
 * holding them inside one organization and, when nobody holds the role, applies
 * the escalation pathway from the product notes: redirect to the organization
 * owner.
 *
 * Distinct from `src/lib/reminders/recipients.ts`, which resolves a *worker's*
 * escalation chain (assigned manager first, then all admins).
 */

export interface RoleRecipientOptions {
  /** Redirect to the organization owner when no user holds any target role. */
  fallbackToOwner?: boolean;
  /** Identities never to notify — typically the actor who caused the event. */
  excludeUserIds?: (string | null | undefined)[];
}

export interface RoleRecipients {
  /** In-app notification targets — `OrganizationUser.id` (createNotification's key). */
  organizationUserIds: string[];
  /** Email targets, with display name when available. */
  emails: {
    /** The membership `createNotification` etc. key off. */
    organizationUserId: string;
    /** The underlying global identity — used to match against actor/subject ids. */
    userId: string;
    email: string;
    name: string | null;
  }[];
  /** True when the owner was substituted for an unassigned target role. */
  usedFallback: boolean;
  /** Target roles no user in the organization holds. */
  missingRoles: Role[];
}

const EMPTY: RoleRecipients = {
  organizationUserIds: [],
  emails: [],
  usedFallback: false,
  missingRoles: [],
};

interface RecipientRow {
  id: string;
  userId: string;
  role: Role;
  user: { email: string; fullName: string | null };
}

const RECIPIENT_SELECT = {
  id: true,
  userId: true,
  role: true,
  user: { select: { email: true, fullName: true } },
} as const;

function toRecipients(
  rows: RecipientRow[],
  usedFallback: boolean,
  missingRoles: Role[],
): RoleRecipients {
  return {
    organizationUserIds: rows.map((r) => r.id),
    emails: rows.map((r) => ({
      organizationUserId: r.id,
      userId: r.userId,
      email: r.user.email,
      name: r.user.fullName,
    })),
    usedFallback,
    missingRoles,
  };
}

/**
 * Resolve the users to notify for an event targeting `targetRoles` inside
 * `organizationId`.
 *
 * One organization is expected to have exactly one owner, but that is a
 * convention rather than a DB constraint — so the fallback picks the *oldest*
 * owner deterministically (createdAt, then id) instead of fanning out to all of
 * them. An organization with no owner at all is a data-integrity problem: it is
 * logged at error level and resolves to no recipients rather than silently
 * broadening the audience.
 */
export async function resolveRoleRecipients(
  organizationId: string,
  targetRoles: Role[],
  options: RoleRecipientOptions = {},
): Promise<RoleRecipients> {
  if (!organizationId || targetRoles.length === 0) return EMPTY;

  const excluded = new Set(options.excludeUserIds?.filter((id): id is string => Boolean(id)) ?? []);

  const holders = await prisma.organizationUser.findMany({
    where: { organizationId, role: { in: targetRoles }, active: true },
    select: RECIPIENT_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const heldRoles = new Set(holders.map((h) => h.role));
  const missingRoles = targetRoles.filter((role) => !heldRoles.has(role));

  // Exclusion is applied after the role-coverage check on purpose: an event the
  // actor authored themselves is "covered" by their role, so excluding them must
  // not masquerade as an unassigned role and trigger an owner fallback. Matched
  // on the underlying identity (userId), not the membership row, since the
  // actor is identified by their global User id.
  const eligible = holders.filter((h) => !excluded.has(h.userId));

  if (holders.length > 0) {
    return toRecipients(eligible, false, missingRoles);
  }

  if (!options.fallbackToOwner) {
    logger.info({
      msg: '[notifications] No role holders and no owner fallback — nobody to notify',
      orgId: organizationId,
      targetRoles,
    });
    return { ...EMPTY, missingRoles };
  }

  const owner = await prisma.organizationUser.findFirst({
    where: { organizationId, role: 'owner', active: true },
    select: RECIPIENT_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  if (!owner) {
    logger.error({
      msg: '[notifications] Escalation dead end — organization has no owner to fall back to',
      orgId: organizationId,
      targetRoles,
    });
    return { ...EMPTY, missingRoles };
  }

  logger.info({
    msg: '[notifications] Target role unassigned — escalating to organization owner',
    orgId: organizationId,
    targetRoles,
    missingRoles,
    ownerEmail: maskEmail(owner.user.email),
  });

  const ownerRows = excluded.has(owner.userId) ? [] : [owner];
  return toRecipients(ownerRows, true, missingRoles);
}
