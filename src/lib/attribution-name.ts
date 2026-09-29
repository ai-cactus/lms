import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * The name to snapshot beside an approver/archiver FK (BUG-25).
 *
 * `Course.approvedByOrgUserId`, `Course.archivedByOrgUserId` and
 * `Document.archivedByOrgUserId` are `onDelete: SetNull`, so once the member is
 * deleted the snapshot is the only record of who acted. It is read from the
 * same membership the FK points at, so the two can never name different people.
 *
 * Returns null when there is no member or no full name — never an email: a
 * deleted person's address must not outlive them on the record. A failed lookup
 * is logged and returns null rather than failing the approve/archive it rides
 * on; the FK still records the actor while the member exists.
 */
export async function resolveAttributionName(
  organizationUserId: string | null | undefined,
): Promise<string | null> {
  if (!organizationUserId) return null;
  try {
    const member = await prisma.organizationUser.findUnique({
      where: { id: organizationUserId },
      select: { user: { select: { fullName: true } } },
    });
    return member?.user.fullName?.trim() || null;
  } catch (err) {
    logger.error({
      msg: '[attribution] Could not resolve the actor name to snapshot',
      err,
      organizationUserId,
    });
    return null;
  }
}
