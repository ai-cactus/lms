/**
 * The page-side authorization choke point.
 *
 * `authorize()` (./authorize.ts) returns a `NextResponse` and is therefore
 * API-route-shaped. Server components need a guard that redirects or 404s, and
 * before D-01 no such thing existed — so pages either hand-rolled an
 * `isAdminRole` check (which admits Finance and Clinical Director) or performed
 * no check at all and relied on the sidebar not linking them. A typed URL walks
 * straight past a hidden link.
 *
 * Both guards resolve their verdict through `evaluatePermission`, so a page and
 * an API route can never disagree about the same permission.
 *
 * Deliberately NOT folded into `@/lib/auth-guard`: that module is intentionally
 * pure and I/O-free (it takes an already-resolved session and touches neither
 * `auth()` nor Prisma), and its `role?: 'admin'` option is the coarse
 * abstraction this replaces.
 *
 * Usage:
 *   const ctx = await requirePermission('user.read');                 // redirects on deny
 *   const ctx = await requirePermission('user.read', { onDeny: 'notFound' });
 *   const ctx = await requirePermissionWithFacilityScope('user.read', facilityParam);
 */
import { notFound, redirect } from 'next/navigation';
import { evaluatePermission } from './authorize';
import type { Permission, RoleKey } from './permissions';
import {
  isOrgWideFacilityRole,
  listAccessibleFacilities,
  resolveFacilityScopeSelection,
  type AccessibleFacility,
  type FacilityScopeSelection,
} from '@/lib/facility/scope';
import type { Role } from '@/types/next-auth';

export interface PageAuthContext {
  userId: string;
  role: Role;
  roleKey: RoleKey;
  organizationId: string | null;
  organizationUserId: string | null;
}

export interface RequirePermissionOptions {
  /** Where an AUTHORIZED-but-denied caller lands. Default `/dashboard`. */
  redirectTo?: string;
  /** Where an UNAUTHENTICATED caller lands. Default `/login`. */
  unauthenticatedRedirectTo?: string;
  /**
   * `redirect` (default) for collection URLs that have no nav entry for this
   * role. `notFound` for id-addressed detail pages, where a 403 would confirm
   * that the id exists — use it wherever the id belongs to someone else.
   */
  onDeny?: 'redirect' | 'notFound';
}

/**
 * Denial is not one case. An unauthenticated caller has somewhere useful to go
 * (`/login`); an authenticated one who lacks the permission does not, and
 * sending them to `/login` would be a confusing dead end. Collapsing the two
 * also bounces a logged-out visitor to `/dashboard`, which then bounces them
 * again.
 */
function deny(
  reason: 'unauthenticated' | 'unknown_role' | 'forbidden',
  options?: RequirePermissionOptions,
): never {
  if (reason === 'unauthenticated') {
    redirect(options?.unauthenticatedRedirectTo ?? '/login');
  }
  if (options?.onDeny === 'notFound') notFound();
  redirect(options?.redirectTo ?? '/dashboard');
}

/**
 * Require a permission in a server component. Throws Next's redirect/notFound
 * control-flow signal on denial — it never returns an unauthorized context, so
 * a caller cannot accidentally continue past a failed check.
 */
export async function requirePermission(
  permission: Permission,
  options?: RequirePermissionOptions,
): Promise<PageAuthContext> {
  const verdict = await evaluatePermission(permission);
  if (!verdict.ok) deny(verdict.reason, options);

  const { userId, role, roleKey, organizationId, organizationUserId } = verdict.ctx;
  return { userId, role, roleKey, organizationId, organizationUserId };
}

/**
 * Soft variant for pages that render an in-page "no access" card rather than
 * navigating away (the Documents Hub convention). Returns; never throws.
 */
export async function checkPermission(
  permission: Permission,
): Promise<{ ok: true; ctx: PageAuthContext } | { ok: false }> {
  const verdict = await evaluatePermission(permission);
  if (!verdict.ok) return { ok: false };

  const { userId, role, roleKey, organizationId, organizationUserId } = verdict.ctx;
  return { ok: true, ctx: { userId, role, roleKey, organizationId, organizationUserId } };
}

export interface ScopedPageAuthContext extends PageAuthContext {
  orgWide: boolean;
  /** Everything the caller may view, ordered by name — feeds the facility picker. */
  accessibleFacilities: AccessibleFacility[];
  scope: FacilityScopeSelection;
  /**
   * The URL-selected ids (`[]` when the selection is "all"). This is VIEW STATE
   * — which chip is lit. It is not a security boundary and must never be passed
   * to a query. Use {@link ScopedPageAuthContext.dataFacilityIds} for that.
   */
  selectedFacilityIds: string[];
  /**
   * THE ONLY VALUE A DATA QUERY MAY USE.
   *
   *   null     → apply no facility predicate.
   *   string[] → narrow to exactly these ids. May be empty, which means
   *              "see nothing" — never "see everything".
   *
   * Invariant: `null` ⟺ (`orgWide` && the selection is "all"). A facility-bound
   * role ALWAYS receives an array, whatever the URL says.
   */
  dataFacilityIds: string[] | null;
}

/**
 * Require a permission AND resolve facility scope in one call, so a page cannot
 * obtain the verb without also obtaining the scope.
 */
export async function requirePermissionWithFacilityScope(
  permission: Permission,
  facilityParam?: string | string[] | null,
  options?: RequirePermissionOptions,
): Promise<ScopedPageAuthContext> {
  const ctx = await requirePermission(permission, options);

  const session = {
    user: {
      id: ctx.userId,
      role: ctx.role,
      organizationId: ctx.organizationId,
      organizationUserId: ctx.organizationUserId,
    },
  };

  const [scope, accessibleFacilities] = await Promise.all([
    resolveFacilityScopeSelection(session, facilityParam ?? null),
    listAccessibleFacilities(session),
  ]);

  const selectedFacilityIds =
    scope.mode === 'single'
      ? [scope.facility.id]
      : scope.mode === 'compare'
        ? scope.facilities.map((facility) => facility.id)
        : [];

  const orgWide = isOrgWideFacilityRole(ctx.role);

  // The invariant. An org-wide role viewing "all" is the ONLY case that yields
  // null; a facility-bound role always gets an array, and an explicit selection
  // narrows further. Never widen an empty selection to null.
  const dataFacilityIds =
    selectedFacilityIds.length > 0
      ? selectedFacilityIds
      : orgWide
        ? null
        : accessibleFacilities.map((facility) => facility.id);

  return {
    ...ctx,
    orgWide,
    accessibleFacilities,
    scope,
    selectedFacilityIds,
    dataFacilityIds,
  };
}
