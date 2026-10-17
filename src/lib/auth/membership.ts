/**
 * Membership resolution — the seam between a global `User` identity and the
 * per-organization `OrganizationUser` row that actually carries role, facility
 * scope and org-scoped data ownership.
 *
 * Every authenticated request operates inside exactly ONE active membership.
 * The session carries `organizationUserId` + `organizationId` + `role`, all
 * three resolved from the SAME `OrganizationUser` row by the helpers here, so a
 * role claim can never be paired with a foreign organization.
 */
import { Prisma } from '@/generated/prisma/client';
import prisma from '@/lib/prisma';
import type { DbTransactionClient } from '@/db/index';
import { logger } from '@/lib/logger';
import { DeletedIdentityError, isDeletedIdentity } from '@/lib/auth/deleted-identity';
import {
  LastOwnerError,
  lockOrganizations,
  wouldLeaveOrganizationOwnerless,
} from '@/lib/organization/owner-guard';
import type { Role } from '@/types/next-auth';

export interface MembershipSummary {
  organizationUserId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: Role;
}

/**
 * How login (or an org switch) resolved a user's memberships.
 *
 * - `none`     — the identity has never joined an organization; it is a
 *                prospective founder and belongs in onboarding.
 * - `revoked`  — memberships exist but every one is deactivated; access to
 *                every organization has been removed, so login must be denied.
 * - `org_deleted` — no live membership remains, and at least one membership
 *                was lost to an organization soft delete (it was active when the
 *                org was deleted). Login is denied with the org-specific copy.
 * - `resolved` — exactly one candidate, or a remembered org that is still
 *                valid: sign straight in with no picker.
 * - `choice`   — two or more active memberships and no usable preference: the
 *                caller must present the org picker.
 */
export type MembershipResolution =
  | { kind: 'none' }
  | { kind: 'revoked' }
  | { kind: 'org_deleted' }
  | { kind: 'resolved'; membership: MembershipSummary }
  | { kind: 'choice'; memberships: MembershipSummary[] };

const MEMBERSHIP_SELECT = {
  id: true,
  role: true,
  organizationId: true,
  organization: { select: { name: true, slug: true } },
} as const;

interface MembershipRow {
  id: string;
  role: Role;
  organizationId: string;
  organization: { name: string; slug: string };
}

function toSummary(row: MembershipRow): MembershipSummary {
  return {
    organizationUserId: row.id,
    organizationId: row.organizationId,
    organizationName: row.organization.name,
    organizationSlug: row.organization.slug,
    role: row.role,
  };
}

/**
 * Every ACTIVE membership in a live (not soft-deleted) organization for an
 * identity, oldest join first (stable order).
 */
export async function listActiveMemberships(userId: string): Promise<MembershipSummary[]> {
  const rows = await prisma.organizationUser.findMany({
    where: { userId, active: true, organization: { deletedAt: null } },
    select: MEMBERSHIP_SELECT,
    orderBy: { joinedAt: 'asc' },
  });
  return rows.map(toSummary);
}

/**
 * Load a single ACTIVE membership by (user, organization). Returns null when the
 * user is not a member of that org, the membership is deactivated, or the org
 * is soft-deleted — the authorization check behind every org switch and every
 * JWT re-validation, which is what ends a deleted org's live sessions.
 */
export async function getActiveMembership(
  userId: string,
  organizationId: string,
): Promise<MembershipSummary | null> {
  const row = await prisma.organizationUser.findFirst({
    where: { userId, organizationId, active: true, organization: { deletedAt: null } },
    select: MEMBERSHIP_SELECT,
  });
  return row ? toSummary(row) : null;
}

/**
 * Decide which membership a sign-in should activate.
 *
 * Zero-regression requirement: a user with exactly ONE active membership — the
 * shape every single-org account has today — always resolves silently, so they
 * never see a picker. A returning multi-org user skips the picker only while
 * `User.lastActiveOrganizationId` still names an active membership.
 */
export async function resolveActiveMembership(userId: string): Promise<MembershipResolution> {
  const [user, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { lastActiveOrganizationId: true },
    }),
    listActiveMemberships(userId),
  ]);

  if (memberships.length === 0) {
    // Distinguish "never joined" (a founder heading to onboarding) from "every
    // membership revoked" (access removed) — the two must not share a fate.
    const revokedCount = await prisma.organizationUser.count({ where: { userId } });
    if (revokedCount === 0) return { kind: 'none' };
    return (await lostAccessToOrganizationDelete(userId))
      ? { kind: 'org_deleted' }
      : { kind: 'revoked' };
  }

  if (memberships.length === 1) {
    return { kind: 'resolved', membership: memberships[0] };
  }

  const remembered = user?.lastActiveOrganizationId
    ? memberships.find((m) => m.organizationId === user.lastActiveOrganizationId)
    : undefined;

  return remembered
    ? { kind: 'resolved', membership: remembered }
    : { kind: 'choice', memberships };
}

/**
 * True when one of the identity's memberships was taken away by an
 * organization soft delete, rather than by an administrator removing the
 * person: it is still flagged active, or it was deactivated at the org's exact
 * `deletedAt` instant (the delete writes both from one Date).
 */
async function lostAccessToOrganizationDelete(userId: string): Promise<boolean> {
  const inDeletedOrgs = await prisma.organizationUser.findMany({
    where: { userId, organization: { deletedAt: { not: null } } },
    select: { active: true, deactivatedAt: true, organization: { select: { deletedAt: true } } },
  });
  return inDeletedOrgs.some(
    (membership) =>
      membership.active ||
      membership.deactivatedAt?.getTime() === membership.organization.deletedAt?.getTime(),
  );
}

/**
 * Pick the membership a resolution activates. On `choice` the org picker lets
 * the user switch afterwards, but the session must always be scoped to a real
 * membership, so the first (oldest-joined, deterministic) one is provisionally
 * activated rather than leaving the session org-less.
 */
export function activeMembershipOf(resolution: MembershipResolution): MembershipSummary | null {
  switch (resolution.kind) {
    case 'resolved':
      return resolution.membership;
    case 'choice':
      return resolution.memberships[0];
    case 'none':
    case 'revoked':
    case 'org_deleted':
      return null;
    default: {
      const unhandled: never = resolution;
      return unhandled;
    }
  }
}

/**
 * Resolve the membership an ALREADY-ACTIVE session should render as.
 *
 * The distinction from {@link resolveActiveMembership} is deliberate: once a
 * session carries an `organizationId` on its JWT, that org is authoritative for
 * this session and must be honoured with a POINT lookup. Re-deriving via the
 * global resolver would consult `User.lastActiveOrganizationId`, which a sibling
 * session's login or a later org switch may have moved — silently bleeding a
 * multi-org user's view into a different organization than their token names.
 *
 * Only a genuinely org-less token (pre-onboarding, or just-joined and not yet
 * re-minted) falls back to the global resolver, adopting its active pick.
 */
export async function resolveMembershipForActiveSession(
  userId: string,
  sessionOrganizationId: string | null,
): Promise<MembershipSummary | null> {
  if (sessionOrganizationId) {
    return getActiveMembership(userId, sessionOrganizationId);
  }
  const resolution = await resolveActiveMembership(userId);
  return activeMembershipOf(resolution);
}

export interface CreateMembershipInput {
  userId: string;
  organizationId: string;
  /** The facility this membership is assigned to on joining. */
  facilityId: string;
  role: Role;
  /**
   * What to do when the identity already has a membership in the organization.
   * `reassign` (the default) reactivates and re-roles it — the invite and
   * onboarding paths, where an administrator chose the role. `refuse` writes
   * nothing and throws {@link ExistingMembershipError} — the self-serve join
   * code, which must never change the role of, or restore access to, an
   * existing member (BUG-59).
   */
  onExisting?: 'reassign' | 'refuse';
}

/**
 * Thrown by `createMembership({ onExisting: 'refuse' })` when the identity
 * already has a membership in the organization. `active` distinguishes a
 * current member from one whose access was revoked, so the caller can explain
 * which it is.
 */
export class ExistingMembershipError extends Error {
  constructor(readonly active: boolean) {
    super(
      active
        ? 'Already a member of this organization.'
        : 'Membership in this organization was deactivated.',
    );
    this.name = 'ExistingMembershipError';
  }
}

/**
 * Thrown by `createMembership` when the organization is soft-deleted. Every
 * caller answers it with the same generic "no longer valid" response it gives a
 * missing invite or code, so a deleted organization's name is never revealed.
 */
export class DeletedOrganizationError extends Error {
  constructor() {
    super('This organization is no longer active.');
    this.name = 'DeletedOrganizationError';
  }
}

/**
 * Attach an identity to an organization: the `OrganizationUser` row plus its
 * first `OrganizationUserFacility` assignment, created atomically so a
 * membership can never exist without facility scope.
 *
 * By default re-joining is idempotent — an existing (possibly deactivated)
 * membership is reactivated and re-roled rather than duplicated, which the
 * `(userId, organizationId)` unique constraint would reject anyway. With
 * `onExisting: 'refuse'` an existing membership is left untouched instead.
 *
 * @throws {DeletedIdentityError} for a deleted identity (Q-23): reactivating
 * one of its memberships would silently undo the delete.
 * @throws {DeletedOrganizationError} when the organization is soft-deleted:
 * joining (or reactivating a membership in) it would reopen a deleted org.
 * @throws {LastOwnerError} when re-roling an existing membership would demote
 * the organization's last active owner (RISK-16).
 * @throws {ExistingMembershipError} with `onExisting: 'refuse'` when a
 * membership (active or deactivated) already exists.
 *
 * Pass `client` to run inside the caller's transaction, so the membership
 * commits (or rolls back) together with the caller's own writes — and the
 * organization lock taken here is the one the caller already holds.
 */
export async function createMembership(
  input: CreateMembershipInput,
  client?: DbTransactionClient,
): Promise<MembershipSummary> {
  const { userId, organizationId, facilityId, role, onExisting = 'reassign' } = input;

  const attach = async (tx: DbTransactionClient): Promise<MembershipSummary> => {
    const identity = await tx.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });
    if (isDeletedIdentity(identity)) {
      logger.warn({
        msg: '[auth] Refused to attach a deleted identity to an organization',
        userId,
        organizationId,
      });
      throw new DeletedIdentityError();
    }

    // Under the lock the organization soft delete takes, so a join racing the
    // delete either lands before it (and is deactivated by it) or sees it.
    await lockOrganizations(tx, [organizationId]);
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { deletedAt: true },
    });
    if (organization?.deletedAt) {
      logger.warn({
        msg: '[auth] Refused to attach an identity to a deleted organization',
        userId,
        organizationId,
      });
      throw new DeletedOrganizationError();
    }

    if (onExisting === 'refuse') {
      const existing = await tx.organizationUser.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        select: { active: true },
      });
      if (existing) {
        throw new ExistingMembershipError(existing.active);
      }

      let created: MembershipRow;
      try {
        created = await tx.organizationUser.create({
          data: { userId, organizationId, role },
          select: MEMBERSHIP_SELECT,
        });
      } catch (err) {
        // A concurrent join or invite created the row after the read above.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ExistingMembershipError(true);
        }
        throw err;
      }
      await tx.organizationUserFacility.create({
        data: { organizationUserId: created.id, facilityId },
      });
      return toSummary(created);
    }

    // RISK-16: re-roling an active owner (an invite accepted in a race with its
    // own guard) is a demotion, so it re-reads under the organization lock
    // taken above (the one a user delete takes) — otherwise the two could each
    // see the other owner and leave the org with none.
    if (role !== 'owner') {
      const whereMembership = { userId_organizationId: { userId, organizationId } };
      const ownerSelect = { id: true, organizationId: true, role: true, active: true } as const;
      const existing = await tx.organizationUser.findUnique({
        where: whereMembership,
        select: ownerSelect,
      });
      if (existing?.role === 'owner' && existing.active) {
        const current = await tx.organizationUser.findUnique({
          where: whereMembership,
          select: ownerSelect,
        });
        if (current && (await wouldLeaveOrganizationOwnerless(tx, current))) {
          logger.warn({
            msg: '[auth] Refused to re-role the last active owner of an organization',
            userId,
            organizationId,
            requestedRole: role,
          });
          throw new LastOwnerError();
        }
      }
    }

    const membership = await tx.organizationUser.upsert({
      where: { userId_organizationId: { userId, organizationId } },
      create: { userId, organizationId, role },
      update: {
        role,
        active: true,
        deactivatedAt: null,
        // Re-joining restarts the deadline window for role-target assignments.
        roleAssignedAt: new Date(),
      },
      select: MEMBERSHIP_SELECT,
    });

    await tx.organizationUserFacility.upsert({
      where: {
        organizationUserId_facilityId: { organizationUserId: membership.id, facilityId },
      },
      create: { organizationUserId: membership.id, facilityId },
      update: { active: true, deactivatedAt: null },
    });

    return toSummary(membership);
  };

  return client ? attach(client) : prisma.$transaction(attach);
}

/**
 * Stamp the per-org login timestamp and remember the org for picker-skip.
 *
 * Fire-and-forget and fully guarded: a failure here must never break the auth
 * path, so it is logged at `warn` and swallowed rather than propagated.
 */
export function recordMembershipLogin(userId: string, membership: MembershipSummary): void {
  Promise.all([
    prisma.organizationUser.update({
      where: { id: membership.organizationUserId },
      data: { lastLoginAt: new Date() },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { lastActiveOrganizationId: membership.organizationId },
    }),
  ]).catch((err) => {
    logger.warn({
      msg: '[auth] Failed to record membership login',
      userId,
      organizationId: membership.organizationId,
      err,
    });
  });
}
