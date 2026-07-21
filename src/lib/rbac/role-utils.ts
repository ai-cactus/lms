/**
 * RBAC role utilities — the single home for DB-enum ⇄ RoleKey conversion and
 * for the role-set / grant-matrix helpers used across auth, API routes and UI.
 *
 * DB enum values (`UserRole`) are snake_case: five manager roles (`owner`,
 * `supervisor`, `hr`, `clinical_director`, `finance`) plus eight job-specific
 * worker roles (`psychiatrist_prescriber`, `nurse`, `therapist_clinician`,
 * `case_manager`, `behavioral_health_technician`, `peer_support_specialist`,
 * `front_desk_admin`, `facilities_support`). The `permissions.ts` registry keys
 * (`RoleKey`) match, except multi-word roles are camelCased (e.g.
 * `clinical_director` → `clinicalDirector`). The ONLY place that translates
 * between the two is `dbRoleToRoleKey` below.
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

/** The learner role(s) — every worker-category role shares one permission ceiling. */
export const WORKER_ROLES: readonly Role[] = [
  'psychiatrist_prescriber',
  'nurse',
  'therapist_clinician',
  'case_manager',
  'behavioral_health_technician',
  'peer_support_specialist',
  'front_desk_admin',
  'facilities_support',
];

export const ALL_ROLES: readonly Role[] = [...ADMIN_ROLES, ...WORKER_ROLES];

/**
 * Manager-category roles an owner may invite from the onboarding "Invite your
 * managers" step (and the only roles `completeOnboarding` accepts for a manager
 * invite). Excludes `owner` (established solely at org creation) and every
 * worker role (those are invited as workers, never as managers).
 */
export const MANAGER_INVITE_ROLES: readonly Role[] = [
  'supervisor',
  'hr',
  'clinical_director',
  'finance',
];

/**
 * Fallback worker role used wherever the system must create a worker account or
 * invite without an explicit job category being chosen: self-signup, OAuth
 * sign-in with no invite, invalid-invite-role fallbacks, join-by-code, the
 * onboarding step-4 bulk worker invites, and course-assignment auto-created
 * users. Because all eight worker roles share the identical permission ceiling,
 * this is a low-stakes label — it only affects the displayed job category, never
 * what the account can do; an admin can re-categorise the user afterwards.
 */
export const DEFAULT_SELF_SERVE_WORKER_ROLE: Role = 'front_desk_admin';

const DB_ROLE_TO_ROLE_KEY: Record<Role, RoleKey> = {
  owner: 'owner',
  supervisor: 'supervisor',
  hr: 'hr',
  clinical_director: 'clinicalDirector',
  finance: 'finance',
  psychiatrist_prescriber: 'psychiatristPrescriber',
  nurse: 'nurse',
  therapist_clinician: 'therapistClinician',
  case_manager: 'caseManager',
  behavioral_health_technician: 'behavioralHealthTechnician',
  peer_support_specialist: 'peerSupportSpecialist',
  front_desk_admin: 'frontDeskAdmin',
  facilities_support: 'facilitiesSupport',
};

/**
 * Convert a DB `UserRole` value to the camelCase `RoleKey` used by `can()`.
 * Returns `undefined` for an unknown/stale role value (e.g. a role claim on a
 * JWT minted before that role was retired) — callers must treat that as a deny.
 */
export function dbRoleToRoleKey(role: Role): RoleKey | undefined {
  return DB_ROLE_TO_ROLE_KEY[role];
}

/** Human-readable display name for a DB role value (e.g. for invite emails). */
export function getRoleDisplayName(role: Role): string {
  const roleKey = dbRoleToRoleKey(role);
  // Fall back to the raw DB value for an unknown/stale role rather than throwing.
  return roleKey ? roles[roleKey].displayName : role;
}

// Which roles a given inviter role is allowed to grant. An empty array is a hard
// fence: that role can never invite, even if it somehow held `invite.create`.
// Owner is NON-grantable — it is established only at org creation, so it never
// appears in any grant list (one-owner-per-org).
export const GRANTABLE_ROLES: Record<Role, readonly Role[]> = {
  owner: ['supervisor', 'hr', 'clinical_director', 'finance', ...WORKER_ROLES],
  supervisor: ['supervisor', 'hr', 'clinical_director', 'finance', ...WORKER_ROLES],
  // D1 — HR may grant any role EXCEPT supervisor and owner.
  hr: ['hr', 'clinical_director', 'finance', ...WORKER_ROLES],
  clinical_director: [],
  finance: [],
  psychiatrist_prescriber: [],
  nurse: [],
  therapist_clinician: [],
  case_manager: [],
  behavioral_health_technician: [],
  peer_support_specialist: [],
  front_desk_admin: [],
  facilities_support: [],
};

/**
 * Roles permitted to change another staff member's role in place. Deliberately
 * narrower than the invite-grant matrix: only an organisation Owner or a
 * facility Supervisor may re-role an existing account (HR can invite/edit staff
 * but not re-role them). Owner is intentionally excluded from every
 * {@link GRANTABLE_ROLES} list, so promoting to — or changing — an owner is
 * rejected by {@link canChangeRole} without any special-case here.
 */
export const ROLE_CHANGE_ACTOR_ROLES: readonly Role[] = ['owner', 'supervisor'];

/** Why {@link canChangeRole} denied a role change (maps to caller-facing copy). */
export type RoleChangeDenyReason =
  | 'actor_not_permitted'
  | 'self_change'
  | 'target_not_reachable'
  | 'role_not_grantable';

export interface RoleChangeDecision {
  allowed: boolean;
  reason?: RoleChangeDenyReason;
}

/**
 * Pure guard for an in-place staff role change. Evaluated in order:
 *   1. actor not an Owner/Supervisor        → `actor_not_permitted`
 *   2. actor is the target (self re-role)   → `self_change`
 *   3. target's CURRENT role not grantable  → `target_not_reachable`
 *      (e.g. an owner — owner is in no grant list)
 *   4. requested NEW role not grantable     → `role_not_grantable`
 *      (e.g. owner, or supervisor for an HR actor)
 * No I/O — the caller owns the DB writes, session-kill and audit.
 */
export function canChangeRole(
  actorRole: Role,
  actorId: string,
  targetId: string,
  targetCurrentRole: Role,
  newRole: Role,
): RoleChangeDecision {
  if (!ROLE_CHANGE_ACTOR_ROLES.includes(actorRole)) {
    return { allowed: false, reason: 'actor_not_permitted' };
  }
  if (targetId === actorId) {
    return { allowed: false, reason: 'self_change' };
  }
  const grantable = GRANTABLE_ROLES[actorRole] ?? [];
  if (!grantable.includes(targetCurrentRole)) {
    return { allowed: false, reason: 'target_not_reachable' };
  }
  if (!grantable.includes(newRole)) {
    return { allowed: false, reason: 'role_not_grantable' };
  }
  return { allowed: true };
}

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

/** A single selectable role option inside a {@link RoleSelectGroup}. */
export interface RoleSelectOption {
  value: Role;
  displayName: string;
  /** Registry description — only populated for manager-category roles. */
  description?: string;
}

/** A labelled group of role options for a grouped role <Select>. */
export interface RoleSelectGroup {
  label: 'Managers' | 'Workers / Learners';
  roles: RoleSelectOption[];
}

/**
 * Partition the roles a given inviter may grant into the two display groups used
 * by the staff-invite role picker: manager-category roles under "Managers" and
 * worker-category roles under "Workers / Learners". Ordering within each group
 * follows `GRANTABLE_ROLES[inviterRole]`. Groups with no grantable roles are
 * omitted, so an inviter who can grant nothing yields an empty array.
 */
export function groupRolesForSelect(inviterRole: Role): RoleSelectGroup[] {
  const managers: RoleSelectOption[] = [];
  const workers: RoleSelectOption[] = [];

  for (const role of GRANTABLE_ROLES[inviterRole] ?? []) {
    const roleKey = dbRoleToRoleKey(role);
    const entry = roleKey ? roles[roleKey] : undefined;
    if (!entry) continue;

    if (entry.category === 'manager') {
      managers.push({
        value: role,
        displayName: entry.displayName,
        description: entry.description,
      });
    } else {
      workers.push({ value: role, displayName: entry.displayName });
    }
  }

  const groups: RoleSelectGroup[] = [];
  if (managers.length > 0) groups.push({ label: 'Managers', roles: managers });
  if (workers.length > 0) groups.push({ label: 'Workers / Learners', roles: workers });
  return groups;
}
