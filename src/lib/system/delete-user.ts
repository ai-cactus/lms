/**
 * The ONE way to delete a user (Q-23, ruled 2026-09-28): a soft delete that
 * revokes the person's access everywhere and keeps their compliance records.
 *
 * Both the /system console (`deleteUserWithRelations`) and the ops scripts
 * (`scripts/delete-user.ts`, `scripts/delete-workers.ts`) call this, so there is
 * no second, destructive path (RISK-14).
 *
 * What it does, in one transaction:
 *  - refuses, changing nothing, when an organization the person is active in
 *    would be left with no active owner or no active member at all (Q-30);
 *  - stamps `User.deletedAt` and bumps `sessionVersion` (every live session dies
 *    on its next JWT decode);
 *  - deactivates EVERY membership, in every organization — the same state
 *    `removeStaff` leaves one membership in, so every roster, picker, seat count
 *    and reminder audience that already drops removed staff drops this person
 *    too;
 *  - expires pending invites to this email, but only those issued by
 *    organizations the person belonged to (BUG-26: another tenant's invite is
 *    not this delete's business — and the sign-in guards make it un-acceptable
 *    anyway);
 *  - revokes outstanding verification/password-reset tokens for the email;
 *  - writes the `system.user.delete` audit row.
 *
 * What it deliberately does NOT do: delete or reassign anything else.
 * Enrollments, quiz attempts, certificates, notifications and authored
 * courses/documents all keep pointing at the (now deactivated) membership, so
 * audit reads such as `enrollment.organizationUser.user.fullName` keep working.
 *
 * The email is NOT freed: `User.email` is unique and the row stays, so signup,
 * invite accept and OAuth all refuse it rather than creating a second identity.
 * Restoring a deleted identity is out of scope.
 */
import prisma from '@/lib/prisma';
import type { DbTransactionClient } from '@/db/index';
import { auditCritical, type AuditEntry } from '@/lib/audit';
import { invalidateRevalidationCache } from '@/lib/auth/session-revalidation-cache';
import { logger } from '@/lib/logger';
import { lockOrganizations } from '@/lib/organization/owner-guard';

/** Who is deleting, for the audit row. Never an email or a name. */
export type SoftDeleteActor = Pick<AuditEntry, 'actorId' | 'actorRole' | 'ip' | 'userAgent'>;

/** An organization the delete would leave without an owner or without anyone (Q-30). */
export interface OwnershipBlock {
  organizationId: string;
  organizationName: string;
  reason: 'sole_owner' | 'last_member';
}

export type SoftDeleteUserResult =
  | {
      status: 'deleted';
      deletedAt: Date;
      membershipsDeactivated: number;
      invitesExpired: number;
      verificationTokensRevoked: number;
    }
  | { status: 'not_found' }
  | { status: 'already_deleted'; deletedAt: Date }
  | { status: 'blocked'; blocks: OwnershipBlock[]; message: string };

type MembershipReader = Pick<DbTransactionClient, 'organizationUser'>;

/**
 * Q-30 (ruled 2026-09-29): which of the person's organizations the delete would
 * orphan. Only organizations where the person is ACTIVE count — deleting them
 * cannot take away an owner an org has already lost some other way. A
 * soft-deleted organization never blocks: it has no access left to orphan, and
 * its restore already refuses to bring it back without an active owner.
 */
export async function findOwnershipBlocks(
  client: MembershipReader,
  userId: string,
): Promise<OwnershipBlock[]> {
  const memberships = await client.organizationUser.findMany({
    where: { userId, active: true, organization: { deletedAt: null } },
    select: { organizationId: true, role: true, organization: { select: { name: true } } },
    orderBy: { joinedAt: 'asc' },
  });

  const blocks: OwnershipBlock[] = [];
  for (const membership of memberships) {
    const othersWhere = {
      organizationId: membership.organizationId,
      active: true,
      userId: { not: userId },
    };
    const otherMembers = await client.organizationUser.count({ where: othersWhere });
    const otherOwners =
      membership.role === 'owner' && otherMembers > 0
        ? await client.organizationUser.count({ where: { ...othersWhere, role: 'owner' } })
        : null;

    const reason =
      otherMembers === 0 ? 'last_member' : otherOwners === 0 ? 'sole_owner' : undefined;
    if (reason) {
      blocks.push({
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        reason,
      });
    }
  }
  return blocks;
}

/** The refusal shown to whoever asked for the delete, naming every blocked organization. */
export function describeOwnershipBlocks(blocks: readonly OwnershipBlock[]): string {
  return blocks
    .map((block) =>
      block.reason === 'sole_owner'
        ? `Transfer ownership of ${block.organizationName} before deleting this user.`
        : `${block.organizationName} has no other active member. Add an owner there before deleting this user.`,
    )
    .join(' ');
}

export async function softDeleteUser(
  userId: string,
  actor: SoftDeleteActor,
): Promise<SoftDeleteUserResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, deletedAt: true },
  });

  if (!user) return { status: 'not_found' };
  if (user.deletedAt) return { status: 'already_deleted', deletedAt: user.deletedAt };

  const deletedAt = new Date();

  const outcome = await prisma.$transaction(async (tx) => {
    const memberships = await tx.organizationUser.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    const memberOrganizationIds = [...new Set(memberships.map((m) => m.organizationId))];

    // Lock the person's organizations before the Q-30 check, so two co-owners
    // deleted at the same moment — or a delete racing a demotion that takes the
    // same lock (RISK-16) — are serialised: the second sees the first's write
    // and is refused instead of both passing and orphaning the org.
    await lockOrganizations(tx, memberOrganizationIds);

    const blocks = await findOwnershipBlocks(tx, userId);
    if (blocks.length > 0) return { kind: 'blocked' as const, blocks };

    // Guarded on `deletedAt: null` so two concurrent deletes cannot both
    // succeed and double-audit: the loser matches no row.
    const stamped = await tx.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: { deletedAt, sessionVersion: { increment: 1 } },
    });
    if (stamped.count === 0) return { kind: 'raced' as const };

    const deactivated = await tx.organizationUser.updateMany({
      where: { userId, active: true },
      data: { active: false, deactivatedAt: deletedAt },
    });

    const expiredInvites =
      memberOrganizationIds.length > 0
        ? await tx.invite.updateMany({
            where: {
              email: { equals: user.email, mode: 'insensitive' },
              organizationId: { in: memberOrganizationIds },
              status: 'pending',
            },
            data: { status: 'expired' },
          })
        : { count: 0 };

    const revokedTokens = await tx.verificationToken.deleteMany({
      where: { identifier: user.email },
    });

    const counts = {
      membershipsDeactivated: deactivated.count,
      invitesExpired: expiredInvites.count,
      verificationTokensRevoked: revokedTokens.count,
    };

    // Inside the transaction so the delete and its record commit together: a
    // person can never lose their access without the trail saying so. Counts
    // only — no email, no names — because the audit row is long-lived.
    await auditCritical(
      {
        action: 'system.user.delete',
        targetType: 'user',
        targetId: userId,
        metadata: { mode: 'soft', ...counts },
        ...actor,
      },
      tx,
    );

    return { kind: 'deleted' as const, counts };
  });

  if (outcome.kind === 'blocked') {
    logger.warn({
      msg: '[system] User delete refused: would leave an organization without an owner',
      userId,
      orgIds: outcome.blocks.map((block) => block.organizationId),
      reasons: outcome.blocks.map((block) => block.reason),
    });
    return {
      status: 'blocked',
      blocks: outcome.blocks,
      message: describeOwnershipBlocks(outcome.blocks),
    };
  }

  if (outcome.kind === 'raced') {
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });
    return current?.deletedAt
      ? { status: 'already_deleted', deletedAt: current.deletedAt }
      : { status: 'not_found' };
  }

  // After commit: evict the cached revalidation snapshot so the next decode
  // reads the bumped sessionVersion instead of waiting out the Redis TTL.
  await invalidateRevalidationCache(userId);

  logger.info({ msg: '[system] User soft-deleted', userId, ...outcome.counts });

  return { status: 'deleted', deletedAt, ...outcome.counts };
}
