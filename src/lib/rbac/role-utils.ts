/**
 * RBAC role utilities — the single home for DB-enum ⇄ RoleKey conversion and
 * for the role-set / grant-matrix helpers used across auth, API routes and UI.
 *
 * DB enum values (`UserRole`) are snake_case: `owner`, `supervisor`, `hr`,
 * `clinical_director`, `finance`, `worker`. The `permissions.ts` registry keys
 * (`RoleKey`) match, except `clinical_director` → `clinicalDirector`. The ONLY
 * place that translates between the two is `dbRoleToRoleKey` below.
 *
 * This module re-exports only from the pure `permissions.ts` registry, so it is
 * safe to import from client components.
 */
import { roles, type RoleKey } from './permissions';
import type { Role } from '@/types/next-auth';

// Typed as `readonly Role[]` (not narrow tuples) so `.includes(someRole)` accepts
// any `Role` at the call sites without triggering the literal-tuple narrowing.
/** Every administrative (non-worker) role. */
export const ADMIN_ROLES: readonly Role[] = [
  'owner',
  'supervisor',
  'hr',
  'clinical_director',
  'finance',
];

/** The learner role(s). */
export const WORKER_ROLES: readonly Role[] = ['worker'];

export const ALL_ROLES: readonly Role[] = [...ADMIN_ROLES, ...WORKER_ROLES];

const DB_ROLE_TO_ROLE_KEY: Record<Role, RoleKey> = {
  owner: 'owner',
  supervisor: 'supervisor',
  hr: 'hr',
  clinical_director: 'clinicalDirector',
  finance: 'finance',
  worker: 'worker',
};

/** Convert a DB `UserRole` value to the camelCase `RoleKey` used by `can()`. */
export function dbRoleToRoleKey(role: Role): RoleKey {
  return DB_ROLE_TO_ROLE_KEY[role];
}

/** Human-readable display name for a DB role value (e.g. for invite emails). */
export function getRoleDisplayName(role: Role): string {
  return roles[dbRoleToRoleKey(role)].displayName;
}

// Which roles a given inviter role is allowed to grant. An empty array is a hard
// fence: that role can never invite, even if it somehow held `invite.create`.
// Owner is NON-grantable — it is established only at org creation, so it never
// appears in any grant list (one-owner-per-org).
export const GRANTABLE_ROLES: Record<Role, readonly Role[]> = {
  owner: ['supervisor', 'hr', 'clinical_director', 'finance', 'worker'],
  supervisor: ['supervisor', 'hr', 'clinical_director', 'finance', 'worker'],
  // D1 — HR may grant any role EXCEPT supervisor and owner.
  hr: ['hr', 'clinical_director', 'finance', 'worker'],
  clinical_director: [],
  finance: [],
  worker: [],
};

// Accept `unknown`/loosely-typed role values so callers holding a `string`,
// `UserRole` or `Role` can use them uniformly without casts at every call site.
/** True when the value is any administrative (non-worker) role. */
export function isAdminRole(role: string | null | undefined): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role ?? '');
}

/** True when the value is a worker (learner) role. */
export function isWorkerRole(role: string | null | undefined): boolean {
  return (WORKER_ROLES as readonly string[]).includes(role ?? '');
}
