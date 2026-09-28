import { can, type Permission } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';

/**
 * Which admin-portal links a notification recipient can actually open (Q-25,
 * ruled 2026-09-28: narrow the audience).
 *
 * Admin-tier notices fan out by ROLE, but the pages they link to gate on a
 * PERMISSION the admin tier does not uniformly hold, and both deny with
 * `notFound()` (Q26). A notice whose link 404s for its reader is noise at best,
 * so each one goes only to the members holding what its link needs. The
 * `/dashboard` home and every other link not listed here are open to the whole
 * admin tier and narrow nothing.
 */
const LINK_PERMISSIONS: readonly { path: string; permission: Permission }[] = [
  // Staff directory and profiles: not Clinical Director, not Finance.
  { path: '/dashboard/staff', permission: 'user.read' },
  // Status Tracker: not Finance.
  { path: '/dashboard/status-tracker', permission: 'assignment.read' },
];

/**
 * What each reminder escalation's link asks of its reader. The ladder's
 * COMPLIANCE_ESCALATION opens the Status Tracker; the ADMIN_REASSIGN nudge's
 * QUIZ_RETRY_LIMIT_REACHED opens the learner's staff profile. Named constants
 * because the cycle summary must reach the same audience by email without a
 * link of its own to derive it from; pinned against {@link permissionForLink}
 * in the tests so the two cannot drift.
 */
export const LADDER_ESCALATION_PERMISSION: Permission = 'assignment.read';
export const REASSIGN_ESCALATION_PERMISSION: Permission = 'user.read';

/** The permission a link requires of its reader, or null when it requires none beyond the tier. */
export function permissionForLink(linkUrl: string | null | undefined): Permission | null {
  if (!linkUrl) return null;
  // A whole path segment only, so `/dashboard/staffing` would not match.
  const match = LINK_PERMISSIONS.find(({ path }) => {
    if (!linkUrl.startsWith(path)) return false;
    const rest = linkUrl.slice(path.length);
    return rest === '' || /^[/?#]/.test(rest);
  });
  return match?.permission ?? null;
}

/** Whether a member with `role` holds `permission`; a null permission admits everyone. */
export function roleHolds(role: Role, permission: Permission | null): boolean {
  return permission === null || can(dbRoleToRoleKey(role), permission);
}

/** Whether a member with `role` can open `linkUrl`. */
export function roleMayOpenLink(role: Role, linkUrl: string | null | undefined): boolean {
  return roleHolds(role, permissionForLink(linkUrl));
}
