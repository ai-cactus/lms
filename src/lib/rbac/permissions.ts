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
  'audit', // Audits module — the compliance audit trail / audit reports
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

  'audit.create',
  'audit.read',
  'audit.edit',
  'audit.delete',

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

// Full access to every primary resource. Granted to `owner` and `admin`, which
// the RBAC matrix defines as Owner-equivalent (CRUD everywhere, incl. billing).
const everything: Permission[] = RESOURCES.flatMap(all);

// Read on every primary resource EXCEPT billing, with no write verbs anywhere.
// Billing is excluded outright rather than merely un-writable: the RBAC matrix
// gives Facility Supervisor no billing column at all, so even visibility of
// subscriptions/invoices/payment methods is withheld.
const readEverythingExceptBilling: Permission[] = RESOURCES.filter(
  (resource) => resource !== 'billing',
).map((resource) => `${resource}.read` as Permission);

// Personal, self-service actions every account holds regardless of tier:
// progressing one's OWN enrollment, submitting one's OWN quiz attempt, and
// managing one's OWN notifications. These are not administrative verbs, so a
// read-only admin role keeps them (otherwise Learn Mode would be unusable).
const selfServicePermissions: Permission[] = [
  'enrollment.edit',
  'assessment.create',
  'notification.create',
  'notification.edit',
  'notification.delete',
];

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
  'organization.read',
  'facility.read',
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

  admin: {
    id: 'admin',
    category: 'manager',
    displayName: 'Admin',
    description:
      'Full-access organisation administrator. Owner-equivalent CRUD across every resource including billing, spanning all facilities under the organisation. Differs from Owner only in that Owner is established at org creation and can never be granted or revoked, whereas Admin is a role an Owner delegates.',
    permissions: everything,
  },

  supervisor: {
    id: 'supervisor',
    category: 'manager',
    displayName: 'Facility Supervisor',
    description:
      'Facility-level overseer. READ-ONLY on documents, courses, staff and audits — a supervisor’s power is SCOPE, not verbs: their read access spans the facilities assigned to them (OrganizationUserFacility), enforced at the data layer. May generate an auditor pack, but only over that same facility scope. Cannot create or edit facilities, cannot change staff roles, and has no billing access whatsoever.',
    permissions: [
      ...readEverythingExceptBilling,
      ...selfServicePermissions,
      // Team QA 2026-08-22 finding #17 reads "when downloading an audit report
      // for courses, all courses are listed, but the data in the export should
      // be limited to the facility" — it asks for the DATA to be scoped, not
      // for the capability to be removed. The team's expected behaviour is the
      // platform direction, so the registry moves to meet it.
      //
      // This is consistent with the role's own principle above: producing a
      // report over records you may already read is a matter of scope, not of
      // privilege. The facility narrowing that makes it safe ships in the same
      // commit — never grant this without it.
      'auditPack.create',
    ],
  },

  hr: {
    id: 'hr',
    category: 'manager',
    displayName: 'HR',
    description:
      'Workforce personnel & operational compliance manager. Full CRUD over staff, documents and courses; invites staff, assigns training paths and views broad pass/fail and completion metrics. Reads the audit trail but cannot alter it. Blocked from billing and from question-by-question assessment scoring.',
    permissions: [
      'user.create',
      'user.read',
      'user.edit',
      'user.delete',
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
      'course.create',
      'course.read',
      'course.edit',
      'course.delete',
      'certificate.read',
      'category.read',
      'document.create',
      'document.read',
      'document.edit',
      'document.delete',
      'organization.read',
      'facility.read',
      'audit.read',
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
      'Clinical quality-assurance & assessment oversight lead. Builds and edits clinical modules/assessments, assigns clinical training paths, and reviews granular, question-by-question assessment logs. Creates and edits documents but cannot DELETE them (deletion is reserved for Owner/Admin/HR). Reads the audit trail. Has no Staff Management access at all, and is blocked from billing and subscription tiers.',
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
      // Documents CRU — delete is deliberately withheld per the RBAC matrix.
      'document.create',
      'document.read',
      'document.edit',
      'standardManual.read',
      'certificate.read',
      'organization.read',
      'facility.read',
      'audit.read',
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
      'Billing, subscription & financial reporting manager. Manages billing settings, payment methods and invoices, and views their own personal learner transcripts. Blocked from Staff Management, from the audit trail, from building courses, from assigning compliance paths and from viewing any worker test metrics.',
    permissions: [
      'billing.create',
      'billing.read',
      'billing.edit',
      'billing.delete',
      'organization.read',
      'facility.read',
      'course.read',
      'enrollment.read',
      'certificate.read',
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
