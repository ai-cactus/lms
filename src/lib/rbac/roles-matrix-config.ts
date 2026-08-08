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
 * Representative worker role. All eight worker-category roles share one
 * identical permission ceiling, so any of them reflects worker access
 * accurately — we use the self-serve default. No longer a matrix column (the
 * RBAC matrix covers admin-tier roles only) but still the canonical stand-in
 * when worker access needs to be evaluated.
 */
export const STUDENT_COLUMN_ROLE: RoleKey = 'frontDeskAdmin';

// Column order mirrors the RBAC matrix (the single source of truth). Worker /
// learner roles are deliberately absent: the matrix governs the admin tier only,
// and every worker role shares one unchanged permission ceiling.
export const MATRIX_COLUMNS: MatrixColumn[] = [
  { key: 'owner', label: 'Owner' },
  { key: 'admin', label: 'Admin' },
  { key: 'hr', label: 'HR' },
  { key: 'finance', label: 'Finance' },
  { key: 'clinicalDirector', label: 'Clinical Director' },
  { key: 'supervisor', label: 'Facility Supervisor' },
];

const perm =
  (permission: Permission) =>
  (roleKey: RoleKey): boolean =>
    can(roleKey, permission);

export const MATRIX_ROWS: MatrixRow[] = [
  // ── NAVIGATION ──────────────────────────────────────────────────────────────
  // Every role — managers AND workers — gets a dashboard; the content differs by
  // role but visibility is universal (product decision overriding the design
  // mock's Student "—").
  { section: 'NAVIGATION', label: 'Dashboard', check: () => true },
  { section: 'NAVIGATION', label: 'Documents', check: perm('document.read') },
  { section: 'NAVIGATION', label: 'Courses', check: perm('course.read') },
  // The Status Tracker lists staff-wide training-assignment deadlines (design:
  // admin-usertype only; Finance is blocked from worker metrics), so it keys off
  // roster-wide assignment visibility — owner/supervisor/hr/clinical_director only.
  { section: 'NAVIGATION', label: 'Status Tracker', check: perm('assignment.read') },
  // Staff roster section — gated by the same roster-read permission.
  { section: 'NAVIGATION', label: 'Staff Management', check: perm('user.read') },
  { section: 'NAVIGATION', label: 'Billing', check: perm('billing.read') },
  { section: 'NAVIGATION', label: 'Audits', check: perm('audit.read') },
  // Facility + team-access settings are an org-level mutation, so Settings keys
  // off `organization.edit` — which the registry grants only to the
  // Owner-equivalent seats (Owner, Admin).
  { section: 'NAVIGATION', label: 'Settings', check: perm('organization.edit') },
  // Help is available to every authenticated user.
  { section: 'NAVIGATION', label: 'Help Center', check: () => true },

  // ── ACTIONS & DATA ──────────────────────────────────────────────────────────
  { section: 'ACTIONS & DATA', label: 'Manage staff roster', check: perm('user.edit') },
  { section: 'ACTIONS & DATA', label: 'Invite & change user roles', check: perm('invite.create') },
  { section: 'ACTIONS & DATA', label: 'Build & edit courses', check: perm('course.create') },
  { section: 'ACTIONS & DATA', label: 'Assign general courses', check: perm('assignment.create') },
  // The registry has no general-vs-clinical split for course assignment, so both
  // assignment rows resolve against the same `assignment.create` permission.
  { section: 'ACTIONS & DATA', label: 'Assign clinical paths', check: perm('assignment.create') },
  { section: 'ACTIONS & DATA', label: 'Delete documents', check: perm('document.delete') },
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

/**
 * Sidebar module-visibility helper: resolves a NAVIGATION row by its label and
 * returns its live registry check for the given role. Unknown labels deny
 * (least privilege) rather than defaulting to visible.
 */
export function canAccessModule(roleKey: RoleKey, label: string): boolean {
  const row = MATRIX_ROWS.find((r) => r.section === 'NAVIGATION' && r.label === label);
  if (!row) return false;
  return row.check(roleKey);
}
