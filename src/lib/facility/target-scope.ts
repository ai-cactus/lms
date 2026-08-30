/**
 * Facility scoping for MUTATION TARGETS.
 *
 * {@link resolveDataFacilityIds} in `staff-where.ts` answers "which rows may
 * this caller READ". This module answers the narrower question every write has
 * to ask: "may this caller ACT ON the specific person, or into the specific
 * facility, that they just named".
 *
 * The distinction is not academic. A read narrowing is applied to a query the
 * caller does not control. A write target arrives from the CLIENT — an email
 * typed into a free-text box, an id in a URL, a facility chosen in a dropdown —
 * so narrowing the widget that offers the choices constrains nothing. That gap
 * is exactly how a facility-bound supervisor came to be able to enroll any
 * member of the organisation by typing their address: the picker was scoped,
 * the action was not.
 *
 * Everything here inherits the load-bearing `string[] | null` contract:
 *
 *   null      → caller is org-wide; every target is permitted.
 *   string[]  → only targets inside these facilities. MAY BE EMPTY, and empty
 *               means "act on nothing" — never "act on everything".
 *
 * Callers PARTITION rather than throw, so a batch can refuse the targets it must
 * and still process the rest — and so refusals survive production's Server
 * Action error redaction, which turns a thrown message into React error #441.
 */
import prisma from '@/lib/prisma';
import { resolveDataFacilityIds, type FacilityScopeSession } from '@/lib/facility/staff-where';

/** Targets split into those the caller may act on and those they may not. */
export interface TargetPartition<T> {
  allowed: T[];
  rejected: T[];
}

/**
 * Membership predicate, kept identical to `staffFacilityWhere`: a person is in
 * scope when they hold an ACTIVE membership of one of the caller's facilities.
 * Deliberately "where they are now" — scoping by anything historical would let
 * a transferred worker stay reachable by their former supervisor.
 */
function inScope(memberFacilityIds: string[], scope: ReadonlySet<string>): boolean {
  return memberFacilityIds.some((id) => scope.has(id));
}

/**
 * Partition target org-user ids by whether the caller's facilities admit them.
 *
 * Ids that match no member of `organizationId` are returned as REJECTED: a
 * target that does not exist in the caller's organisation is not one they may
 * act on, and treating "unknown" as allowed would reopen the hole for any id
 * the caller can guess.
 */
export async function partitionOrgUsersByFacility(
  session: FacilityScopeSession,
  organizationId: string,
  orgUserIds: readonly string[],
): Promise<TargetPartition<string>> {
  const facilityIds = await resolveDataFacilityIds(session);
  if (facilityIds === null) return { allowed: [...orgUserIds], rejected: [] };

  const members = await prisma.organizationUser.findMany({
    where: { organizationId, id: { in: [...orgUserIds] } },
    select: { id: true, facilities: { where: { active: true }, select: { facilityId: true } } },
  });

  const scope = new Set(facilityIds);
  const permitted = new Set(
    members
      .filter((m) =>
        inScope(
          m.facilities.map((f) => f.facilityId),
          scope,
        ),
      )
      .map((m) => m.id),
  );

  const allowed: string[] = [];
  const rejected: string[] = [];
  for (const id of orgUserIds) (permitted.has(id) ? allowed : rejected).push(id);
  return { allowed, rejected };
}

/**
 * Partition target emails by whether the caller's facilities admit them.
 *
 * Unlike the id form, an email matching NO member is returned as ALLOWED: it is
 * not a facility question at all but an invitation, governed separately by
 * `invite.create`. Rejecting it here would break invites for any facility-bound
 * role that legitimately holds that permission.
 */
export async function partitionEmailsByFacility(
  session: FacilityScopeSession,
  organizationId: string,
  emails: readonly string[],
): Promise<TargetPartition<string>> {
  const facilityIds = await resolveDataFacilityIds(session);
  const normalized = emails.map((e) => e.toLowerCase().trim());
  if (facilityIds === null) return { allowed: normalized, rejected: [] };

  const members = await prisma.organizationUser.findMany({
    where: { organizationId, user: { email: { in: normalized } } },
    select: {
      user: { select: { email: true } },
      facilities: { where: { active: true }, select: { facilityId: true } },
    },
  });

  const scope = new Set(facilityIds);
  const outOfScope = new Set(
    members
      .filter(
        (m) =>
          !inScope(
            m.facilities.map((f) => f.facilityId),
            scope,
          ),
      )
      .map((m) => m.user.email.toLowerCase()),
  );

  const allowed: string[] = [];
  const rejected: string[] = [];
  for (const email of normalized) (outOfScope.has(email) ? rejected : allowed).push(email);
  return { allowed, rejected };
}

/**
 * Whether the caller may direct a write INTO these facilities — assigning a
 * worker to one, or anchoring an invite there.
 *
 * Distinct from the target-person checks above: this asks about the destination
 * rather than the subject. Org membership of the facility is necessary but not
 * sufficient; a facility-bound caller must also be able to reach it, or they
 * could seed staff into a site they cannot see.
 */
export async function areFacilitiesInCallerScope(
  session: FacilityScopeSession,
  facilityIds: readonly string[],
): Promise<boolean> {
  const scope = await resolveDataFacilityIds(session);
  if (scope === null) return true;
  const allowed = new Set(scope);
  return facilityIds.every((id) => allowed.has(id));
}
