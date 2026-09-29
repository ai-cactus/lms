/**
 * The ONE way to delete a user (Q-23, ruled 2026-09-28): a soft delete that
 * revokes the person's access everywhere and keeps their compliance records.
 *
 * Both the /system console (`deleteUserWithRelations`) and the ops scripts
 * (`scripts/delete-user.ts`, `scripts/delete-workers.ts`) call this, so there is
 * no second, destructive path (RISK-14).
 *
 * What it does, in one transaction:
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
import { auditCritical, type AuditEntry } from '@/lib/audit';
import { invalidateRevalidationCache } from '@/lib/auth/session-revalidation-cache';
import { logger } from '@/lib/logger';

/** Who is deleting, for the audit row. Never an email or a name. */
export type SoftDeleteActor = Pick<AuditEntry, 'actorId' | 'actorRole' | 'ip' | 'userAgent'>;

export type SoftDeleteUserResult =
  | {
      status: 'deleted';
      deletedAt: Date;
      membershipsDeactivated: number;
      invitesExpired: number;
      verificationTokensRevoked: number;
    }
  | { status: 'not_found' }
  | { status: 'already_deleted'; deletedAt: Date };

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
    // Guarded on `deletedAt: null` so two concurrent deletes cannot both
    // succeed and double-audit: the loser matches no row.
    const stamped = await tx.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: { deletedAt, sessionVersion: { increment: 1 } },
    });
    if (stamped.count === 0) return null;

    const memberships = await tx.organizationUser.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    const memberOrganizationIds = memberships.map((m) => m.organizationId);

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

    return counts;
  });

  if (!outcome) {
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

  logger.info({ msg: '[system] User soft-deleted', userId, ...outcome });

  return { status: 'deleted', deletedAt, ...outcome };
}
