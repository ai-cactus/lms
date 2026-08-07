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
 * Resolve the facility scope for a request. An absent, unknown, foreign or
 * unassigned `requestedFacilityId` falls back to `{ mode: 'all' }` — never an
 * error — so the caller cannot probe for the existence of facilities outside
 * their scope.
 */
export async function resolveFacilityScope(
  session: FacilityScopeSession,
  requestedFacilityId?: string | null,
): Promise<FacilityScope> {
  if (!requestedFacilityId) return { mode: 'all' };

  const accessible = await listAccessibleFacilities(session);
  const facility = accessible.find((f) => f.id === requestedFacilityId);

  if (!facility) {
    logger.warn({
      msg: '[facility] Requested facility not accessible — falling back to org scope',
      userId: session.user.id,
      organizationId: session.user.organizationId,
      requestedFacilityId,
    });
    return { mode: 'all' };
  }

  return { mode: 'single', facility };
}
