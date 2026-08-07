/**
 * QA data seed — pagination + empty-state fixtures.
 *
 * Creates two additional organizations alongside the standard `prisma/seed.ts`
 * fixtures, purely for MANUAL QA of the dashboard UI:
 *
 *   1. "QA Pagination Org" — deliberately data-rich (30+ staff, 30+ documents,
 *      16 text courses, 16 global video courses, 60+ enrollments with varied
 *      deadlines) so every list on the dashboard paginates past page 1.
 *   2. "QA Empty Org"      — org + subscription + a single admin and nothing
 *      else, so every empty state can be exercised.
 *
 * Idempotent: every row is upserted by a fixed, deterministic UUID (see `uid`),
 * so re-running never duplicates data. It never deletes rows it does not own and
 * never touches the `prisma/seed.ts` fixtures.
 *
 * Run:  npx tsx scripts/seed-qa-orgs.ts
 *
 * The video courses reference a single sample MP4 uploaded once to the storage
 * bucket. The upload is skipped when the object already exists, and a storage
 * outage degrades to "rows seeded, playback unavailable" rather than failing.
 *
 * NOTE: like `prisma/seed.ts`, this script builds its own PrismaClient (relative
 * import of the generated client + pg adapter) because tsx executes it directly
 * and does not resolve the app's `@/*` tsconfig path aliases. It is NOT part of
 * the app runtime, so the structured-logger convention does not apply — progress
 * is written with plain process.stdout.
 */

import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { Client as MinioClient } from 'minio';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { EnrollmentStatus, UserRole } from '../generated/prisma/enums';
import { BCRYPT_COST } from '../src/lib/bcrypt-config';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ── Credentials ──────────────────────────────────────────────────────────────
const PAGINATION_ADMIN_EMAIL = 'qa.admin@paginationqa.test';
const PAGINATION_ADMIN_PASSWORD = 'QaPagination123!';
const EMPTY_ADMIN_EMAIL = 'qa.admin@emptyqa.test';
const EMPTY_ADMIN_PASSWORD = 'QaEmptyOrg123!';
const STAFF_PASSWORD = 'QaStaffMember123!';

const PAGINATION_ORG_SLUG = 'qa-pagination-org';
const EMPTY_ORG_SLUG = 'qa-empty-org';

// The platform identity that owns every global video course, and its
// dedicated home organization (mirrors src/lib/video/system-user.ts, which
// this script cannot import via `@/`). `Course.creator` is an
// `OrganizationUser`, so the system identity needs an org to belong to.
const SYSTEM_USER_EMAIL = 'system@theraptly.internal';
const SYSTEM_ORG_SLUG = 'system';
const SYSTEM_ORG_NAME = 'System';

// ── Video sample ─────────────────────────────────────────────────────────────
const VIDEO_SOURCE_URL =
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4';
const VIDEO_OBJECT_KEY = 'system/videos/qa-seed-sample-360p.mp4';
const VIDEO_DURATION_SECONDS = 10;
const MINIO_BUCKET = process.env.MINIO_BUCKET ?? 'lms-documents';
const VIDEO_STORAGE_URI = `minio://${MINIO_BUCKET}/${VIDEO_OBJECT_KEY}`;

// ── Deterministic identifiers ────────────────────────────────────────────────
/**
 * Builds a stable, RFC-4122-shaped UUID from a group + index pair so every row
 * this script writes has a fixed primary key and the whole seed stays
 * idempotent. The `a5` prefix namespaces these rows away from the hand-picked
 * UUIDs in `prisma/seed.ts`.
 */
function uid(group: number, index: number): string {
  const g = group.toString(16).padStart(4, '0');
  const i = index.toString(16).padStart(12, '0');
  return `a5000000-${g}-4000-8000-${i}`;
}

const G = {
  org: 0x01,
  facility: 0x02,
  subscription: 0x03,
  user: 0x04,
  invite: 0x05,
  document: 0x06,
  documentVersion: 0x07,
  textCourse: 0x08,
  module: 0x09,
  lesson: 0x0a,
  quiz: 0x0b,
  question: 0x0c,
  videoCourse: 0x0d,
  videoLesson: 0x0e,
  videoQuiz: 0x0f,
  videoQuestion: 0x10,
  offering: 0x11,
  assignment: 0x12,
  enrollment: 0x13,
  certificate: 0x14,
  courseVersion: 0x15,
  notification: 0x16,
  showcaseEnrollment: 0x17,
  showcaseCertificate: 0x18,
} as const;

const PAGINATION_ORG_ID = uid(G.org, 1);
const EMPTY_ORG_ID = uid(G.org, 2);
const PAGINATION_ADMIN_ID = uid(G.user, 0);
const EMPTY_ADMIN_ID = uid(G.user, 999);

function log(message: string): void {
  process.stdout.write(`[seed-qa] ${message}\n`);
}

function warn(message: string): void {
  process.stdout.write(`[seed-qa] WARN ${message}\n`);
}

async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

const MS_PER_DAY = 86_400_000;

function daysFromNow(now: Date, days: number): Date {
  return new Date(now.getTime() + days * MS_PER_DAY);
}

interface SeedMembershipInput {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  jobTitle?: string;
  managerId?: string | null;
  /** Backdates both User.createdAt and OrganizationUser.joinedAt on first create only. */
  createdAt?: Date;
  /** Set on first create only — mirrors the original script never resetting it on re-run. */
  lastLoginAt?: Date | null;
}

/**
 * Upserts the global `User` identity, its `OrganizationUser` membership, and
 * that membership's `OrganizationUserFacility` row — the three rows every
 * seeded staff member needs under the multi-org model.
 */
async function upsertOrgUser(
  input: SeedMembershipInput,
  organizationId: string,
  facilityId: string,
) {
  const fullName = `${input.firstName} ${input.lastName}`;
  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      password: input.password,
      emailVerified: true,
      mfaEnabled: false,
      passwordResetRequired: false,
      firstName: input.firstName,
      lastName: input.lastName,
      fullName,
    },
    create: {
      id: input.id,
      email: input.email,
      password: input.password,
      emailVerified: true,
      mfaEnabled: false,
      authProvider: 'credentials',
      firstName: input.firstName,
      lastName: input.lastName,
      fullName,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });

  const membership = await prisma.organizationUser.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId } },
    update: {
      role: input.role,
      active: true,
      deactivatedAt: null,
      ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
      ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
    },
    create: {
      userId: user.id,
      organizationId,
      role: input.role,
      jobTitle: input.jobTitle ?? null,
      managerId: input.managerId ?? null,
      lastLoginAt: input.lastLoginAt ?? null,
      ...(input.createdAt ? { joinedAt: input.createdAt } : {}),
    },
  });

  await prisma.organizationUserFacility.upsert({
    where: { organizationUserId_facilityId: { organizationUserId: membership.id, facilityId } },
    update: { active: true, deactivatedAt: null },
    create: { organizationUserId: membership.id, facilityId },
  });

  return { user, membership };
}

/**
 * Idempotently returns the `OrganizationUser` membership for the platform's
 * internal "System" identity, which authors all global (`isGlobal`) video
 * courses. Mirrors `getOrCreateSystemUser` in src/lib/video/system-user.ts,
 * which this script cannot import via `@/`.
 */
async function getOrCreateSystemMembership() {
  const user = await prisma.user.upsert({
    where: { email: SYSTEM_USER_EMAIL },
    update: {},
    create: {
      email: SYSTEM_USER_EMAIL,
      // Never logs in: a non-bcrypt string can never match bcrypt.compare.
      password: 'qa-seed-system-user-never-logs-in',
      emailVerified: true,
    },
  });

  const organization = await prisma.organization.upsert({
    where: { slug: SYSTEM_ORG_SLUG },
    update: {},
    create: { name: SYSTEM_ORG_NAME, slug: SYSTEM_ORG_SLUG },
  });

  // No facility row: this membership authors global courses and never
  // carries facility scope.
  return prisma.organizationUser.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
    update: {},
    create: { userId: user.id, organizationId: organization.id, role: 'admin' },
  });
}

// ── Fixture data ─────────────────────────────────────────────────────────────
interface StaffSeed {
  firstName: string;
  lastName: string;
  role: UserRole;
  jobTitle: string;
}

const STAFF: StaffSeed[] = [
  { firstName: 'Amara', lastName: 'Okafor', role: 'supervisor', jobTitle: 'Program Supervisor' },
  { firstName: 'Daniel', lastName: 'Whitfield', role: 'hr', jobTitle: 'HR Business Partner' },
  {
    firstName: 'Priya',
    lastName: 'Raghavan',
    role: 'clinical_director',
    jobTitle: 'Clinical Director',
  },
  { firstName: 'Marcus', lastName: 'Delgado', role: 'finance', jobTitle: 'Finance Manager' },
  {
    firstName: 'Elena',
    lastName: 'Vasquez',
    role: 'psychiatrist_prescriber',
    jobTitle: 'Staff Psychiatrist',
  },
  {
    firstName: 'Jonah',
    lastName: 'Bennett',
    role: 'psychiatrist_prescriber',
    jobTitle: 'Nurse Practitioner',
  },
  { firstName: 'Grace', lastName: 'Lindqvist', role: 'nurse', jobTitle: 'Registered Nurse' },
  { firstName: 'Tobias', lastName: 'Nakamura', role: 'nurse', jobTitle: 'Charge Nurse' },
  { firstName: 'Ruth', lastName: 'Adeyemi', role: 'nurse', jobTitle: 'Licensed Practical Nurse' },
  {
    firstName: 'Callum',
    lastName: 'Fitzgerald',
    role: 'therapist_clinician',
    jobTitle: 'Licensed Therapist',
  },
  {
    firstName: 'Sofia',
    lastName: 'Moreau',
    role: 'therapist_clinician',
    jobTitle: 'Family Therapist',
  },
  {
    firstName: 'Desmond',
    lastName: 'Aliyu',
    role: 'therapist_clinician',
    jobTitle: 'Substance Use Counselor',
  },
  {
    firstName: 'Harriet',
    lastName: 'Stavros',
    role: 'therapist_clinician',
    jobTitle: 'Group Therapy Lead',
  },
  { firstName: 'Ivan', lastName: 'Petrov', role: 'case_manager', jobTitle: 'Senior Case Manager' },
  { firstName: 'Nadia', lastName: 'Haddad', role: 'case_manager', jobTitle: 'Case Manager' },
  { firstName: 'Owen', lastName: 'Brannigan', role: 'case_manager', jobTitle: 'Intake Coordinator' },
  {
    firstName: 'Leila',
    lastName: 'Chowdhury',
    role: 'case_manager',
    jobTitle: 'Discharge Planner',
  },
  {
    firstName: 'Beatrice',
    lastName: 'Ortega',
    role: 'behavioral_health_technician',
    jobTitle: 'Behavioral Health Tech',
  },
  {
    firstName: 'Emeka',
    lastName: 'Nwosu',
    role: 'behavioral_health_technician',
    jobTitle: 'Behavioral Health Tech',
  },
  {
    firstName: 'Ingrid',
    lastName: 'Solberg',
    role: 'behavioral_health_technician',
    jobTitle: 'Residential Aide',
  },
  {
    firstName: 'Rafael',
    lastName: 'Cabrera',
    role: 'behavioral_health_technician',
    jobTitle: 'Milieu Technician',
  },
  {
    firstName: 'Yasmin',
    lastName: 'Karimi',
    role: 'peer_support_specialist',
    jobTitle: 'Peer Support Specialist',
  },
  {
    firstName: 'Colin',
    lastName: 'MacGregor',
    role: 'peer_support_specialist',
    jobTitle: 'Recovery Coach',
  },
  {
    firstName: 'Adaeze',
    lastName: 'Umeh',
    role: 'peer_support_specialist',
    jobTitle: 'Peer Mentor',
  },
  {
    firstName: 'Miriam',
    lastName: 'Rosenthal',
    role: 'front_desk_admin',
    jobTitle: 'Front Desk Coordinator',
  },
  {
    firstName: 'Stefan',
    lastName: 'Kowalczyk',
    role: 'front_desk_admin',
    jobTitle: 'Scheduling Clerk',
  },
  {
    firstName: 'Halima',
    lastName: 'Barre',
    role: 'front_desk_admin',
    jobTitle: 'Medical Records Clerk',
  },
  { firstName: 'Victor', lastName: 'Amadi', role: 'front_desk_admin', jobTitle: 'Billing Assistant' },
  {
    firstName: 'Rosalind',
    lastName: 'Achterberg',
    role: 'facilities_support',
    jobTitle: 'Facilities Coordinator',
  },
  {
    firstName: 'Julius',
    lastName: 'Mwangi',
    role: 'facilities_support',
    jobTitle: 'Maintenance Technician',
  },
  {
    firstName: 'Petra',
    lastName: 'Novakova',
    role: 'facilities_support',
    jobTitle: 'Environmental Services',
  },
  {
    firstName: 'Andre',
    lastName: 'Lefevre',
    role: 'facilities_support',
    jobTitle: 'Safety Officer',
  },
];

interface InviteSeed {
  email: string;
  role: UserRole;
  /** Days until expiry — negative values seed an already-expired invite. */
  expiresInDays: number;
}

const INVITES: InviteSeed[] = [
  { email: 'pending.abraham@paginationqa.test', role: 'nurse', expiresInDays: 6 },
  { email: 'pending.beaumont@paginationqa.test', role: 'therapist_clinician', expiresInDays: 5 },
  { email: 'pending.castellanos@paginationqa.test', role: 'case_manager', expiresInDays: 4 },
  {
    email: 'pending.dumont@paginationqa.test',
    role: 'behavioral_health_technician',
    expiresInDays: 3,
  },
  { email: 'pending.eriksson@paginationqa.test', role: 'front_desk_admin', expiresInDays: 2 },
  { email: 'pending.fontaine@paginationqa.test', role: 'peer_support_specialist', expiresInDays: 1 },
  { email: 'pending.gallagher@paginationqa.test', role: 'facilities_support', expiresInDays: -2 },
  { email: 'pending.hernandez@paginationqa.test', role: 'hr', expiresInDays: -9 },
];

interface DocumentSeed {
  originalName: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Days in the past the document was uploaded. */
  ageDays: number;
}

const DOCUMENT_MIME_TYPES: { mimeType: string; extension: string }[] = [
  { mimeType: 'application/pdf', extension: 'pdf' },
  {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
  },
  { mimeType: 'text/plain', extension: 'txt' },
  { mimeType: 'application/msword', extension: 'doc' },
];

const DOCUMENT_TITLES = [
  'HIPAA Privacy Policy',
  'Bloodborne Pathogens Exposure Control Plan',
  'Emergency Evacuation Procedure',
  'Medication Administration Protocol',
  'Client Intake Handbook',
  'Incident Reporting Standard',
  'Restraint and Seclusion Policy',
  'Infection Control Manual',
  'Telehealth Consent Guidelines',
  'Crisis De-escalation Playbook',
  'Mandated Reporter Guidance',
  'Records Retention Schedule',
  'Employee Code of Conduct',
  'Workplace Violence Prevention Plan',
  'Fire Safety Inspection Checklist',
  'Controlled Substance Handling SOP',
  'Discharge Planning Workflow',
  'Cultural Competency Framework',
  'Suicide Risk Assessment Protocol',
  'Grievance and Appeals Process',
  'Transportation Safety Policy',
  'Nutrition and Dietary Standards',
  'Peer Support Scope of Practice',
  'Data Breach Response Runbook',
  'Contractor Onboarding Checklist',
  'Environmental Rounds Log',
  'Quality Improvement Charter',
  'Trauma-Informed Care Standards',
  'Supervision and Coaching Policy',
  'Corporate Compliance Program',
  'Vehicle Fleet Maintenance Log',
  'Annual Training Calendar',
];

const DOCUMENTS: DocumentSeed[] = DOCUMENT_TITLES.map((title, index) => {
  const { mimeType, extension } = DOCUMENT_MIME_TYPES[index % DOCUMENT_MIME_TYPES.length];
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    originalName: `${title}.${extension}`,
    filename: `qa-${slug}.${extension}`,
    mimeType,
    size: 18_000 + index * 7_350 + (index % 5) * 41_000,
    ageDays: 3 + index * 9,
  };
});

interface TextCourseSeed {
  title: string;
  description: string;
  categorySlug: string;
  categoryName: string;
  status: 'published' | 'draft' | 'inactive';
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  duration: number;
  /** Days in the past the course was created — spreads the date column. */
  ageDays: number;
}

const TEXT_COURSES: TextCourseSeed[] = [
  {
    title: 'HIPAA Privacy Essentials',
    description: 'Core privacy rules every staff member must follow when handling PHI.',
    categorySlug: 'compliance-and-legal',
    categoryName: 'Compliance & Legal',
    status: 'published',
    skillLevel: 'beginner',
    duration: 35,
    ageDays: 340,
  },
  {
    title: 'Bloodborne Pathogens Safety',
    description: 'Exposure control, PPE selection and post-exposure reporting.',
    categorySlug: 'health-and-safety',
    categoryName: 'Health & Safety',
    status: 'published',
    skillLevel: 'beginner',
    duration: 28,
    ageDays: 318,
  },
  {
    title: 'Crisis De-escalation Techniques',
    description: 'Verbal and environmental strategies for defusing escalating behaviour.',
    categorySlug: 'clinical-practices',
    categoryName: 'Clinical Practices',
    status: 'published',
    skillLevel: 'intermediate',
    duration: 45,
    ageDays: 296,
  },
  {
    title: 'Medication Administration Standards',
    description: 'The five rights, documentation duties and error reporting.',
    categorySlug: 'clinical-practices',
    categoryName: 'Clinical Practices',
    status: 'published',
    skillLevel: 'intermediate',
    duration: 50,
    ageDays: 274,
  },
  {
    title: 'Mandated Reporter Responsibilities',
    description: 'Recognising and reporting suspected abuse or neglect within statutory windows.',
    categorySlug: 'compliance-and-legal',
    categoryName: 'Compliance & Legal',
    status: 'published',
    skillLevel: 'beginner',
    duration: 30,
    ageDays: 252,
  },
  {
    title: 'Trauma-Informed Care Foundations',
    description: 'Applying safety, trust and empowerment principles in daily practice.',
    categorySlug: 'clinical-practices',
    categoryName: 'Clinical Practices',
    status: 'published',
    skillLevel: 'beginner',
    duration: 40,
    ageDays: 230,
  },
  {
    title: 'Incident Reporting and Documentation',
    description: 'What to record, when to escalate and how to avoid common charting errors.',
    categorySlug: 'quality-assurance',
    categoryName: 'Quality Assurance',
    status: 'published',
    skillLevel: 'beginner',
    duration: 25,
    ageDays: 208,
  },
  {
    title: 'Infection Prevention and Control',
    description: 'Hand hygiene, isolation precautions and outbreak response.',
    categorySlug: 'health-and-safety',
    categoryName: 'Health & Safety',
    status: 'published',
    skillLevel: 'beginner',
    duration: 32,
    ageDays: 186,
  },
  {
    title: 'Suicide Risk Screening',
    description: 'Structured screening, documentation and warm hand-off to clinical staff.',
    categorySlug: 'clinical-practices',
    categoryName: 'Clinical Practices',
    status: 'published',
    skillLevel: 'advanced',
    duration: 55,
    ageDays: 164,
  },
  {
    title: 'Workplace Violence Prevention',
    description: 'Hazard assessment, reporting duties and personal safety planning.',
    categorySlug: 'health-and-safety',
    categoryName: 'Health & Safety',
    status: 'published',
    skillLevel: 'beginner',
    duration: 30,
    ageDays: 142,
  },
  {
    title: 'Cultural Competency in Behavioral Health',
    description: 'Delivering equitable care across language, culture and identity.',
    categorySlug: 'patient-care-and-experience',
    categoryName: 'Patient Care & Experience',
    status: 'published',
    skillLevel: 'intermediate',
    duration: 38,
    ageDays: 120,
  },
  {
    title: 'Records Retention and Release of Information',
    description: 'Retention schedules, authorisations and lawful disclosure.',
    categorySlug: 'administrative-procedures',
    categoryName: 'Administrative Procedures',
    status: 'published',
    skillLevel: 'intermediate',
    duration: 27,
    ageDays: 98,
  },
  {
    title: 'Supervisory Coaching Fundamentals',
    description: 'Running effective supervision sessions and documenting growth plans.',
    categorySlug: 'leadership-and-management',
    categoryName: 'Leadership & Management',
    status: 'published',
    skillLevel: 'advanced',
    duration: 60,
    ageDays: 76,
  },
  {
    title: 'Electronic Health Record Hygiene',
    description: 'Charting accuracy, access boundaries and audit-trail awareness.',
    categorySlug: 'equipment-and-technology',
    categoryName: 'Equipment & Technology',
    status: 'draft',
    skillLevel: 'beginner',
    duration: 22,
    ageDays: 54,
  },
  {
    title: 'New Hire Compliance Orientation',
    description: 'The first-30-days compliance checklist for every new staff member.',
    categorySlug: 'human-resources',
    categoryName: 'Human Resources',
    status: 'draft',
    skillLevel: 'beginner',
    duration: 45,
    ageDays: 32,
  },
  {
    title: 'Legacy Fire Drill Procedure (2023)',
    description: 'Superseded evacuation drill guidance retained for audit history.',
    categorySlug: 'health-and-safety',
    categoryName: 'Health & Safety',
    status: 'inactive',
    skillLevel: 'beginner',
    duration: 20,
    ageDays: 12,
  },
];

interface VideoCourseSeed {
  title: string;
  description: string;
  category: string;
  ageDays: number;
}

const VIDEO_COURSES: VideoCourseSeed[] = [
  {
    title: 'Hand Hygiene in 10 Minutes',
    description: 'A short refresher on when and how to perform hand hygiene.',
    category: 'Health & Safety',
    ageDays: 330,
  },
  {
    title: 'Safe Patient Transfers',
    description: 'Body mechanics and equipment checks for injury-free transfers.',
    category: 'Clinical Practices',
    ageDays: 308,
  },
  {
    title: 'Recognising Signs of Overdose',
    description: 'Field signs, naloxone administration and post-event documentation.',
    category: 'Clinical Practices',
    ageDays: 286,
  },
  {
    title: 'De-escalating an Agitated Client',
    description: 'A filmed walkthrough of a real de-escalation sequence.',
    category: 'Clinical Practices',
    ageDays: 264,
  },
  {
    title: 'Fire Extinguisher PASS Technique',
    description: 'Pull, aim, squeeze, sweep — demonstrated on a live burn.',
    category: 'Health & Safety',
    ageDays: 242,
  },
  {
    title: 'Confidentiality in Shared Spaces',
    description: 'Avoiding incidental PHI disclosure in hallways and group rooms.',
    category: 'Compliance & Legal',
    ageDays: 220,
  },
  {
    title: 'Documenting a Behavioral Incident',
    description: 'Screen-recorded walkthrough of an incident note done well.',
    category: 'Quality Assurance',
    ageDays: 198,
  },
  {
    title: 'Using the Medication Cart Safely',
    description: 'Cart security, double-checks and controlled substance counts.',
    category: 'Clinical Practices',
    ageDays: 176,
  },
  {
    title: 'Motivational Interviewing Basics',
    description: 'Open questions, affirmations, reflections and summaries on camera.',
    category: 'Clinical Practices',
    ageDays: 154,
  },
  {
    title: 'Responding to a Medical Emergency',
    description: 'First-response sequence before EMS arrives.',
    category: 'Health & Safety',
    ageDays: 132,
  },
  {
    title: 'Phishing and Password Hygiene',
    description: 'Spotting credential-harvesting emails aimed at clinical staff.',
    category: 'Equipment & Technology',
    ageDays: 110,
  },
  {
    title: 'Welcoming a New Client',
    description: 'The first fifteen minutes of intake, demonstrated end to end.',
    category: 'Patient Care & Experience',
    ageDays: 88,
  },
  {
    title: 'Running an Effective Shift Handoff',
    description: 'SBAR-structured handoff between outgoing and incoming shifts.',
    category: 'Leadership & Management',
    ageDays: 66,
  },
  {
    title: 'Personal Protective Equipment Donning',
    description: 'Correct donning and doffing order, demonstrated step by step.',
    category: 'Health & Safety',
    ageDays: 44,
  },
  {
    title: 'Timesheet and PTO Submission',
    description: 'Walkthrough of the payroll portal for hourly staff.',
    category: 'Human Resources',
    ageDays: 22,
  },
  {
    title: 'Environmental Rounds Walkthrough',
    description: 'A full safety round of a residential unit, narrated.',
    category: 'Administrative Procedures',
    ageDays: 8,
  },
];

const QUIZ_OPTIONS = [
  'Report it to your supervisor immediately',
  'Ignore it and continue working',
  'Handle it yourself without documenting',
  'Discuss it with colleagues off the record',
];

const QUESTION_TEMPLATES = [
  'What is the FIRST action you should take in this situation?',
  'Which of the following is the correct escalation path?',
  'How should the event be documented?',
  'Who must be notified once the immediate risk is controlled?',
  'What is the expected timeframe for completing the report?',
];

// ── Storage ──────────────────────────────────────────────────────────────────
/**
 * Uploads the sample MP4 to the bucket once so the seeded video courses are
 * genuinely playable. Returns false (with a warning) when storage is
 * unreachable — the rows are still seeded, so lists and pagination render.
 */
async function ensureSampleVideoUploaded(): Promise<boolean> {
  const client = new MinioClient({
    endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY ?? '',
    secretKey: process.env.MINIO_SECRET_KEY ?? '',
  });

  try {
    if (!(await client.bucketExists(MINIO_BUCKET))) {
      await client.makeBucket(MINIO_BUCKET);
      log(`storage: created bucket ${MINIO_BUCKET}`);
    }

    try {
      await client.statObject(MINIO_BUCKET, VIDEO_OBJECT_KEY);
      log('storage: sample video already present — upload skipped');
      return true;
    } catch {
      // Object missing — fall through to upload it.
    }

    const localPath = process.env.QA_SEED_VIDEO_PATH ?? path.join(os.tmpdir(), 'lms-qa-sample.mp4');
    if (!fs.existsSync(localPath)) {
      log(`storage: downloading sample video → ${localPath}`);
      const response = await fetch(VIDEO_SOURCE_URL);
      if (!response.ok) {
        throw new Error(`sample video download failed with HTTP ${response.status}`);
      }
      fs.writeFileSync(localPath, Buffer.from(await response.arrayBuffer()));
    }

    const buffer = fs.readFileSync(localPath);
    await client.putObject(MINIO_BUCKET, VIDEO_OBJECT_KEY, buffer, buffer.length, {
      'Content-Type': 'video/mp4',
    });
    log(`storage: uploaded sample video (${buffer.length} bytes) → ${VIDEO_STORAGE_URI}`);
    return true;
  } catch (error: unknown) {
    warn(
      `storage unavailable — video courses will be seeded with URIs that do not resolve: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

// ── Seed steps ───────────────────────────────────────────────────────────────
async function seedPaginationOrg(now: Date, adminPasswordHash: string, staffPasswordHash: string) {
  const org = await prisma.organization.upsert({
    where: { slug: PAGINATION_ORG_SLUG },
    update: { name: 'QA Pagination Org', requireMfa: false },
    create: {
      id: PAGINATION_ORG_ID,
      name: 'QA Pagination Org',
      slug: PAGINATION_ORG_SLUG,
      primaryContact: 'Quinn Paige',
      primaryEmail: PAGINATION_ADMIN_EMAIL,
      primaryBusinessType: 'Behavioral Health',
      isHipaaCompliant: true,
      requireMfa: false,
    },
  });

  await prisma.facility.upsert({
    where: { id: uid(G.facility, 1) },
    update: { organizationId: org.id },
    create: {
      id: uid(G.facility, 1),
      organizationId: org.id,
      name: 'QA Pagination Main Campus',
      type: 'Outpatient Clinic',
      address: '1400 Meridian Avenue',
      city: 'Columbus',
      state: 'OH',
      country: 'United States',
      zipCode: '43215',
      phone: '+1-614-555-0142',
      licenseNumber: 'OH-BH-2291',
      staffCount: '26-50',
      programServices: ['Outpatient', 'Residential', 'Crisis Response'],
      timezone: 'America/New_York',
    },
  });

  const periodEnd = new Date(now);
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  // Enterprise = unlimited seats, so 30+ staff never trips the seat-limit gate.
  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    update: { status: 'active', pausedAt: null, pauseEndsAt: null },
    create: {
      id: uid(G.subscription, 1),
      organizationId: org.id,
      stripeSubscriptionId: 'sub_qa_pagination_0001',
      stripePriceId: 'price_qa_pagination_0001',
      plan: 'enterprise',
      billingCycle: 'yearly',
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
  });

  const { membership: admin } = await upsertOrgUser(
    {
      id: PAGINATION_ADMIN_ID,
      email: PAGINATION_ADMIN_EMAIL,
      password: adminPasswordHash,
      firstName: 'Quinn',
      lastName: 'Paige',
      role: 'owner',
      jobTitle: 'Executive Director',
    },
    org.id,
    uid(G.facility, 1),
  );

  const staffIds: string[] = [];
  for (const [index, member] of STAFF.entries()) {
    const id = uid(G.user, index + 1);
    const email = `${member.firstName}.${member.lastName}`.toLowerCase() + '@paginationqa.test';
    const createdAt = daysFromNow(now, -(20 + index * 11));

    const { membership: staff } = await upsertOrgUser(
      {
        id,
        email,
        password: staffPasswordHash,
        firstName: member.firstName,
        lastName: member.lastName,
        role: member.role,
        jobTitle: member.jobTitle,
        managerId: admin.id,
        createdAt,
        lastLoginAt: index % 4 === 0 ? null : daysFromNow(now, -(index % 14)),
      },
      org.id,
      uid(G.facility, 1),
    );
    staffIds.push(staff.id);
  }

  for (const [index, invite] of INVITES.entries()) {
    const id = uid(G.invite, index + 1);
    await prisma.invite.upsert({
      where: { id },
      update: {
        status: 'pending',
        expiresAt: daysFromNow(now, invite.expiresInDays),
      },
      create: {
        id,
        email: invite.email,
        token: `qa-seed-invite-${index + 1}`,
        organizationId: org.id,
        facilityId: uid(G.facility, 1),
        role: invite.role,
        status: 'pending',
        expiresAt: daysFromNow(now, invite.expiresInDays),
        invitedBy: admin.id,
        createdAt: daysFromNow(now, -(2 + index * 3)),
      },
    });
  }

  log(`org "${org.name}": ${staffIds.length} staff + ${INVITES.length} pending invites`);
  return { org, admin, staffIds };
}

async function seedDocuments(adminId: string, staffIds: string[], now: Date) {
  const documentVersionIds: string[] = [];

  for (const [index, doc] of DOCUMENTS.entries()) {
    const id = uid(G.document, index + 1);
    const versionId = uid(G.documentVersion, index + 1);
    const uploadedAt = daysFromNow(now, -doc.ageDays);
    // Most documents belong to the org admin; every 5th is uploaded by a
    // manager-tier staff member so the "Uploaded by" column varies.
    const ownerId = index % 5 === 4 ? staffIds[index % 4] : adminId;

    await prisma.document.upsert({
      where: { id },
      update: {
        organizationUserId: ownerId,
        filename: doc.filename,
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        size: doc.size,
        createdAt: uploadedAt,
        updatedAt: uploadedAt,
      },
      create: {
        id,
        organizationUserId: ownerId,
        filename: doc.filename,
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        size: doc.size,
        createdAt: uploadedAt,
        updatedAt: uploadedAt,
      },
    });
    await prisma.documentVersion.upsert({
      where: { id: versionId },
      update: {},
      create: {
        id: versionId,
        documentId: id,
        version: 1,
        storagePath: `minio://${MINIO_BUCKET}/documents/qa-pagination/${doc.filename}`,
        hash: `qa-seed-doc-hash-${String(index + 1).padStart(4, '0')}`,
        content: `${doc.originalName} — seeded QA content for pagination testing.`,
        createdAt: uploadedAt,
      },
    });
    documentVersionIds.push(versionId);
  }

  log(`documents: ${DOCUMENTS.length} rows (+ 1 version each)`);
  return documentVersionIds;
}

async function seedTextCourses(adminId: string, now: Date) {
  const categories = await prisma.courseCategory.findMany({
    where: { isSystem: true },
    select: { id: true, slug: true },
  });
  const categoryIdBySlug = new Map(categories.map((c) => [c.slug, c.id]));

  const courseIds: string[] = [];
  const publishedCourseIds: string[] = [];

  for (const [index, course] of TEXT_COURSES.entries()) {
    const courseId = uid(G.textCourse, index + 1);
    const createdAt = daysFromNow(now, -course.ageDays);

    await prisma.course.upsert({
      where: { id: courseId },
      update: {
        title: course.title,
        status: course.status,
        createdByOrgUserId: adminId,
        categoryId: categoryIdBySlug.get(course.categorySlug) ?? null,
        createdAt,
      },
      create: {
        id: courseId,
        title: course.title,
        description: course.description,
        overview: `${course.description} This course is part of the QA pagination fixture set.`,
        objectives: [
          `Explain the key requirements of ${course.title.toLowerCase()}`,
          'Apply the policy correctly in day-to-day practice',
          'Escalate and document exceptions appropriately',
        ],
        status: course.status,
        type: 'text',
        isGlobal: false,
        category: course.categoryName,
        categoryId: categoryIdBySlug.get(course.categorySlug) ?? null,
        skillLevel: course.skillLevel,
        duration: course.duration,
        createdByOrgUserId: adminId,
        createdAt,
        updatedAt: createdAt,
      },
    });

    const moduleId = uid(G.module, index + 1);
    await prisma.courseModule.upsert({
      where: { id: moduleId },
      update: { title: `${course.title} — Core Module`, courseId },
      create: {
        id: moduleId,
        courseId,
        title: `${course.title} — Core Module`,
        order: 0,
      },
    });

    for (let lessonIndex = 0; lessonIndex < 3; lessonIndex++) {
      const lessonId = uid(G.lesson, index * 10 + lessonIndex + 1);
      const lessonTitles = ['Why It Matters', 'Doing It Correctly', 'When Things Go Wrong'];
      await prisma.lesson.upsert({
        where: { id: lessonId },
        update: { courseId, moduleId, order: lessonIndex },
        create: {
          id: lessonId,
          courseId,
          moduleId,
          title: `${lessonIndex + 1}. ${lessonTitles[lessonIndex]}`,
          content:
            `${course.description}\n\n` +
            'Follow the documented procedure exactly, record what you did, and raise anything ' +
            'you are unsure about with your supervisor before acting on your own judgement.',
          order: lessonIndex,
          duration: Math.max(5, Math.round(course.duration / 3)),
        },
      });
    }

    const quizId = uid(G.quiz, index + 1);
    await prisma.quiz.upsert({
      where: { id: quizId },
      update: { courseId, title: `${course.title} Assessment` },
      create: {
        id: quizId,
        courseId,
        title: `${course.title} Assessment`,
        passingScore: 70,
        allowedAttempts: 3,
      },
    });

    for (let q = 0; q < 4; q++) {
      const questionId = uid(G.question, index * 10 + q + 1);
      await prisma.question.upsert({
        where: { id: questionId },
        update: { options: QUIZ_OPTIONS, correctAnswer: QUIZ_OPTIONS[0], order: q },
        create: {
          id: questionId,
          quizId,
          text: `${course.title}: ${QUESTION_TEMPLATES[q]}`,
          type: 'multiple_choice',
          options: QUIZ_OPTIONS,
          correctAnswer: QUIZ_OPTIONS[0],
          order: q,
        },
      });
    }

    courseIds.push(courseId);
    if (course.status === 'published') {
      publishedCourseIds.push(courseId);
    }
  }

  log(`text courses: ${courseIds.length} (${publishedCourseIds.length} published), 3 lessons each`);
  return { courseIds, publishedCourseIds };
}

async function seedVideoCourses(now: Date) {
  const systemMembership = await getOrCreateSystemMembership();

  const courseIds: string[] = [];

  for (const [index, course] of VIDEO_COURSES.entries()) {
    const courseId = uid(G.videoCourse, index + 1);
    const createdAt = daysFromNow(now, -course.ageDays);

    await prisma.course.upsert({
      where: { id: courseId },
      update: {
        title: course.title,
        status: 'published',
        type: 'video',
        isGlobal: true,
        createdByOrgUserId: systemMembership.id,
        previewVideoStorageUri: VIDEO_STORAGE_URI,
        previewVideoDurationSeconds: VIDEO_DURATION_SECONDS,
        previewMediaStatus: 'ready',
        createdAt,
      },
      create: {
        id: courseId,
        title: course.title,
        description: course.description,
        overview: `${course.description} Seeded QA video fixture.`,
        objectives: ['Watch the demonstration end to end', 'Pass the knowledge check'],
        status: 'published',
        type: 'video',
        isGlobal: true,
        category: course.category,
        skillLevel: 'beginner',
        duration: 1,
        createdByOrgUserId: systemMembership.id,
        previewVideoStorageUri: VIDEO_STORAGE_URI,
        previewVideoDurationSeconds: VIDEO_DURATION_SECONDS,
        previewMediaStatus: 'ready',
        createdAt,
        updatedAt: createdAt,
      },
    });

    // A video course is stored as a single module-less lesson (mirrors
    // createVideoCourse in src/app/actions/video-course.ts).
    const lessonId = uid(G.videoLesson, index + 1);
    await prisma.lesson.upsert({
      where: { id: lessonId },
      update: {
        courseId,
        videoProvider: 'self',
        videoStorageUri: VIDEO_STORAGE_URI,
        videoDurationSeconds: VIDEO_DURATION_SECONDS,
        mediaStatus: 'ready',
      },
      create: {
        id: lessonId,
        courseId,
        moduleId: null,
        title: course.title,
        content: '',
        order: 0,
        duration: 1,
        videoProvider: 'self',
        videoStorageUri: VIDEO_STORAGE_URI,
        videoDurationSeconds: VIDEO_DURATION_SECONDS,
        mediaStatus: 'ready',
      },
    });

    const quizId = uid(G.videoQuiz, index + 1);
    await prisma.quiz.upsert({
      where: { id: quizId },
      update: { courseId, title: `${course.title} Quiz` },
      create: {
        id: quizId,
        courseId,
        title: `${course.title} Quiz`,
        passingScore: 80,
        allowedAttempts: 3,
      },
    });

    for (let q = 0; q < QUESTION_TEMPLATES.length; q++) {
      const questionId = uid(G.videoQuestion, index * 10 + q + 1);
      await prisma.question.upsert({
        where: { id: questionId },
        update: { options: QUIZ_OPTIONS, correctAnswer: QUIZ_OPTIONS[0], order: q },
        create: {
          id: questionId,
          quizId,
          text: `${course.title}: ${QUESTION_TEMPLATES[q]}`,
          type: 'multiple-choice',
          options: QUIZ_OPTIONS,
          correctAnswer: QUIZ_OPTIONS[0],
          order: q,
        },
      });
    }

    courseIds.push(courseId);
  }

  log(`video courses: ${courseIds.length} global published (catalog for the Available tab)`);
  return courseIds;
}

async function seedOfferings(orgId: string, adminId: string, videoCourseIds: string[]) {
  // Adopt the first six catalog courses so they also appear under "My Courses".
  const adopted = videoCourseIds.slice(0, 6);
  for (const [index, courseId] of adopted.entries()) {
    await prisma.orgCourseOffering.upsert({
      where: { organizationId_courseId: { organizationId: orgId, courseId } },
      update: {},
      create: {
        id: uid(G.offering, index + 1),
        organizationId: orgId,
        courseId,
        addedByAdminId: adminId,
      },
    });
  }
  log(`offerings: ${adopted.length} video courses adopted by the org`);
  return adopted;
}

async function seedDocumentCourseLinks(documentVersionIds: string[], courseIds: string[]) {
  // Links the first eight documents to a course so the Documents list shows a
  // mix of "Uploaded" and "Converted to Course" statuses.
  const linkCount = Math.min(8, documentVersionIds.length, courseIds.length);
  for (let index = 0; index < linkCount; index++) {
    await prisma.courseVersion.upsert({
      where: { id: uid(G.courseVersion, index + 1) },
      update: {},
      create: {
        id: uid(G.courseVersion, index + 1),
        courseId: courseIds[index],
        documentVersionId: documentVersionIds[index],
        version: 1,
      },
    });
  }
  log(`document→course links: ${linkCount} documents show as "Converted to Course"`);
}

async function seedAssignmentsAndEnrollments(
  orgId: string,
  adminId: string,
  staffIds: string[],
  courseIds: string[],
  now: Date,
) {
  const assignmentIdByCourse = new Map<string, string>();
  for (const [index, courseId] of courseIds.entries()) {
    const assignmentId = uid(G.assignment, index + 1);
    await prisma.courseAssignment.upsert({
      where: { id: assignmentId },
      update: { organizationId: orgId, courseId, assignedByAdminId: adminId },
      create: {
        id: assignmentId,
        organizationId: orgId,
        courseId,
        assignedByAdminId: adminId,
        dueWindowDays: 30,
        remindersEnabled: true,
        renewalCycle: index % 3 === 0 ? 'annual' : 'none',
      },
    });
    assignmentIdByCourse.set(courseId, assignmentId);
  }

  let enrollmentIndex = 0;
  const counts: Record<string, number> = {};

  for (const [staffIndex, organizationUserId] of staffIds.entries()) {
    // Two distinct courses per staff member — the pair is unique per user, so
    // the partial unique index on (user_id, course_id) for active statuses is
    // never violated.
    const picks = [
      courseIds[(staffIndex * 3) % courseIds.length],
      courseIds[(staffIndex * 3 + 1) % courseIds.length],
    ];

    for (const courseId of picks) {
      enrollmentIndex++;
      const id = uid(G.enrollment, enrollmentIndex);
      const bucket = enrollmentIndex % 5;

      let status: EnrollmentStatus;
      let progress: number;
      let score: number | null = null;
      let dueAt: Date | null;
      let completedAt: Date | null = null;
      let attestedAt: Date | null = null;
      let lockedAt: Date | null = null;

      switch (bucket) {
        // Overdue — feeds the Status Tracker's overdue population.
        case 0:
          status = enrollmentIndex % 2 === 0 ? 'in_progress' : 'assigned';
          progress = enrollmentIndex % 2 === 0 ? 35 : 0;
          dueAt = daysFromNow(now, -(2 + (enrollmentIndex % 22)));
          break;
        // Due inside the 7-day at-risk window.
        case 1:
          status = enrollmentIndex % 2 === 0 ? 'in_progress' : 'assigned';
          progress = enrollmentIndex % 2 === 0 ? 60 : 0;
          dueAt = daysFromNow(now, 1 + (enrollmentIndex % 6));
          break;
        // Comfortably in the future.
        case 2:
          status = 'assigned';
          progress = 0;
          dueAt = daysFromNow(now, 30 + (enrollmentIndex % 60));
          break;
        // Finished — half attested, so certificates and audit tables have data.
        case 3:
          status = enrollmentIndex % 2 === 0 ? 'attested' : 'completed';
          progress = 100;
          score = 80 + (enrollmentIndex % 20);
          completedAt = daysFromNow(now, -(5 + (enrollmentIndex % 40)));
          attestedAt = status === 'attested' ? completedAt : null;
          dueAt = daysFromNow(now, -(1 + (enrollmentIndex % 30)));
          break;
        // Failed or locked out after exhausting attempts.
        default:
          status = enrollmentIndex % 2 === 0 ? 'locked' : 'failed';
          progress = 100;
          score = 40 + (enrollmentIndex % 20);
          lockedAt = status === 'locked' ? daysFromNow(now, -(3 + (enrollmentIndex % 10))) : null;
          dueAt = daysFromNow(now, -(4 + (enrollmentIndex % 15)));
          break;
      }

      counts[status] = (counts[status] ?? 0) + 1;

      const enrollmentData = {
        status,
        progress,
        score,
        completedAt,
        attestedAt,
        attestationSignature: attestedAt ? 'Seeded QA attestation' : null,
        attestationRole: attestedAt ? 'Staff Member' : null,
        lockedAt,
        dueAt,
        assignedByAdminId: adminId,
        assignmentId: assignmentIdByCourse.get(courseId) ?? null,
        retakeOf: null,
        retakeReason: null,
      };

      await prisma.enrollment.upsert({
        where: { id },
        update: enrollmentData,
        create: {
          id,
          organizationUserId,
          courseId,
          startedAt: daysFromNow(now, -(10 + (enrollmentIndex % 90))),
          ...enrollmentData,
        },
      });

      if (completedAt) {
        await prisma.certificate.upsert({
          where: { enrollmentId: id },
          update: { score: score ?? 0 },
          create: {
            id: uid(G.certificate, enrollmentIndex),
            enrollmentId: id,
            organizationUserId,
            courseId,
            score: score ?? 0,
            issuedAt: completedAt,
          },
        });
      }
    }
  }

  log(
    `enrollments: ${enrollmentIndex} across ${staffIds.length} staff — ` +
      Object.entries(counts)
        .map(([status, count]) => `${status}:${count}`)
        .join(', '),
  );
}


/**
 * Admin-facing notifications for the data-rich org's admin so the bell panel,
 * unread badge, filters, and the notifications page all have realistic content.
 * Mix of read/unread, all admin-audience types, spread over the last 10 days.
 */

/**
 * A "showcase" staff member (the first in the list) with many completed
 * courses + certificates, so the staff-profile Certificates Earned table has
 * a full page of rows. Completed/attested enrollments are exempt from the
 * partial (user, course) active-uniqueness index, so these never conflict
 * with the member's active enrollments.
 */
async function seedShowcaseCertificates(
  adminId: string,
  staffIds: string[],
  publishedCourseIds: string[],
  now: Date,
): Promise<void> {
  const organizationUserId = staffIds[0];
  const courses = publishedCourseIds.slice(0, 8);

  for (const [index, courseId] of courses.entries()) {
    const enrollmentId = uid(G.showcaseEnrollment, index + 1);
    const score = 85 + ((index * 3) % 13);
    const completedAt = daysFromNow(now, -(12 + index * 19));
    const attested = index % 2 === 0;

    const enrollmentData = {
      status: attested ? ('attested' as const) : ('completed' as const),
      progress: 100,
      score,
      completedAt,
      attestedAt: attested ? completedAt : null,
      attestationSignature: attested ? 'Seeded QA attestation' : null,
      attestationRole: attested ? 'Staff Member' : null,
      lockedAt: null,
      dueAt: daysFromNow(now, -(10 + index * 19)),
      assignedByAdminId: adminId,
      assignmentId: null,
      retakeOf: null,
      retakeReason: null,
    };

    await prisma.enrollment.upsert({
      where: { id: enrollmentId },
      update: enrollmentData,
      create: {
        id: enrollmentId,
        organizationUserId,
        courseId,
        startedAt: daysFromNow(now, -(30 + index * 19)),
        ...enrollmentData,
      },
    });

    await prisma.certificate.upsert({
      where: { enrollmentId },
      update: { score, issuedAt: completedAt },
      create: {
        id: uid(G.showcaseCertificate, index + 1),
        enrollmentId,
        organizationUserId,
        courseId,
        score,
        issuedAt: completedAt,
      },
    });
  }

  log(`showcase certificates: ${courses.length} for ${STAFF[0].firstName} ${STAFF[0].lastName}`);
}

async function seedNotifications(adminId: string, staffIds: string[], now: Date): Promise<void> {
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
  const staffName = (i: number) => `${STAFF[i].firstName} ${STAFF[i].lastName}`;
  const staffLink = (i: number) => `/dashboard/staff/${staffIds[i]}`;

  const items = [
    {
      type: 'COMPLIANCE_ESCALATION',
      title: 'Compliance escalation',
      message: `${staffName(10)} is 22 days overdue on "Workplace Violence Prevention" and has been escalated.`,
      linkUrl: staffLink(10),
      minutes: 42,
      isRead: false,
    },
    {
      type: 'COURSE_FAILED',
      title: 'Quiz failed',
      message: `${staffName(6)} failed the quiz for "HIPAA Privacy Essentials" with a score of 55%.`,
      linkUrl: staffLink(6),
      minutes: 3 * 60,
      isRead: false,
    },
    {
      type: 'COURSE_PASSED',
      title: 'Course completed',
      message: `${staffName(4)} completed "Infection Prevention and Control" with a score of 92%.`,
      linkUrl: staffLink(4),
      minutes: 5 * 60,
      isRead: false,
    },
    {
      type: 'QUIZ_RETRY_LIMIT_REACHED',
      title: 'Quiz Attempts Exhausted',
      message: `${staffName(8)} has used all 3 attempts on "Bloodborne Pathogens Safety Quiz" in course "Bloodborne Pathogens Safety" and requires a retake assignment.`,
      linkUrl: staffLink(8),
      minutes: 26 * 60,
      isRead: false,
    },
    {
      type: 'COURSE_RETRY_REQUESTED',
      title: 'Course retry requested',
      message: `${staffName(12)} requested a retry for "Mandated Reporter Responsibilities".`,
      linkUrl: staffLink(12),
      minutes: 30 * 60,
      isRead: true,
    },
    {
      type: 'COURSE_PASSED',
      title: 'Course completed',
      message: `${staffName(2)} completed "Medication Administration Basics" with a score of 88%.`,
      linkUrl: staffLink(2),
      minutes: 2 * 24 * 60,
      isRead: true,
    },
    {
      type: 'COURSE_FAILED',
      title: 'Quiz failed',
      message: `${staffName(14)} failed the quiz for "Crisis De-escalation Techniques" with a score of 60%.`,
      linkUrl: staffLink(14),
      minutes: 3 * 24 * 60,
      isRead: true,
    },
    {
      type: 'COMPLIANCE_ESCALATION',
      title: 'Compliance escalation',
      message: `${staffName(9)} is 14 days overdue on "HIPAA Privacy Essentials" and has been escalated.`,
      linkUrl: staffLink(9),
      minutes: 4 * 24 * 60,
      isRead: true,
    },
    {
      type: 'COURSE_PASSED',
      title: 'Course completed',
      message: `${staffName(1)} completed "Records Retention and Release of Information" with a score of 95%.`,
      linkUrl: staffLink(1),
      minutes: 6 * 24 * 60,
      isRead: true,
    },
    {
      type: 'COURSE_RETRY_REQUESTED',
      title: 'Course retry requested',
      message: `${staffName(5)} requested a retry for "Supervisory Coaching Fundamentals".`,
      linkUrl: staffLink(5),
      minutes: 8 * 24 * 60,
      isRead: true,
    },
    {
      type: 'QUIZ_RETRY_LIMIT_REACHED',
      title: 'Quiz Attempts Exhausted',
      message: `${staffName(3)} has used all 3 attempts on "Ethics and Boundaries Quiz" in course "Ethics and Professional Boundaries" and requires a retake assignment.`,
      linkUrl: staffLink(3),
      minutes: 9 * 24 * 60,
      isRead: true,
    },
    {
      type: 'COURSE_PASSED',
      title: 'Course completed',
      message: `${staffName(7)} completed "Electronic Health Record Hygiene" with a score of 90%.`,
      linkUrl: staffLink(7),
      minutes: 10 * 24 * 60,
      isRead: true,
    },
  ];

  for (const [index, item] of items.entries()) {
    const id = uid(G.notification, index + 1);
    const createdAt = minutesAgo(item.minutes);
    await prisma.notification.upsert({
      where: { id },
      update: {
        title: item.title,
        message: item.message,
        isRead: item.isRead,
        linkUrl: item.linkUrl,
        createdAt,
      },
      create: {
        id,
        organizationUserId: adminId,
        type: item.type,
        title: item.title,
        message: item.message,
        isRead: item.isRead,
        linkUrl: item.linkUrl,
        createdAt,
      },
    });
  }

  log(`notifications: ${items.length} for the data-rich admin (4 unread)`);
}

async function seedEmptyOrg(now: Date, adminPasswordHash: string) {
  const org = await prisma.organization.upsert({
    where: { slug: EMPTY_ORG_SLUG },
    update: { name: 'QA Empty Org', requireMfa: false },
    create: {
      id: EMPTY_ORG_ID,
      name: 'QA Empty Org',
      slug: EMPTY_ORG_SLUG,
      primaryContact: 'Evan Blank',
      primaryEmail: EMPTY_ADMIN_EMAIL,
      primaryBusinessType: 'Behavioral Health',
      requireMfa: false,
    },
  });

  await prisma.facility.upsert({
    where: { id: uid(G.facility, 2) },
    update: { organizationId: org.id },
    create: {
      id: uid(G.facility, 2),
      organizationId: org.id,
      name: 'QA Empty Org Clinic',
      type: 'Outpatient Clinic',
      address: '9 Vacant Way',
      city: 'Austin',
      state: 'TX',
      country: 'United States',
      zipCode: '73301',
      phone: '+1-512-555-0110',
      staffCount: '1-10',
      timezone: 'America/Chicago',
    },
  });

  const periodEnd = new Date(now);
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    update: { status: 'active', pausedAt: null, pauseEndsAt: null },
    create: {
      id: uid(G.subscription, 2),
      organizationId: org.id,
      stripeSubscriptionId: 'sub_qa_empty_0001',
      stripePriceId: 'price_qa_empty_0001',
      plan: 'starter',
      billingCycle: 'monthly',
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
  });

  await upsertOrgUser(
    {
      id: EMPTY_ADMIN_ID,
      email: EMPTY_ADMIN_EMAIL,
      password: adminPasswordHash,
      firstName: 'Evan',
      lastName: 'Blank',
      role: 'owner',
      jobTitle: 'Executive Director',
    },
    org.id,
    uid(G.facility, 2),
  );

  log(`org "${org.name}": admin only, no courses/documents/staff/enrollments`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('[seed-qa] DATABASE_URL is not set — refusing to seed.');
  }

  const now = new Date();
  const videoPlayable = await ensureSampleVideoUploaded();

  const [paginationAdminHash, emptyAdminHash, staffHash] = await Promise.all([
    hash(PAGINATION_ADMIN_PASSWORD),
    hash(EMPTY_ADMIN_PASSWORD),
    hash(STAFF_PASSWORD),
  ]);

  const { org, admin, staffIds } = await seedPaginationOrg(now, paginationAdminHash, staffHash);
  const documentVersionIds = await seedDocuments(admin.id, staffIds, now);
  const { publishedCourseIds } = await seedTextCourses(admin.id, now);
  const videoCourseIds = await seedVideoCourses(now);
  const adoptedVideoCourseIds = await seedOfferings(org.id, admin.id, videoCourseIds);
  await seedDocumentCourseLinks(documentVersionIds, publishedCourseIds);
  await seedAssignmentsAndEnrollments(
    org.id,
    admin.id,
    staffIds,
    [...publishedCourseIds, ...adoptedVideoCourseIds],
    now,
  );
  await seedShowcaseCertificates(admin.id, staffIds, publishedCourseIds, now);
  await seedNotifications(admin.id, staffIds, now);
  await seedEmptyOrg(now, emptyAdminHash);

  log(`video playback: ${videoPlayable ? 'enabled (sample uploaded)' : 'UNAVAILABLE (list-only)'}`);
  log(`login (data-rich): ${PAGINATION_ADMIN_EMAIL} / ${PAGINATION_ADMIN_PASSWORD}`);
  log(`login (empty):     ${EMPTY_ADMIN_EMAIL} / ${EMPTY_ADMIN_PASSWORD}`);
  log(`login (any staff): <first>.<last>@paginationqa.test / ${STAFF_PASSWORD}`);
  log('seed complete');
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `[seed-qa] failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
