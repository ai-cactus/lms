/**
 * Which roles are org-wide rather than facility-bound.
 *
 * Split out of `@/lib/facility/scope` so client components can ask the question
 * without dragging that module's Prisma import into the browser bundle. This
 * file must stay free of server-only imports — it holds the role list and
 * nothing else. `scope.ts` re-exports both symbols, so every existing import
 * site is unaffected.
 */
import type { Role } from '@/types/next-auth';

/**
 * Roles whose facility scope spans the whole organisation. `supervisor` is
 * deliberately absent — per the RBAC matrix a supervisor's power is scope, not
 * verbs, so they see only the facilities on their own `OrganizationUserFacility`
 * rows. Worker roles are likewise limited to their own facilities.
 */
export const ORG_WIDE_FACILITY_ROLES: readonly Role[] = [
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
 *
 * It also answers the inverse question on the staff screens: an org-wide role is
 * not assigned to a facility at all, so "Change Facility" does not apply to one.
 */
export function isOrgWideFacilityRole(role: Role): boolean {
  return ORG_WIDE_FACILITY_ROLES.includes(role);
}
