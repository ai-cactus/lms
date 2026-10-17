/**
 * PERMANENT user delete, for the /system console. The second step after
 * {@link softDeleteUser}: only an identity that is already soft-deleted can be
 * destroyed, and only while `SYSTEM_HARD_DELETE_ENABLED` is on (staging only).
 *
 * In one transaction, under the row locks of every organization the person
 * belongs to (deleted ones included), it deletes the identity and everything
 * tied to it: memberships (cascading their enrolments, quiz attempts,
 * certificates, notifications, notification preferences and facility rows),
 * MFA factors and recovery codes, jobs, emails sent to the address, the
 * notification-outbox rows naming the person, invites to the address in every
 * organization, and verification tokens. Direct reports' manager links are
 * cleared by the schema. The email becomes free to register again.
 *
 * What it keeps: audit-log rows and PHI decisions (ids only), and the opaque
 * ids other people's rows carry. It REFUSES — never reassigns — a person who
 * authored a course or uploaded a document: that content belongs to the
 * organization, and only deleting the organization removes it.
 *
 * Stored files go after the commit, by exact recorded URI (certificate PDFs and
 * the person's own avatar), plus the bounded avatar-folder clear in
 * `deleteUserAvatarFolder`. A storage failure never undoes the delete; it is
 * recorded for retry.
 *
 * Refusals are returned as values, never thrown: the Server Actions that call
 * this run in production, where thrown messages are redacted.
 */
import { rawPrisma } from '@/db/index';
import { Prisma } from '@/generated/prisma/client';
import { audit, auditCritical } from '@/lib/audit';
import { invalidateRevalidationCache } from '@/lib/auth/session-revalidation-cache';
import { logger } from '@/lib/logger';
import { lockOrganizations } from '@/lib/organization/owner-guard';
import { deleteUserAvatarFolder, isOwnAvatarUri } from '@/lib/storage/avatar';
import { deleteStorageObjects } from '@/lib/storage/cleanup';
import { SYSTEM_ORG_SLUG, SYSTEM_USER_EMAIL } from '@/lib/video/system-user';
import type { SoftDeleteActor } from '@/lib/system/delete-user';
import { HARD_DELETE_DISABLED_REFUSAL, isHardDeleteEnabled } from '@/lib/system/hard-delete-flag';

export const NOT_SOFT_DELETED_REFUSAL =
  'Delete this user first. A user must be deleted before it can be permanently deleted.';
export const EMAIL_MISMATCH_REFUSAL = 'The email you typed does not match.';
export const NOT_ACKNOWLEDGED_REFUSAL =
  'Confirm that you understand certificates will be destroyed.';
export const SYSTEM_USER_REFUSAL = 'The internal System user cannot be deleted.';

export function authoredContentRefusal(authored: { courses: number; documents: number }): string {
  return `This user authored ${authored.courses} course(s) and uploaded ${authored.documents} document(s). Delete the organization instead; content is never reassigned.`;
}

export interface HardDeleteCounts {
  memberships: number;
  enrollments: number;
  quizAttempts: number;
  certificates: number;
  notifications: number;
  invites: number;
  emailMessages: number;
  notificationEvents: number;
  jobs: number;
  mfaFactors: number;
  mfaRecoveryCodes: number;
  verificationTokens: number;
}

export interface UserHardDeletePreview {
  enabled: boolean;
  user: { id: string; email: string; name: string; deletedAt: Date | null };
  /** Why the delete would be refused; null when it may proceed. */
  refusal: string | null;
  authored: { courses: number; documents: number };
  destroyed: HardDeleteCounts;
  storageObjects: { avatarFolder: true; certificatePdfs: number };
  /** Members whose manager link to this person is cleared. */
  directReports: number;
  organizations: { name: string; deleted: boolean; wasOwner: boolean }[];
}

export type HardDeleteUserResult =
  | {
      status: 'deleted';
      counts: HardDeleteCounts;
      storage: { attempted: number; failed: number };
    }
  | { status: 'disabled' }
  | { status: 'not_found' }
  | { status: 'not_soft_deleted' }
  | { status: 'confirmation_mismatch' }
  | { status: 'not_acknowledged' }
  | { status: 'refused'; message: string };

/** The unfiltered client or its transaction: archived courses and documents must count. */
type RawClient = Omit<Prisma.TransactionClient, symbol>;

interface Identity {
  id: string;
  email: string;
}

const RAW_TRANSACTION_TIMEOUT_MS = 30_000;

function emailEquals(email: string) {
  return { equals: email, mode: 'insensitive' as const };
}

async function countAuthored(client: RawClient, membershipIds: string[]) {
  const [courses, documents] = await Promise.all([
    client.course.count({ where: { createdByOrgUserId: { in: membershipIds } } }),
    client.document.count({ where: { organizationUserId: { in: membershipIds } } }),
  ]);
  return { courses, documents };
}

export function runningJobsRefusal(count: number): string {
  return `This user has ${count} background job(s) still running. Try again once they finish.`;
}

/**
 * The refusals that depend on the data rather than the request: the internal
 * System identity, authored content, and running jobs. Null when the delete
 * may proceed.
 */
async function findDataRefusal(
  client: RawClient,
  user: Identity,
  membershipIds: string[],
): Promise<string | null> {
  const systemMemberships = await client.organizationUser.count({
    where: { userId: user.id, organization: { slug: SYSTEM_ORG_SLUG } },
  });
  if (user.email.toLowerCase() === SYSTEM_USER_EMAIL || systemMemberships > 0) {
    return SYSTEM_USER_REFUSAL;
  }

  const authored = await countAuthored(client, membershipIds);
  if (authored.courses > 0 || authored.documents > 0) return authoredContentRefusal(authored);

  // A worker still running would fail mid-run once its Job row is deleted
  // underneath it. Finished and failed jobs are deleted with the user.
  const runningJobs = await client.job.count({
    where: { userId: user.id, status: { in: ['queued', 'processing'] } },
  });
  return runningJobs > 0 ? runningJobsRefusal(runningJobs) : null;
}

async function countDestroyed(
  client: RawClient,
  user: Identity,
  membershipIds: string[],
): Promise<HardDeleteCounts> {
  const ownMemberships = { organizationUserId: { in: membershipIds } };
  const [
    enrollments,
    quizAttempts,
    certificates,
    notifications,
    invites,
    emailMessages,
    notificationEvents,
    jobs,
    mfaFactors,
    mfaRecoveryCodes,
    verificationTokens,
  ] = await Promise.all([
    client.enrollment.count({ where: ownMemberships }),
    client.quizAttempt.count({ where: { enrollment: ownMemberships } }),
    client.certificate.count({ where: ownMemberships }),
    client.notification.count({ where: ownMemberships }),
    client.invite.count({ where: { email: emailEquals(user.email) } }),
    client.emailMessage.count({ where: { toEmail: emailEquals(user.email) } }),
    client.notificationEvent.count({
      where: { OR: [{ actorUserId: user.id }, { subjectUserId: user.id }] },
    }),
    client.job.count({ where: { userId: user.id } }),
    client.mfaFactor.count({ where: { userId: user.id } }),
    client.mfaRecoveryCode.count({ where: { userId: user.id } }),
    client.verificationToken.count({ where: { identifier: emailEquals(user.email) } }),
  ]);

  return {
    memberships: membershipIds.length,
    enrollments,
    quizAttempts,
    certificates,
    notifications,
    invites,
    emailMessages,
    notificationEvents,
    jobs,
    mfaFactors,
    mfaRecoveryCodes,
    verificationTokens,
  };
}

export async function previewUserHardDelete(userId: string): Promise<UserHardDeletePreview | null> {
  const user = await rawPrisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, deletedAt: true },
  });
  if (!user) return null;

  const memberships = await rawPrisma.organizationUser.findMany({
    where: { userId },
    select: {
      id: true,
      role: true,
      organization: { select: { name: true, deletedAt: true } },
    },
    orderBy: { joinedAt: 'asc' },
  });
  const membershipIds = memberships.map((membership) => membership.id);

  const [authored, destroyed, certificatePdfs, directReports, dataRefusal] = await Promise.all([
    countAuthored(rawPrisma, membershipIds),
    countDestroyed(rawPrisma, user, membershipIds),
    rawPrisma.certificate.count({
      where: { organizationUserId: { in: membershipIds }, pdfStoragePath: { not: null } },
    }),
    rawPrisma.organizationUser.count({
      where: { managerId: { in: membershipIds }, id: { notIn: membershipIds } },
    }),
    findDataRefusal(rawPrisma, user, membershipIds),
  ]);

  const enabled = isHardDeleteEnabled();
  const refusal = !enabled
    ? HARD_DELETE_DISABLED_REFUSAL
    : !user.deletedAt
      ? NOT_SOFT_DELETED_REFUSAL
      : dataRefusal;

  return {
    enabled,
    user: {
      id: user.id,
      email: user.email,
      name: user.fullName || user.email.split('@')[0],
      deletedAt: user.deletedAt,
    },
    refusal,
    authored,
    destroyed,
    storageObjects: { avatarFolder: true, certificatePdfs },
    directReports,
    organizations: memberships.map((membership) => ({
      name: membership.organization.name,
      deleted: membership.organization.deletedAt !== null,
      wasOwner: membership.role === 'owner',
    })),
  };
}

function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

export async function hardDeleteUser(
  userId: string,
  confirmation: { confirmEmail: string; acknowledged: boolean },
  actor: SoftDeleteActor,
): Promise<HardDeleteUserResult> {
  if (!isHardDeleteEnabled()) return { status: 'disabled' };

  const user = await rawPrisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, deletedAt: true },
  });
  if (!user) return { status: 'not_found' };
  if (!user.deletedAt) return { status: 'not_soft_deleted' };
  if (confirmation.confirmEmail !== user.email) return { status: 'confirmation_mismatch' };
  if (confirmation.acknowledged !== true) return { status: 'not_acknowledged' };

  const initialMemberships = await rawPrisma.organizationUser.findMany({
    where: { userId },
    select: { id: true, organizationId: true },
  });
  const preCheckRefusal = await findDataRefusal(
    rawPrisma,
    user,
    initialMemberships.map((membership) => membership.id),
  );
  if (preCheckRefusal) {
    logger.warn({ msg: '[system] User hard delete refused', userId });
    return { status: 'refused', message: preCheckRefusal };
  }

  let outcome;
  try {
    outcome = await rawPrisma.$transaction(
      async (tx) => {
        await lockOrganizations(
          tx,
          initialMemberships.map((membership) => membership.organizationId),
        );

        const current = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, deletedAt: true, avatarUrl: true },
        });
        if (!current) return { kind: 'not_found' as const };
        if (!current.deletedAt) return { kind: 'not_soft_deleted' as const };
        if (current.email !== confirmation.confirmEmail) {
          return { kind: 'confirmation_mismatch' as const };
        }

        const membershipIds = (
          await tx.organizationUser.findMany({ where: { userId }, select: { id: true } })
        ).map((membership) => membership.id);

        const refusal = await findDataRefusal(tx, current, membershipIds);
        if (refusal) return { kind: 'refused' as const, message: refusal };

        const certificates = await tx.certificate.findMany({
          where: { organizationUserId: { in: membershipIds }, pdfStoragePath: { not: null } },
          select: { pdfStoragePath: true },
        });
        // An avatarUrl outside the person's own uploads may name another
        // tenant's object, so only their own is deleted by URI.
        const exactUris = [
          ...certificates.flatMap(({ pdfStoragePath }) => (pdfStoragePath ? [pdfStoragePath] : [])),
          ...(current.avatarUrl && isOwnAvatarUri(current.avatarUrl, userId)
            ? [current.avatarUrl]
            : []),
        ];

        const counts = await countDestroyed(tx, current, membershipIds);

        await tx.job.deleteMany({ where: { userId } });
        await tx.emailMessage.deleteMany({ where: { toEmail: emailEquals(current.email) } });
        await tx.notificationEvent.deleteMany({
          where: { OR: [{ actorUserId: userId }, { subjectUserId: userId }] },
        });
        await tx.invite.deleteMany({ where: { email: emailEquals(current.email) } });
        await tx.verificationToken.deleteMany({
          where: { identifier: emailEquals(current.email) },
        });
        await tx.organizationUser.deleteMany({ where: { userId } });
        await tx.mfaFactor.deleteMany({ where: { userId } });
        await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
        await tx.user.delete({ where: { id: userId } });

        const storageObjects = { certificatePdfs: certificates.length, avatarFolder: true };

        // Inside the transaction so the delete and its record commit together.
        // Ids and counts only: the row outlives the person it describes.
        await auditCritical(
          {
            action: 'system.user.hard_delete',
            targetType: 'user',
            targetId: userId,
            metadata: { mode: 'hard', ...counts, storageObjects },
            ...actor,
          },
          tx,
        );

        return { kind: 'deleted' as const, counts, exactUris };
      },
      { timeout: RAW_TRANSACTION_TIMEOUT_MS },
    );
  } catch (err) {
    // A course authored between the in-transaction check and the delete trips
    // `Course.creator`'s Restrict. Refused the same way the check would have.
    if (!isForeignKeyViolation(err)) throw err;
    const memberships = await rawPrisma.organizationUser.findMany({
      where: { userId },
      select: { id: true },
    });
    const authored = await countAuthored(
      rawPrisma,
      memberships.map((membership) => membership.id),
    );
    logger.warn({ msg: '[system] User hard delete refused by a foreign key', userId });
    return { status: 'refused', message: authoredContentRefusal(authored) };
  }

  switch (outcome.kind) {
    case 'not_found':
      return { status: 'not_found' };
    case 'not_soft_deleted':
      return { status: 'not_soft_deleted' };
    case 'confirmation_mismatch':
      return { status: 'confirmation_mismatch' };
    case 'refused':
      logger.warn({ msg: '[system] User hard delete refused', userId });
      return { status: 'refused', message: outcome.message };
    case 'deleted':
      break;
  }

  await invalidateRevalidationCache(userId);

  const exact = await deleteStorageObjects(outcome.exactUris, {
    module: '[system]',
    ids: { userId },
  });
  const folder = await deleteUserAvatarFolder(userId);

  const failedUris = [...exact.failed, ...(folder.status === 'deleted' ? folder.failed : [])];
  const avatarFolderRefusal = folder.status === 'refused' ? folder.reason : null;
  const storage = {
    attempted: exact.attempted + folder.listed,
    failed: failedUris.length + (avatarFolderRefusal ? 1 : 0),
  };

  if (storage.failed > 0) {
    await audit({
      action: 'system.user.hard_delete.storage_incomplete',
      targetType: 'user',
      targetId: userId,
      metadata: { failedUris, avatarFolderRefusal },
      ...actor,
    });
  }

  logger.info({
    msg: '[system] User hard-deleted',
    userId,
    ...outcome.counts,
    storageAttempted: storage.attempted,
    storageFailed: storage.failed,
  });

  return { status: 'deleted', counts: outcome.counts, storage };
}
