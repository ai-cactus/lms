/**
 * Organization soft delete and restore, for the /system console.
 *
 * A soft delete removes everyone's ACCESS to the organization and keeps every
 * record. In one transaction, under the organization row lock:
 *  - stamps `Organization.deletedAt`;
 *  - deactivates every active membership with `deactivatedAt` set to that SAME
 *    instant — the restore contract: restore reactivates exactly the
 *    memberships whose `deactivatedAt` equals the org's `deletedAt`, so
 *    memberships an administrator had removed before the delete stay removed;
 *  - retires the org's unsummarized reminder rows and skips its pending
 *    notification events, so no backlog flushes on restore;
 *  - writes the audit row.
 *
 * What it deliberately leaves alone: billing (the Stripe subscription keeps
 * running and the webhook keeps syncing it), pending invites (unacceptable
 * while the org is deleted, live again on restore), the join code, every
 * course, document, enrolment, certificate and stored file. No sessionVersion
 * bump: the membership lookups refuse a deleted org, which ends its sessions on
 * the next JWT decode without signing multi-org users out of their other orgs.
 *
 * Refusals are returned as values, never thrown: the Server Actions that call
 * this run in production, where thrown messages are redacted.
 */
import prisma from '@/lib/prisma';
import { rawPrisma } from '@/db/index';
import { auditCritical } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { lockOrganizations } from '@/lib/organization/owner-guard';
import { getSeatUsage } from '@/lib/seat-limits';
import { SYSTEM_ORG_SLUG } from '@/lib/video/system-user';
import type { SoftDeleteActor } from '@/lib/system/delete-user';

export const SYSTEM_ORGANIZATION_REFUSAL = 'The internal System organization cannot be deleted.';

export const RESTORE_WITHOUT_OWNER_REFUSAL =
  'No active owner would remain after restoring. Restore is blocked until an owner is available.';

export interface OrganizationIdentity {
  id: string;
  name: string;
  slug: string;
  deletedAt: Date | null;
}

export interface OrganizationSoftDeletePreview {
  organization: OrganizationIdentity;
  /** Why the delete would be refused; null when it may proceed. */
  refusal: string | null;
  members: {
    active: number;
    owners: number;
    /** Active members who keep access through another live organization. */
    alsoInOtherLiveOrgs: number;
  };
  /** Left pending: unacceptable while deleted, live again on restore. */
  pendingInvites: number;
  /** Billing is NOT touched by the delete; shown so the operator can act on it. */
  subscription: { plan: string; status: string; cancelAtPeriodEnd: boolean } | null;
  retained: {
    courses: number;
    documents: number;
    enrollments: number;
    certificates: number;
    quizAttempts: number;
    facilities: number;
  };
  /** Informational: other organizations' use of this organization's courses. */
  usedByOtherOrgs: { enrollments: number; offerings: number; certificates: number };
}

export type SoftDeleteOrganizationResult =
  | {
      status: 'deleted';
      organization: OrganizationIdentity;
      membershipsDeactivated: number;
      pendingInvites: number;
      remindersRetired: number;
      eventsSkipped: number;
    }
  | { status: 'not_found' }
  | { status: 'already_deleted'; deletedAt: Date }
  | { status: 'refused'; message: string };

export interface OrganizationRestorePreview {
  organization: OrganizationIdentity;
  membersToReactivate: number;
  /** Members deactivated by the delete whose identity has since been deleted. */
  skippedDeletedUsers: number;
  ownersAfterRestore: number;
  /** Set when the restore puts the organization over its plan's seat limit; allowed. */
  seatWarning: { used: number; max: number; over: number } | null;
  /** Why the restore would be refused; null when it may proceed. */
  blockedReason: string | null;
}

export type RestoreOrganizationResult =
  | {
      status: 'restored';
      organization: OrganizationIdentity;
      membershipsReactivated: number;
      skippedDeletedUsers: number;
    }
  | { status: 'not_found' }
  | { status: 'not_deleted' }
  | { status: 'blocked'; message: string };

const IDENTITY_SELECT = { id: true, name: true, slug: true, deletedAt: true } as const;

function refusalFor(organization: OrganizationIdentity): string | null {
  return organization.slug === SYSTEM_ORG_SLUG ? SYSTEM_ORGANIZATION_REFUSAL : null;
}

/**
 * The memberships the delete itself deactivated (`deactivatedAt` equal to the
 * org's `deletedAt`). Callers add `user.deletedAt`: a deleted identity is never
 * reactivated (Q-23), only counted as skipped.
 */
function deletedWithOrganizationWhere(organizationId: string, deletedAt: Date) {
  return { organizationId, active: false, deactivatedAt: deletedAt };
}

export async function previewOrganizationSoftDelete(
  organizationId: string,
): Promise<OrganizationSoftDeletePreview | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      ...IDENTITY_SELECT,
      subscription: { select: { plan: true, status: true, cancelAtPeriodEnd: true } },
    },
  });
  if (!organization) return null;

  const memberOfThisOrg = { organizationUser: { organizationId } };
  const thisOrgsCourse = { course: { organizationId } };
  const otherOrgsMember = { organizationUser: { organizationId: { not: organizationId } } };

  // ⛔ `rawPrisma` for the two archivable models: archived courses and documents
  // are retained records too, and the filtered client would under-report them.
  const [
    activeMembers,
    owners,
    alsoInOtherLiveOrgs,
    pendingInvites,
    courses,
    documents,
    enrollments,
    certificates,
    quizAttempts,
    facilities,
    otherOrgEnrollments,
    otherOrgOfferings,
    otherOrgCertificates,
  ] = await Promise.all([
    prisma.organizationUser.count({ where: { organizationId, active: true } }),
    prisma.organizationUser.count({ where: { organizationId, active: true, role: 'owner' } }),
    prisma.organizationUser.count({
      where: {
        organizationId,
        active: true,
        user: {
          organizationMemberships: {
            some: {
              organizationId: { not: organizationId },
              active: true,
              organization: { deletedAt: null },
            },
          },
        },
      },
    }),
    prisma.invite.count({ where: { organizationId, status: 'pending' } }),
    rawPrisma.course.count({ where: { organizationId } }),
    rawPrisma.document.count({ where: { organizationId } }),
    prisma.enrollment.count({ where: memberOfThisOrg }),
    prisma.certificate.count({ where: memberOfThisOrg }),
    prisma.quizAttempt.count({ where: { enrollment: memberOfThisOrg } }),
    prisma.facility.count({ where: { organizationId } }),
    prisma.enrollment.count({ where: { ...thisOrgsCourse, ...otherOrgsMember } }),
    prisma.orgCourseOffering.count({
      where: { ...thisOrgsCourse, organizationId: { not: organizationId } },
    }),
    prisma.certificate.count({ where: { ...thisOrgsCourse, ...otherOrgsMember } }),
  ]);

  const { subscription, ...identity } = organization;
  return {
    organization: identity,
    refusal: refusalFor(identity),
    members: { active: activeMembers, owners, alsoInOtherLiveOrgs },
    pendingInvites,
    subscription,
    retained: { courses, documents, enrollments, certificates, quizAttempts, facilities },
    usedByOtherOrgs: {
      enrollments: otherOrgEnrollments,
      offerings: otherOrgOfferings,
      certificates: otherOrgCertificates,
    },
  };
}

export async function softDeleteOrganization(
  organizationId: string,
  actor: SoftDeleteActor,
): Promise<SoftDeleteOrganizationResult> {
  const deletedAt = new Date();

  const outcome = await prisma.$transaction(async (tx) => {
    // The lock every membership write and owner-guarded change takes, so a join
    // or demotion racing this delete is serialised against it.
    await lockOrganizations(tx, [organizationId]);

    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: IDENTITY_SELECT,
    });
    if (!organization) return { kind: 'not_found' as const };
    if (organization.deletedAt) {
      return { kind: 'already_deleted' as const, deletedAt: organization.deletedAt };
    }

    const refusal = refusalFor(organization);
    if (refusal) return { kind: 'refused' as const, message: refusal };

    const stamped = await tx.organization.updateMany({
      where: { id: organizationId, deletedAt: null },
      data: { deletedAt },
    });
    if (stamped.count === 0) return { kind: 'raced' as const };

    const deactivated = await tx.organizationUser.updateMany({
      where: { organizationId, active: true },
      data: { active: false, deactivatedAt: deletedAt },
    });

    const pendingInvites = await tx.invite.count({ where: { organizationId, status: 'pending' } });

    const unsummarizedInThisOrg = {
      summarizedAt: null,
      enrollment: { organizationUser: { organizationId } },
    };
    const [retiredLogs, retiredNudges] = await Promise.all([
      tx.reminderLog.updateMany({
        where: unsummarizedInThisOrg,
        data: { summarizedAt: deletedAt },
      }),
      tx.reminderNudge.updateMany({
        where: unsummarizedInThisOrg,
        data: { summarizedAt: deletedAt },
      }),
    ]);

    const skippedEvents = await tx.notificationEvent.updateMany({
      where: { organizationId, status: 'pending' },
      data: { status: 'skipped' },
    });

    const counts = {
      membershipsDeactivated: deactivated.count,
      pendingInvites,
      remindersRetired: retiredLogs.count + retiredNudges.count,
      eventsSkipped: skippedEvents.count,
    };

    // Inside the transaction so the delete and its record commit together.
    // Ids and counts only — the audit row is long-lived.
    await auditCritical(
      {
        action: 'system.org.soft_delete',
        targetType: 'organization',
        targetId: organizationId,
        organizationId,
        metadata: { mode: 'soft', ...counts },
        ...actor,
      },
      tx,
    );

    return { kind: 'deleted' as const, organization: { ...organization, deletedAt }, counts };
  });

  switch (outcome.kind) {
    case 'not_found':
      return { status: 'not_found' };
    case 'already_deleted':
      return { status: 'already_deleted', deletedAt: outcome.deletedAt };
    case 'raced': {
      const current = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { deletedAt: true },
      });
      return current?.deletedAt
        ? { status: 'already_deleted', deletedAt: current.deletedAt }
        : { status: 'not_found' };
    }
    case 'refused':
      logger.warn({ msg: '[system] Organization delete refused', orgId: organizationId });
      return { status: 'refused', message: outcome.message };
    case 'deleted':
      logger.info({
        msg: '[system] Organization soft-deleted',
        orgId: organizationId,
        ...outcome.counts,
      });
      return { status: 'deleted', organization: outcome.organization, ...outcome.counts };
  }
}

export async function previewOrganizationRestore(
  organizationId: string,
): Promise<OrganizationRestorePreview | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: IDENTITY_SELECT,
  });
  if (!organization) return null;

  if (!organization.deletedAt) {
    return {
      organization,
      membersToReactivate: 0,
      skippedDeletedUsers: 0,
      ownersAfterRestore: 0,
      seatWarning: null,
      blockedReason: null,
    };
  }

  const restorable = deletedWithOrganizationWhere(organizationId, organization.deletedAt);
  const [membersToReactivate, skippedDeletedUsers, restoredOwners, activeOwners, seats] =
    await Promise.all([
      prisma.organizationUser.count({ where: { ...restorable, user: { deletedAt: null } } }),
      prisma.organizationUser.count({
        where: { ...restorable, user: { deletedAt: { not: null } } },
      }),
      prisma.organizationUser.count({
        where: { ...restorable, role: 'owner', user: { deletedAt: null } },
      }),
      prisma.organizationUser.count({ where: { organizationId, active: true, role: 'owner' } }),
      getSeatUsage(organizationId),
    ]);

  const ownersAfterRestore = restoredOwners + activeOwners;
  const used = seats.current + membersToReactivate;
  const seatWarning =
    seats.staffMax !== null && used > seats.staffMax
      ? { used, max: seats.staffMax, over: used - seats.staffMax }
      : null;

  return {
    organization,
    membersToReactivate,
    skippedDeletedUsers,
    ownersAfterRestore,
    seatWarning,
    blockedReason: ownersAfterRestore === 0 ? RESTORE_WITHOUT_OWNER_REFUSAL : null,
  };
}

export async function restoreOrganization(
  organizationId: string,
  actor: SoftDeleteActor,
): Promise<RestoreOrganizationResult> {
  const outcome = await prisma.$transaction(async (tx) => {
    await lockOrganizations(tx, [organizationId]);

    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: IDENTITY_SELECT,
    });
    if (!organization) return { kind: 'not_found' as const };
    const { deletedAt } = organization;
    if (!deletedAt) return { kind: 'not_deleted' as const };

    const restorable = deletedWithOrganizationWhere(organizationId, deletedAt);
    const [restoredOwners, activeOwners, skippedDeletedUsers] = await Promise.all([
      tx.organizationUser.count({
        where: { ...restorable, role: 'owner', user: { deletedAt: null } },
      }),
      tx.organizationUser.count({ where: { organizationId, active: true, role: 'owner' } }),
      tx.organizationUser.count({ where: { ...restorable, user: { deletedAt: { not: null } } } }),
    ]);
    if (restoredOwners + activeOwners === 0) return { kind: 'blocked' as const };

    const cleared = await tx.organization.updateMany({
      where: { id: organizationId, deletedAt },
      data: { deletedAt: null },
    });
    if (cleared.count === 0) return { kind: 'raced' as const };

    const reactivated = await tx.organizationUser.updateMany({
      where: { ...restorable, user: { deletedAt: null } },
      data: { active: true, deactivatedAt: null },
    });

    const counts = { membershipsReactivated: reactivated.count, skippedDeletedUsers };

    await auditCritical(
      {
        action: 'system.org.restore',
        targetType: 'organization',
        targetId: organizationId,
        organizationId,
        metadata: counts,
        ...actor,
      },
      tx,
    );

    return {
      kind: 'restored' as const,
      organization: { ...organization, deletedAt: null },
      counts,
    };
  });

  switch (outcome.kind) {
    case 'not_found':
      return { status: 'not_found' };
    case 'not_deleted':
    case 'raced':
      return { status: 'not_deleted' };
    case 'blocked':
      logger.warn({
        msg: '[system] Organization restore refused: no active owner would remain',
        orgId: organizationId,
      });
      return { status: 'blocked', message: RESTORE_WITHOUT_OWNER_REFUSAL };
    case 'restored':
      logger.info({
        msg: '[system] Organization restored',
        orgId: organizationId,
        ...outcome.counts,
      });
      return { status: 'restored', organization: outcome.organization, ...outcome.counts };
  }
}
