/**
 * Resolves the facility to stamp on artifacts created FOR a member (currently
 * enrollments). Single home for the rule so every enrollment call site — assign,
 * role-target auto-enroll, invite accept, retake, renewal sweep — agrees on
 * which facility a member belongs to.
 */
import prisma from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';

/**
 * A member may hold several active facility assignments (supervisors routinely
 * do). Oldest-first makes the pick deterministic; `id` breaks a same-instant tie.
 */
const OLDEST_ASSIGNMENT_FIRST: Prisma.OrganizationUserFacilityOrderByWithRelationInput[] = [
  { joinedAt: 'asc' },
  { id: 'asc' },
];

/**
 * The Prisma delegate this module needs. Both the base client and a
 * `Prisma.TransactionClient` satisfy it, so callers can resolve inside an
 * existing `$transaction`.
 */
type MemberFacilityDbClient = Pick<typeof prisma, 'organizationUserFacility'>;

/**
 * The member's facility, or `null` when they hold no active assignment (e.g. the
 * internal system membership, or an HR account never attached to a site).
 */
export async function resolveMemberFacilityId(
  client: MemberFacilityDbClient,
  organizationUserId: string,
): Promise<string | null> {
  const assignment = await client.organizationUserFacility.findFirst({
    where: { organizationUserId, active: true },
    orderBy: OLDEST_ASSIGNMENT_FIRST,
    select: { facilityId: true },
  });

  return assignment?.facilityId ?? null;
}

/**
 * Batch form of {@link resolveMemberFacilityId} for bulk enrollment paths — one
 * query for the whole set instead of one per member. Members with no active
 * assignment are simply absent from the map.
 */
export async function resolveMemberFacilityIds(
  client: MemberFacilityDbClient,
  organizationUserIds: string[],
): Promise<Map<string, string>> {
  if (organizationUserIds.length === 0) return new Map();

  const assignments = await client.organizationUserFacility.findMany({
    where: { organizationUserId: { in: organizationUserIds }, active: true },
    orderBy: OLDEST_ASSIGNMENT_FIRST,
    select: { organizationUserId: true, facilityId: true },
  });

  const byMember = new Map<string, string>();
  for (const assignment of assignments) {
    // Rows arrive oldest-first, so the first one seen per member is the winner.
    if (!byMember.has(assignment.organizationUserId)) {
      byMember.set(assignment.organizationUserId, assignment.facilityId);
    }
  }

  return byMember;
}
