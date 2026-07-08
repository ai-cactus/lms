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
 */

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

// Flat list of every canonical `"<resource>.<action>"` permission string, used
// as the single source of truth for the granted-permission arrays below.
export const permissions: Permission[] = [
  'user.create',
  'user.read',
  'user.edit',
  'user.delete',

  'organization.create',
  'organization.read',
  'organization.edit',
  'organization.delete',

  'facility.create',
  'facility.read',
  'facility.edit',
  'facility.delete',

  'billing.create',
  'billing.read',
  'billing.edit',
  'billing.delete',

  'course.create',
  'course.read',
  'course.edit',
  'course.delete',

  'enrollment.create',
  'enrollment.read',
  'enrollment.edit',
  'enrollment.delete',

  'assessment.create',
  'assessment.read',
  'assessment.edit',
  'assessment.delete',

  'certificate.create',
  'certificate.read',
  'certificate.edit',
  'certificate.delete',

  'document.create',
  'document.read',
  'document.edit',
  'document.delete',

  'category.create',
  'category.read',
  'category.edit',
  'category.delete',

  'invite.create',
  'invite.read',
  'invite.edit',
  'invite.delete',

  'assignment.create',
  'assignment.read',
  'assignment.edit',
  'assignment.delete',

  'notification.create',
  'notification.read',
  'notification.edit',
  'notification.delete',

  'auditPack.create',
  'auditPack.read',
  'auditPack.edit',
  'auditPack.delete',

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
  category: 'manager' | 'worker';
  displayName: string;
  description: string;
  permissions: Permission[];
}

// The uniform permission ceiling shared by every worker-category role. All eight
// worker roles are functionally identical at the permission layer — they differ
// only by `category` + `displayName`/`description`. Defined once here so the
// literal set is never duplicated across the role definitions below.
const workerPermissions: Permission[] = [
  'course.read',
  'enrollment.read',
  'enrollment.edit',
  'assessment.create',
  'assessment.read',
  'certificate.read',
  'notification.read',
  'notification.edit',
  'notification.delete',
];

export const roles = {
  owner: {
    id: 'owner',
    category: 'manager',
    displayName: 'Owner (Organisation Admin)',
    description:
      'Top-tier tenant seat (CEO, Founder, Practice Owner) — typically the user who created the organisation. Full access to every resource across the ENTIRE organisation, spanning all facilities under it. The widest scope available to a customer; higher than a facility Supervisor.',
    permissions: everything,
  },

  supervisor: {
    id: 'supervisor',
    category: 'manager',
    displayName: 'Supervisor (Facility Admin)',
    description:
      'Facility-level overseer. Full access to every resource EXCEPT billing, scoped to a SINGLE facility (an org branch/location) — enforced at the data layer. Cannot reach other facilities, organisation-wide configuration, or any billing/subscription/payment function (billing is reserved for Owner and Finance). Narrower scope than an organisation Owner.',
    permissions: everythingExceptBilling,
  },

  hr: {
    id: 'hr',
    category: 'manager',
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
    category: 'manager',
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
    category: 'manager',
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
  psychiatristPrescriber: {
    id: 'psychiatrist_prescriber',
    category: 'worker',
    displayName: 'Psychiatrist / Prescriber',
    description:
      'Prescribing clinician (psychiatrist / medical provider) completing their own assigned training. Zero administrative access — restricted to personal courses, assessments and certificates, all scoped to the user (data-layer enforced).',
    permissions: workerPermissions,
  },

  nurse: {
    id: 'nurse',
    category: 'worker',
    displayName: 'Nurse',
    description:
      'Nursing staff completing their own assigned training. Zero administrative access — restricted to personal courses, assessments and certificates, all scoped to the user (data-layer enforced).',
    permissions: workerPermissions,
  },

  therapistClinician: {
    id: 'therapist_clinician',
    category: 'worker',
    displayName: 'Therapist / Clinician',
    description:
      'Therapist / clinician completing their own assigned training. Zero administrative access — restricted to personal courses, assessments and certificates, all scoped to the user (data-layer enforced).',
    permissions: workerPermissions,
  },

  caseManager: {
    id: 'case_manager',
    category: 'worker',
    displayName: 'Case Manager',
    description:
      'Case manager coordinating client care and completing their own assigned training. Zero administrative access — restricted to personal courses, assessments and certificates, all scoped to the user (data-layer enforced).',
    permissions: workerPermissions,
  },

  behavioralHealthTechnician: {
    id: 'behavioral_health_technician',
    category: 'worker',
    displayName: 'Behavioral Health Technician / Mental Health Associate',
    description:
      'Behavioral health technician / mental health associate completing their own assigned training. Zero administrative access — restricted to personal courses, assessments and certificates, all scoped to the user (data-layer enforced).',
    permissions: workerPermissions,
  },

  peerSupportSpecialist: {
    id: 'peer_support_specialist',
    category: 'worker',
    displayName: 'Peer Support Specialist',
    description:
      'Peer support specialist completing their own assigned training. Zero administrative access — restricted to personal courses, assessments and certificates, all scoped to the user (data-layer enforced).',
    permissions: workerPermissions,
  },

  frontDeskAdmin: {
    id: 'front_desk_admin',
    category: 'worker',
    displayName: 'Front Desk / Administrative Support',
    description:
      'Front desk / administrative support staff completing their own assigned training. Zero administrative access — restricted to personal courses, assessments and certificates, all scoped to the user (data-layer enforced).',
    permissions: workerPermissions,
  },

  facilitiesSupport: {
    id: 'facilities_support',
    category: 'worker',
    displayName: 'Facilities / Support Staff',
    description:
      'Facilities / support staff completing their own assigned training. Zero administrative access — restricted to personal courses, assessments and certificates, all scoped to the user (data-layer enforced).',
    permissions: workerPermissions,
  },
} as const satisfies Record<string, Role>;

export const getRoles = (): Role[] => Object.values(roles);

export type RoleKey = keyof typeof roles;

export function can(role: RoleKey | undefined, permission: Permission): boolean {
  // Unknown/stale role keys (e.g. a JWT minted before a role was retired) map to
  // no entry — treat as least-privilege deny rather than throwing.
  const entry = roles[role as RoleKey];
  if (!entry) return false;
  return (entry.permissions as readonly Permission[]).includes(permission);
}
