/**
 * Resource-Based RBAC — Permission & Role Registry
 * -------------------------------------------------------------------------
 * Theraptly uses a Dual-Layer Claims-Based architecture (see `rbac_spec.md`).
 * This file defines the **System Role** layer: the O(1) permission dictionary
 * used for client-side UI visibility and server-side API route enforcement.
 *
 *   permissionsMatrix[user.systemRole].includes('billing.read')  // O(1)-ish check
 *
 * Conventions
 *   - Permissions are flat `"<resource>.<action>"` strings.
 *   - Every primary resource exposes exactly four actions:
 *       create | read | edit | delete
 *   - Secondary / sub-resource tables (Profile, Lesson, CourseModule,
 *     DocumentVersion, PhiReport, QuizAttempt, ManualChunk, MfaFactor, Job …)
 *     are intentionally NOT given their own permissions; access to them is
 *     governed by the permission of their parent primary resource.
 *
 * Scope note
 *   These strings encode *what* action is allowed, not *whose* records.
 *   Row-level scope is enforced separately in the data layer. The tenancy
 *   hierarchy is Organisation → Facility (facilities are a planned sub-unit;
 *   the parent tenant may later be renamed). Scope tiers, widest first:
 *       owner        — organisation-wide (every facility under the org)
 *       supervisor   — single facility only (full access minus billing)
 *       hr/clinical_director/finance/worker — own records / functional area
 *   Where a role is limited in scope it is called out in its `description`
 *   and in the companion `RBAC-Roles-And-Permissions.docx` review document.
 *
 * NOTE FOR REVIEW: This is the proposed default matrix derived from the PRD.
 * Treat it as a starting point — edit freely.
 */

// ── Primary resources under controlled access ───────────────────────────────
export const RESOURCES = [
  'user', // Team roster / staff accounts (incl. role promotion)
  'organization', // Facility (tenant) profile & settings
  'facility', // Physical site/branch under an organisation
  'billing', // Subscriptions, invoices, payment methods
  'course', // Course catalogue & content (modules, lessons, quizzes via parent)
  'enrollment', // Course assignment to a learner + progress/pass-fail tracking
  'assessment', // Quizzes, questions & question-by-question attempt logs
  'certificate', // Issued completion certificates / transcripts
  'document', // Source documents used for AI course generation
  'category', // Course categories / training paths
  'invite', // Pending team invitations
  'assignment', // Org course assignments & auto-enrolment configuration
  'notification', // In-app notifications & reminder preferences
  'auditPack', // Auditor packs & compliance reporting exports
  'standardManual', // Accreditation standard manuals (RAG knowledge base)
] as const;

export type Resource = (typeof RESOURCES)[number];
export type Action = 'create' | 'read' | 'edit' | 'delete';
export type Permission = `${Resource}.${Action}`;

// ── Permission registry (4 entries per primary resource) ────────────────────
// Flat list of every canonical `"<resource>.<action>"` permission string, used
// as the single source of truth for the granted-permission arrays below.
export const permissions: Permission[] = [
  // user
  'user.create',
  'user.read',
  'user.edit',
  'user.delete',

  // organization
  'organization.create',
  'organization.read',
  'organization.edit',
  'organization.delete',

  // facility
  'facility.create',
  'facility.read',
  'facility.edit',
  'facility.delete',

  // billing
  'billing.create',
  'billing.read',
  'billing.edit',
  'billing.delete',

  // course
  'course.create',
  'course.read',
  'course.edit',
  'course.delete',

  // enrollment
  'enrollment.create',
  'enrollment.read',
  'enrollment.edit',
  'enrollment.delete',

  // assessment
  'assessment.create',
  'assessment.read',
  'assessment.edit',
  'assessment.delete',

  // certificate
  'certificate.create',
  'certificate.read',
  'certificate.edit',
  'certificate.delete',

  // document
  'document.create',
  'document.read',
  'document.edit',
  'document.delete',

  // category
  'category.create',
  'category.read',
  'category.edit',
  'category.delete',

  // invite
  'invite.create',
  'invite.read',
  'invite.edit',
  'invite.delete',

  // assignment
  'assignment.create',
  'assignment.read',
  'assignment.edit',
  'assignment.delete',

  // notification
  'notification.create',
  'notification.read',
  'notification.edit',
  'notification.delete',

  // auditPack
  'auditPack.create',
  'auditPack.read',
  'auditPack.edit',
  'auditPack.delete',

  // standardManual
  'standardManual.create',
  'standardManual.read',
  'standardManual.edit',
  'standardManual.delete',
];

// Helper: every action for a resource (keeps the role definitions terse).
const all = (resource: Resource): Permission[] => [
  `${resource}.create`,
  `${resource}.read`,
  `${resource}.edit`,
  `${resource}.delete`,
];

// Full access to every primary resource. Granted to `owner` (organisation-wide,
// including billing). A facility Supervisor gets the same set MINUS billing.
const everything: Permission[] = RESOURCES.flatMap(all);

// Facility-wide access minus billing. `supervisor` oversees a facility but must
// not touch subscriptions/invoices/payment methods — billing.* is reserved for
// `owner` and `finance` only.
const everythingExceptBilling: Permission[] = everything.filter(
  (permission) => !permission.startsWith('billing.'),
);

export interface Role {
  id: string;
  displayName: string;
  description: string;
  permissions: Permission[];
}

export const roles = {
  owner: {
    id: 'owner',
    displayName: 'Owner (Organisation Admin)',
    description:
      'Top-tier tenant seat (CEO, Founder, Practice Owner) — typically the user who created the organisation. Full access to every resource across the ENTIRE organisation, spanning all facilities under it. The widest scope available to a customer; higher than a facility Supervisor.',
    permissions: everything,
  },

  supervisor: {
    id: 'supervisor',
    displayName: 'Supervisor (Facility Admin)',
    description:
      'Facility-level overseer. Full access to every resource EXCEPT billing, scoped to a SINGLE facility (an org branch/location) — enforced at the data layer. Cannot reach other facilities, organisation-wide configuration, or any billing/subscription/payment function (billing is reserved for Owner and Finance). Narrower scope than an organisation Owner.',
    permissions: everythingExceptBilling,
  },

  hr: {
    id: 'hr',
    displayName: 'HR',
    description:
      'Workforce personnel & operational compliance manager. Manages worker details, invites staff, assigns general courses (HIPAA/OSHA) and views broad pass/fail and completion metrics. Blocked from billing, from modifying clinical courses, and from question-by-question assessment scoring.',
    permissions: [
      'user.create',
      'user.read',
      'user.edit',
      'invite.create',
      'invite.read',
      'invite.edit',
      'invite.delete',
      'enrollment.create',
      'enrollment.read',
      'enrollment.edit',
      'assignment.create',
      'assignment.read',
      'assignment.edit',
      'assignment.delete',
      'course.read',
      'certificate.read',
      'category.read',
      'document.read',
      'organization.read',
      'auditPack.create',
      'auditPack.read',
      'notification.create',
      'notification.read',
      'notification.edit',
      'notification.delete',
    ],
  },

  clinicalDirector: {
    id: 'clinical_director',
    displayName: 'Clinical Director',
    description:
      'Clinical quality-assurance & assessment oversight lead. Builds and edits clinical modules/assessments, assigns clinical training paths, and reviews granular, question-by-question assessment logs. Blocked from billing, subscription tiers and HR payroll configuration.',
    permissions: [
      'course.create',
      'course.read',
      'course.edit',
      'course.delete',
      'assessment.create',
      'assessment.read',
      'assessment.edit',
      'assessment.delete',
      'enrollment.create',
      'enrollment.read',
      'enrollment.edit',
      'assignment.create',
      'assignment.read',
      'assignment.edit',
      'assignment.delete',
      'category.create',
      'category.read',
      'category.edit',
      'category.delete',
      'document.create',
      'document.read',
      'document.edit',
      'document.delete',
      'standardManual.read',
      'certificate.read',
      'user.read',
      'organization.read',
      'auditPack.create',
      'auditPack.read',
      'notification.create',
      'notification.read',
      'notification.edit',
      'notification.delete',
    ],
  },

  finance: {
    id: 'finance',
    displayName: 'Finance',
    description:
      'Billing, subscription & financial reporting manager. Manages billing settings, payment methods and invoices, and views their own personal learner transcripts. Blocked from building courses, assigning compliance paths and viewing any worker test metrics.',
    permissions: [
      'billing.create',
      'billing.read',
      'billing.edit',
      'billing.delete',
      'organization.read',
      'user.read',
      'course.read',
      'enrollment.read',
      'certificate.read',
      'auditPack.read',
      'notification.create',
      'notification.read',
      'notification.edit',
      'notification.delete',
    ],
  },
  worker: {
    id: 'worker',
    displayName: 'Worker (Student)',
    description:
      'Default account with zero administrative access. Interface is restricted exclusively to personal training: view the personal dashboard, complete assigned courses, launch assessments and download own certificates. All records are scoped to the user (data-layer enforced). Hard-blocked from every administrative dashboard, roster, metric and setting.',
    permissions: [
      'course.read',
      'enrollment.read',
      'enrollment.edit',
      'assessment.create',
      'assessment.read',
      'certificate.read',
      'notification.read',
      'notification.edit',
      'notification.delete',
    ],
  },
} as const satisfies Record<string, Role>;

export const getRoles = (): Role[] => Object.values(roles);

export type RoleKey = keyof typeof roles;

export function can(role: RoleKey, permission: Permission): boolean {
  return (roles[role].permissions as readonly Permission[]).includes(permission);
}
