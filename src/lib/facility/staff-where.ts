/**
 * The single source of truth for "which facilities may this caller's data span".
 *
 * D-01 happened because facility scoping was expressed ad hoc at each call site
 * — or not at all. This module exists so that no read path ever writes its own
 * role list again. Every narrowing goes through {@link resolveDataFacilityIds},
 * which returns `null` for org-wide roles, so HR, Finance, Clinical Director,
 * Owner and Admin are protected from over-scoping structurally rather than by
 * each author remembering to exempt them.
 *
 * The `string[] | null` contract is load-bearing:
 *
 *   null      → apply NO facility predicate (caller is org-wide).
 *   string[]  → narrow to exactly these ids. MAY BE EMPTY, and empty means
 *               "see nothing" — never "see everything".
 *
 * That last clause is the bug this module is named after. `/dashboard/status-tracker`
 * derived an id array from the `?facility=` URL parameter, got `[]` for a
 * supervisor who had not picked one, and passed `undefined` downstream — which
 * the query read as "no filter" and answered org-wide. A URL parameter is view
 * state; it must never be mistaken for the security boundary.
 */
import type { Prisma } from '@/generated/prisma/client';
import { isOrgWideFacilityRole, listAccessibleFacilities } from '@/lib/facility/scope';
import type { AuthSession } from '@/types/next-auth';

/** The session fields this module reads — satisfied by a full NextAuth session. */
export type FacilityScopeSession = {
  user: Pick<AuthSession['user'], 'id' | 'role' | 'organizationId' | 'organizationUserId'>;
};

/**
 * The facilities a caller's DATA may span, or `null` when it may span the whole
 * organisation. Fail-closed: a facility-bound role with no active assignments
 * gets `[]`, which narrows every query to nothing.
 *
 * Derived from the session alone, so server actions — which have no `?facility=`
 * parameter — reach the same verdict as a page.
 */
export async function resolveDataFacilityIds(
  session: FacilityScopeSession,
): Promise<string[] | null> {
  if (isOrgWideFacilityRole(session.user.role)) return null;
  const facilities = await listAccessibleFacilities(session);
  return facilities.map((facility) => facility.id);
}

/**
 * The `OrganizationUser` predicate for a facility-narrowed roster read.
 *
 * Deliberately matches on the membership (`OrganizationUserFacility`) rather
 * than a denormalised column: membership is where the person is NOW. Scoping a
 * roster by anything historical would surface a transferred worker's records to
 * their former supervisor while their name is absent from that supervisor's
 * staff list — a discrepancy an auditor would find before we did.
 */
export function staffFacilityWhere(
  dataFacilityIds: string[] | null,
): Prisma.OrganizationUserWhereInput {
  if (dataFacilityIds === null) return {};
  return {
    facilities: { some: { facilityId: { in: dataFacilityIds }, active: true } },
  };
}

/**
 * The `Invite` predicate for the same read. Pending invites carry a required
 * `Invite.facilityId` (the facility the invitee will join), so they are already
 * scoped data — showing a supervisor another facility's incoming hires would
 * leak the same class of PII as the roster itself.
 */
export function inviteFacilityWhere(dataFacilityIds: string[] | null): Prisma.InviteWhereInput {
  if (dataFacilityIds === null) return {};
  return { facilityId: { in: dataFacilityIds } };
}
