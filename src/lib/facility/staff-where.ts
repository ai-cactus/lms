/**
 * The single source of truth for "which facilities may this caller's data span".
 *
 * D-01 happened because facility scoping was expressed ad hoc at each call site
 * — or not at all. This module exists so that no read path ever writes its own
 * role list again. Every narrowing goes through {@link dataFacilityIdsFor},
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
import type { AuthSession, Role } from '@/types/next-auth';

/** The session fields this module reads — satisfied by a full NextAuth session. */
export type FacilityScopeSession = {
  user: Pick<AuthSession['user'], 'id' | 'role' | 'organizationId' | 'organizationUserId'>;
};

/**
 * What the caller asked to see, as a shape that cannot be confused.
 *
 * `[]` is the value this whole module exists to disambiguate: at a page it means
 * "the viewer picked no facility" (fall back to their own scope) and at a query
 * it means "narrow to nothing". Four call sites spelled both with the same empty
 * array and each re-derived the branch by hand. Making the two states different
 * constructors moves the distinction into the type system, where a fifth copy
 * cannot quietly pick the wrong one.
 */
export type FacilitySelection = { kind: 'none' } | { kind: 'explicit'; ids: string[] };

/**
 * The one rule behind every `dataFacilityIds` in the codebase.
 *
 * An explicit selection is a REQUEST, never a grant: ids the caller cannot view
 * are dropped, and if that leaves nothing the answer is nothing. With no
 * selection the caller's own role decides — org-wide gets `null` (no predicate),
 * everyone else is narrowed to their assignments.
 */
export function dataFacilityIdsFor(input: {
  role: Role;
  selection: FacilitySelection;
  accessibleFacilityIds: string[];
}): string[] | null {
  const { role, selection, accessibleFacilityIds } = input;

  if (selection.kind === 'explicit') {
    const accessible = new Set(accessibleFacilityIds);
    return selection.ids.filter((id) => accessible.has(id));
  }

  if (isOrgWideFacilityRole(role)) return null;
  return accessibleFacilityIds;
}

/**
 * {@link dataFacilityIdsFor} for callers that hold a session rather than an
 * already-resolved accessible set.
 */
export async function resolveDataFacilityIdsFor(
  session: FacilityScopeSession,
  selection: FacilitySelection,
): Promise<string[] | null> {
  // Both short-circuits only avoid a roster query whose result the rule below
  // would discard; neither may change the verdict.
  if (selection.kind === 'none' && isOrgWideFacilityRole(session.user.role)) return null;
  if (selection.kind === 'explicit' && selection.ids.length === 0) return [];

  const facilities = await listAccessibleFacilities(session);
  return dataFacilityIdsFor({
    role: session.user.role,
    selection,
    accessibleFacilityIds: facilities.map((facility) => facility.id),
  });
}

/**
 * The facilities a caller's DATA may span, or `null` when it may span the whole
 * organisation. Fail-closed: a facility-bound role with no active assignments
 * gets `[]`, which narrows every query to nothing.
 *
 * Derived from the session alone, so server actions — which have no `?facility=`
 * parameter — reach the same verdict as a page.
 */
export function resolveDataFacilityIds(session: FacilityScopeSession): Promise<string[] | null> {
  return resolveDataFacilityIdsFor(session, { kind: 'none' });
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
