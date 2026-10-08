/**
 * Which invite path a role belongs to: a Global invite (no facility) or an
 * invite to one specific facility.
 *
 * Org-wide roles see every facility, so binding one to a site at invite time
 * means nothing; facility-bound roles (supervisor, workers) see only the
 * facilities on their own assignments, so a Global invite would leave them
 * anchored to an arbitrary site. The client picker and `createInvites` both read
 * this one rule. Kept free of server-only imports so the invite modal can use it.
 */
import type { Role } from '@/types/next-auth';
import { isOrgWideFacilityRole } from './org-wide-roles';
import { getRoleDisplayName } from '@/lib/rbac/role-utils';

export type InvitePath = 'global' | 'facility';

export function invitePathForRole(role: Role): InvitePath {
  return isOrgWideFacilityRole(role) ? 'global' : 'facility';
}

/** The subset of `grantable` an invite on `path` may offer, in the same order. */
export function rolesForInvitePath(path: InvitePath, grantable: readonly Role[]): Role[] {
  return grantable.filter((role) => invitePathForRole(role) === path);
}

export function checkInviteRolePath(
  role: Role,
  path: InvitePath,
): { ok: true } | { ok: false; message: string } {
  if (invitePathForRole(role) === path) return { ok: true };
  const displayName = getRoleDisplayName(role);
  return path === 'global'
    ? { ok: false, message: `${displayName} must be invited to a specific facility.` }
    : { ok: false, message: `${displayName} is organization-wide — invite with Global.` };
}
