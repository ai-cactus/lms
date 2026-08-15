/**
 * Per-request facility scope.
 *
 * Facility scope is deliberately NOT a session/JWT claim: a session is scoped to
 * an organisation (see `MembershipClaims`), and the facility a user is *looking
 * at* is view state derived from the request (a `?facility=` param). Keeping it
 * out of the token means switching facilities never mints a new session and a
 * stale token can never carry a facility the user has since lost access to —
 * every read re-derives the accessible set from the database.
 *
 * Access is by SCOPE, not by verb: `facility.read` is held by every role, so the
 * registry cannot express the difference between an org-wide viewer and a
 * facility-bound one. That distinction lives here.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { MIN_COMPARISON_FACILITIES, parseFacilityScopeParam } from '@/lib/facility/scope-param';
import type { Prisma } from '@/generated/prisma/client';
import type { AuthSession, Role } from '@/types/next-auth';

/**
 * Roles whose facility scope spans the whole organisation. `supervisor` is
 * deliberately absent — per the RBAC matrix a supervisor's power is scope, not
 * verbs, so they see only the facilities on their own `OrganizationUserFacility`
 * rows. Worker roles are likewise limited to their own facilities.
 */
const ORG_WIDE_FACILITY_ROLES: readonly Role[] = [
  'owner',
  'admin',
  'hr',
  'clinical_director',
  'finance',
];

/**
 * Whether the role aggregates across the whole organisation. Facility-bound
 * roles (supervisor, workers) must have every query narrowed to the facilities
 * on their assignments — including the org-wide totals of a dashboard, which for
 * them means "total across my facilities", not "total across the org".
 */
export function isOrgWideFacilityRole(role: Role): boolean {
  return ORG_WIDE_FACILITY_ROLES.includes(role);
}

const FACILITY_SELECT = {
  id: true,
  name: true,
  type: true,
  city: true,
} satisfies Prisma.FacilitySelect;

export interface AccessibleFacility {
  id: string;
  name: string;
  type: string | null;
  city: string | null;
}

/**
 * `all` = aggregate across every facility the caller can see; `single` = restrict
 * to the named one. There is no "denied" variant by design — an inaccessible
 * request widens to `all` rather than revealing that the facility exists.
 */
export type FacilityScope = { mode: 'all' } | { mode: 'single'; facility: AccessibleFacility };

/**
 * `compare` extends {@link FacilityScope} with the multi-facility selection the
 * dashboard's scope palette produces. Two or more surviving ids are required —
 * a single survivor is an ordinary single-facility scope, none is org-wide.
 */
export type FacilityScopeSelection =
  | FacilityScope
  | { mode: 'compare'; facilities: AccessibleFacility[] };

/** The session fields this module reads — satisfied by a full NextAuth session. */
type FacilityScopeSession = {
  user: Pick<AuthSession['user'], 'id' | 'role' | 'organizationId' | 'organizationUserId'>;
};

/**
 * Every facility the caller may view, ordered by name. Org-wide roles get all of
 * the organisation's facilities; supervisors and workers get only those on their
 * active facility assignments. Returns an empty list when the session carries no
 * organisation (mid-onboarding) or no membership.
 */
export async function listAccessibleFacilities(
  session: FacilityScopeSession,
): Promise<AccessibleFacility[]> {
  const { organizationId, organizationUserId, role } = session.user;
  if (!organizationId) return [];

  // Tenancy is structural: the org filter is applied unconditionally, so a
  // facility from another tenant can never enter the result set.
  const where: Prisma.FacilityWhereInput = { organizationId };

  if (!isOrgWideFacilityRole(role)) {
    if (!organizationUserId) return [];
    where.userFacilities = { some: { organizationUserId, active: true } };
  }

  return prisma.facility.findMany({
    where,
    select: FACILITY_SELECT,
    orderBy: { name: 'asc' },
  });
}

/**
 * The requested ids that the caller may actually view, in the accessible set's
 * (alphabetical) order. Ids outside that set are dropped silently — the caller
 * must not be able to probe for facilities in another tenant — and logged.
 */
async function accessibleSubset(
  session: FacilityScopeSession,
  requestedIds: string[],
): Promise<AccessibleFacility[]> {
  const accessible = await listAccessibleFacilities(session);
  const requested = new Set(requestedIds);
  const facilities = accessible.filter((facility) => requested.has(facility.id));

  if (facilities.length < requestedIds.length) {
    logger.warn({
      msg: '[facility] Requested facility not accessible — falling back to org scope',
      userId: session.user.id,
      organizationId: session.user.organizationId,
      requestedFacilityId: requestedIds.join(','),
    });
  }

  return facilities;
}

/**
 * Resolve the facility scope for a request. An absent, unknown, foreign or
 * unassigned `requestedFacilityId` falls back to `{ mode: 'all' }` — never an
 * error — so the caller cannot probe for the existence of facilities outside
 * their scope.
 */
export async function resolveFacilityScope(
  session: FacilityScopeSession,
  requestedFacilityId?: string | null,
): Promise<FacilityScope> {
  const requestedIds = parseFacilityScopeParam(requestedFacilityId);
  if (requestedIds.length !== 1) return { mode: 'all' };

  const [facility] = await accessibleSubset(session, requestedIds);
  return facility ? { mode: 'single', facility } : { mode: 'all' };
}

/**
 * Resolve a raw `?facility=` value, which may name several facilities. Widening
 * rules mirror {@link resolveFacilityScope}: whatever survives the accessibility
 * filter decides the mode, and nothing surviving means the org-wide view.
 */
export async function resolveFacilityScopeSelection(
  session: FacilityScopeSession,
  param?: string | string[] | null,
): Promise<FacilityScopeSelection> {
  const requestedIds = parseFacilityScopeParam(param);
  if (requestedIds.length === 0) return { mode: 'all' };

  const facilities = await accessibleSubset(session, requestedIds);

  if (facilities.length === 0) return { mode: 'all' };
  if (facilities.length < MIN_COMPARISON_FACILITIES)
    return { mode: 'single', facility: facilities[0] };
  return { mode: 'compare', facilities };
}
