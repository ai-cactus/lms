/**
 * Resolves the facility to stamp on artifacts created FOR a member (currently
 * enrollments). Single home for the rule so every enrollment call site — assign,
 * role-target auto-enroll, invite accept, retake, renewal sweep — agrees on
 * which facility a member belongs to.
 */
import prisma from '@/lib/prisma';
import { OLDEST_ASSIGNMENT_FIRST } from '@/lib/facility/assignment-order';
import type { Prisma } from '@/generated/prisma/client';

/**
 * The Prisma delegate this module needs. Both the base client and a
 * `Prisma.TransactionClient` satisfy it, so callers can resolve inside an
 * existing `$transaction`.
 */
type MemberFacilityDbClient = Pick<typeof prisma, 'organizationUserFacility'>;

/**
 * The facility a member's training is attributed to, and that facility's IANA
 * zone. The zone is the one a picked deadline ends in (BUG-12.3) — the same
 * "oldest active roster facility" the Status Tracker counts days in.
 */
export interface MemberFacility {
  facilityId: string;
  /** `Facility.timezone`; null when unset — callers fall back to `DEFAULT_TZ`. */
  timezone: string | null;
}

const MEMBER_FACILITY_SELECT = {
  facilityId: true,
  facility: { select: { timezone: true } },
} satisfies Prisma.OrganizationUserFacilitySelect;

/**
 * The member's facility, or `null` when they hold no active assignment (e.g. the
 * internal system membership, or an HR account never attached to a site).
 */
export async function resolveMemberFacility(
  client: MemberFacilityDbClient,
  organizationUserId: string,
): Promise<MemberFacility | null> {
  const assignment = await client.organizationUserFacility.findFirst({
    where: { organizationUserId, active: true },
    orderBy: OLDEST_ASSIGNMENT_FIRST,
    select: MEMBER_FACILITY_SELECT,
  });

  return assignment
    ? { facilityId: assignment.facilityId, timezone: assignment.facility?.timezone ?? null }
    : null;
}

/** The id half of {@link resolveMemberFacility}. */
export async function resolveMemberFacilityId(
  client: MemberFacilityDbClient,
  organizationUserId: string,
): Promise<string | null> {
  return (await resolveMemberFacility(client, organizationUserId))?.facilityId ?? null;
}

/**
 * Batch form of {@link resolveMemberFacility} for bulk enrollment paths — one
 * query for the whole set instead of one per member. Members with no active
 * assignment are simply absent from the map.
 */
export async function resolveMemberFacilities(
  client: MemberFacilityDbClient,
  organizationUserIds: string[],
): Promise<Map<string, MemberFacility>> {
  if (organizationUserIds.length === 0) return new Map();

  const assignments = await client.organizationUserFacility.findMany({
    where: { organizationUserId: { in: organizationUserIds }, active: true },
    orderBy: OLDEST_ASSIGNMENT_FIRST,
    select: { organizationUserId: true, ...MEMBER_FACILITY_SELECT },
  });

  const byMember = new Map<string, MemberFacility>();
  for (const assignment of assignments) {
    // Rows arrive oldest-first, so the first one seen per member is the winner.
    if (!byMember.has(assignment.organizationUserId)) {
      byMember.set(assignment.organizationUserId, {
        facilityId: assignment.facilityId,
        timezone: assignment.facility?.timezone ?? null,
      });
    }
  }

  return byMember;
}

/** The id half of {@link resolveMemberFacilities}. */
export async function resolveMemberFacilityIds(
  client: MemberFacilityDbClient,
  organizationUserIds: string[],
): Promise<Map<string, string>> {
  const facilities = await resolveMemberFacilities(client, organizationUserIds);
  return new Map([...facilities].map(([memberId, facility]) => [memberId, facility.facilityId]));
}
