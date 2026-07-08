/**
 * Read-only "System roles — platform access" matrix shown on Settings → Roles.
 *
 * The registry (`permissions.ts`) is the single source of truth: every row's
 * cell is computed live via `can(roleKey, permission)`, so the matrix can never
 * drift from the actual RBAC rules. Where the design mock and the registry
 * disagree, the registry wins by design — this config maps each human-readable
 * row to the *closest real permission*, it does not hand-encode the mock.
 */
import { can, type Permission, type RoleKey } from './permissions';

export type MatrixSection = 'NAVIGATION' | 'ACTIONS & DATA';

export interface MatrixColumn {
  key: RoleKey;
  label: string;
}

export interface MatrixRow {
  section: MatrixSection;
  label: string;
  /** True when the given role can see this section / perform this action. */
  check: (roleKey: RoleKey) => boolean;
}

/**
 * Representative worker role for the single "Student" column. All eight
 * worker-category roles share one identical permission ceiling, so any of them
 * reflects the worker row accurately — we use the self-serve default.
 */
export const STUDENT_COLUMN_ROLE: RoleKey = 'frontDeskAdmin';

export const MATRIX_COLUMNS: MatrixColumn[] = [
  { key: 'owner', label: 'Owner' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'hr', label: 'HR' },
  { key: 'clinicalDirector', label: 'Clinical Director' },
  { key: 'finance', label: 'Finance' },
  { key: STUDENT_COLUMN_ROLE, label: 'Student' },
];

const perm =
  (permission: Permission) =>
  (roleKey: RoleKey): boolean =>
    can(roleKey, permission);

export const MATRIX_ROWS: MatrixRow[] = [
  // ── NAVIGATION ──────────────────────────────────────────────────────────────
  // Admin dashboard access — every manager holds `user.read`, no worker does.
  { section: 'NAVIGATION', label: 'Dashboard', check: perm('user.read') },
  { section: 'NAVIGATION', label: 'Documents', check: perm('document.read') },
  { section: 'NAVIGATION', label: 'Courses', check: perm('course.read') },
  // Staff roster section — gated by the same roster-read permission.
  { section: 'NAVIGATION', label: 'Staff Management', check: perm('user.read') },
  { section: 'NAVIGATION', label: 'Billing', check: perm('billing.read') },
  // Settings has no dedicated permission in the registry; it is owner-only by
  // product decision (only the org owner may manage facility + team access).
  { section: 'NAVIGATION', label: 'Settings', check: (roleKey) => roleKey === 'owner' },

  // ── ACTIONS & DATA ──────────────────────────────────────────────────────────
  { section: 'ACTIONS & DATA', label: 'Manage staff roster', check: perm('user.edit') },
  { section: 'ACTIONS & DATA', label: 'Invite & change user roles', check: perm('invite.create') },
  { section: 'ACTIONS & DATA', label: 'Build & edit courses', check: perm('course.create') },
  { section: 'ACTIONS & DATA', label: 'Assign general courses', check: perm('assignment.create') },
  // The registry has no general-vs-clinical split for course assignment, so both
  // assignment rows resolve against the same `assignment.create` permission.
  { section: 'ACTIONS & DATA', label: 'Assign clinical paths', check: perm('assignment.create') },
  {
    section: 'ACTIONS & DATA',
    label: 'Author clinical assessments',
    // `assessment.edit` = authoring assessment content (workers only get
    // create/read for their own attempts, so they are correctly excluded).
    check: perm('assessment.edit'),
  },
  {
    section: 'ACTIONS & DATA',
    label: 'View question-level scores',
    check: perm('assessment.read'),
  },
  // "enrollment" models progress / pass-fail tracking — i.e. completion metrics.
  { section: 'ACTIONS & DATA', label: 'View completion metrics', check: perm('enrollment.read') },
  { section: 'ACTIONS & DATA', label: 'Manage billing & invoices', check: perm('billing.edit') },
  {
    section: 'ACTIONS & DATA',
    label: 'Create & switch facilities',
    check: perm('facility.create'),
  },
];
