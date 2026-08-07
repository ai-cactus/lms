/**
 * Deterministic e2e seed.
 *
 * Populates a test database with a fixed org, users, a document, a published
 * text course (lesson + quiz), and enrollments so the Playwright suite can run
 * against stable, known fixtures. Idempotent: every entity is upserted by a
 * fixed primary key (or a natural unique key), so `npx prisma db seed` can be
 * re-run safely.
 *
 * Run via `npx prisma db seed` (wired in prisma.config.ts → migrations.seed).
 *
 * NOTE: this script builds its own PrismaClient (relative import of the
 * generated client + pg adapter) rather than reusing `@/db`. tsx executes this
 * file directly and does not resolve the app's `@/*` tsconfig path aliases, so
 * a self-contained client is the robust choice for CI. It is NOT part of the
 * app runtime, so the structured-logger convention does not apply here —
 * progress is written with plain process.stdout (explicitly permitted for the
 * seed script).
 */

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { UserRole } from '../generated/prisma/enums';
import { BCRYPT_COST } from '../src/lib/bcrypt-config';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ── Fixed identifiers ────────────────────────────────────────────────────────
// Hard-coded UUIDs keep the seed idempotent: upserting by these keys updates the
// same rows on every run instead of accumulating duplicates.
const ORG_SLUG = 'e2e-test-org';
const FACILITY_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222221';
const WORKER_ID = '22222222-2222-4222-8222-222222222222';
const SARAH_ID = '22222222-2222-4222-8222-222222222223';
const DOC_ID = '33333333-3333-4333-8333-333333333331';
const DOC_VERSION_ID = '33333333-3333-4333-8333-333333333332';
const COURSE_ID = '44444444-4444-4444-8444-444444444441';
const LESSON_ID = '55555555-5555-4555-8555-555555555551';
const QUIZ_ID = '66666666-6666-4666-8666-666666666661';
const QUESTION_ID = '77777777-7777-4777-8777-777777777771';
const ENROLLMENT_SARAH_ID = '88888888-8888-4888-8888-888888888881';
const ENROLLMENT_WORKER_ID = '88888888-8888-4888-8888-888888888882';
// Dedicated worker + enrollment for the Status Tracker (formerly Compliance)
// overdue population — REM-004 and the admin-dashboard Status Tracker overview
// e2e coverage need a deterministically ≥7-day-overdue enrollment. Kept
// separate from sarah/worker so their status-specific fixtures (ENG-020's
// in_progress quiz flow, ENG-022's locked retake flow) are never disturbed.
const OVERDUE_WORKER_ID = '22222222-2222-4222-8222-222222222224';
const ENROLLMENT_OVERDUE_ID = '88888888-8888-4888-8888-888888888883';
const SUBSCRIPTION_ID = '99999999-9999-4999-8999-999999999991';
// Second org admin — Phase 2 Document Hub full-parity e2e coverage (two admins
// in one org see/manage each other's documents) needs a distinct admin
// account, not just the single seeded owner.
const ADMIN2_ID = '22222222-2222-4222-8222-222222222225';
// A worker whose deadline falls inside the At Risk (next 7 days) window, for
// the status-tracker nearDeadline section's e2e coverage. Kept separate from
// the always-≥7-days-overdue fixture above.
const NEAR_DEADLINE_WORKER_ID = '22222222-2222-4222-8222-222222222226';
const ENROLLMENT_NEAR_DEADLINE_ID = '88888888-8888-4888-8888-888888888884';
// A worker with NO enrollment in the seeded course yet — the assign-page e2e
// coverage (Issue #2/#5/#4 flows) assigns THIS worker live via the UI, so the
// resulting deadline is genuinely produced by the assign flow under test
// rather than pre-seeded, and doesn't disturb the other enrollment fixtures.
const ASSIGNABLE_WORKER_ID = '22222222-2222-4222-8222-222222222227';
// Phase 3 QA fixtures — both start pre-positioned at progress:100 (lesson
// content already "read"), status in_progress, zero quiz attempts, so their
// specs can go straight to the quiz intro screen without re-deriving that
// setup state in every test run.
// A genuine job-specific worker sub-role (not the seeded roles above, which
// all use front_desk_admin) — regression fixture for the isWorkerRole() fix:
// the attestation gate used to check `role === 'worker'` literally, which no
// real sub-role (including front_desk_admin) ever matches.
const NURSE_ID = '22222222-2222-4222-8222-222222222228';
const ENROLLMENT_NURSE_ID = '88888888-8888-4888-8888-888888888885';
// A worker dedicated to the fail-x3/lockout e2e path, kept separate from
// worker@test.com (already seeded pre-locked for the ENG-022 admin-retake
// spec) so this spec can drive the lock from a fresh in_progress state.
const LOCKOUT_WORKER_ID = '22222222-2222-4222-8222-222222222229';
const ENROLLMENT_LOCKOUT_ID = '88888888-8888-4888-8888-888888888886';
// A second, independent worker for the self-service "Retake Quiz" UI
// journey, kept disjoint from lockoutWorker (which the API-driven
// fail-x3/lockout spec drives to a locked state) so the two specs never
// contend over the same enrollment's attempt history.
const RETAKE_WORKER_ID = '22222222-2222-4222-8222-222222222230';
const ENROLLMENT_RETAKE_ID = '88888888-8888-4888-8888-888888888887';

// A second organization + a user with an ACTIVE membership in BOTH orgs, for
// the org-picker e2e flow (2+ active memberships and no remembered org lands
// on /select-organization instead of auto-selecting).
const SECOND_ORG_SLUG = 'e2e-second-org';
const SECOND_FACILITY_ID = '11111111-1111-4111-8111-111111111112';
const MULTI_ORG_USER_ID = '22222222-2222-4222-8222-222222222231';

// The correct answer is stored as the option TEXT (the worker learn/grading flow
// compares by string equality, not by letter or index).
const QUIZ_OPTIONS = [
  'Report it to your supervisor immediately',
  'Ignore it and continue working',
  'Delete the affected record',
  'Post about it on social media',
];
const QUIZ_CORRECT_ANSWER = QUIZ_OPTIONS[0];

function log(message: string): void {
  process.stdout.write(`[seed] ${message}\n`);
}

async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

interface SeedUserInput {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  /** Reset the membership's manager back to unset on every run (a test fixture some spec assigns live). */
  resetManager?: boolean;
}

/**
 * Upserts the global `User` identity, its `OrganizationUser` membership in the
 * fixed e2e org, and that membership's `OrganizationUserFacility` row — the
 * three rows every seeded staff member needs under the multi-org model.
 */
async function upsertOrgUser(input: SeedUserInput, organizationId: string, facilityId: string) {
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
    },
  });

  const membership = await prisma.organizationUser.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId } },
    update: {
      role: input.role,
      active: true,
      deactivatedAt: null,
      ...(input.resetManager ? { managerId: null } : {}),
    },
    create: { userId: user.id, organizationId, role: input.role },
  });

  await prisma.organizationUserFacility.upsert({
    where: { organizationUserId_facilityId: { organizationUserId: membership.id, facilityId } },
    update: { active: true, deactivatedAt: null },
    create: { organizationUserId: membership.id, facilityId },
  });

  return { user, membership };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('[seed] DATABASE_URL is not set — refusing to seed.');
  }

  // 1. Organization (upsert by slug).
  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: { requireMfa: false },
    create: {
      name: 'E2E Test Organization',
      slug: ORG_SLUG,
      requireMfa: false,
    },
  });
  log(`organization ready (${org.slug})`);

  // 1a. Facility — every membership needs at least one facility assignment.
  const facility = await prisma.facility.upsert({
    where: { id: FACILITY_ID },
    update: { organizationId: org.id },
    create: {
      id: FACILITY_ID,
      organizationId: org.id,
      name: 'E2E Test Facility',
    },
  });
  log(`facility ready (${facility.name})`);

  // 1b. Active subscription — several admin flows (e.g. course creation) are
  // gated behind `hasActiveBilling()`, which requires a `Subscription` row
  // with status active/trialing and no pause. Without this, "Create Course"
  // opens the billing-gate modal instead of navigating to the wizard.
  const subNow = new Date();
  const subPeriodEnd = new Date(subNow);
  subPeriodEnd.setFullYear(subPeriodEnd.getFullYear() + 1);
  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    update: { status: 'active', pausedAt: null, pauseEndsAt: null },
    create: {
      id: SUBSCRIPTION_ID,
      organizationId: org.id,
      stripeSubscriptionId: 'sub_e2e_seed_0001',
      stripePriceId: 'price_e2e_seed_0001',
      plan: 'growth',
      billingCycle: 'yearly',
      status: 'active',
      currentPeriodStart: subNow,
      currentPeriodEnd: subPeriodEnd,
    },
  });
  log('subscription ready (active)');

  // 2. Users + memberships. All users belong to the org (a worker with no org
  //    is bounced to /onboarding-worker), have verified emails, and MFA disabled.
  const [adminPassword, workerPassword, sarahPassword] = await Promise.all([
    hash('Admin123!'),
    hash('TestPassword123!'),
    hash('TestPassword123!'),
  ]);

  const { membership: admin } = await upsertOrgUser(
    {
      id: ADMIN_ID,
      email: 'admin@test.com',
      password: adminPassword,
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'owner',
    },
    org.id,
    facility.id,
  );

  const { membership: worker } = await upsertOrgUser(
    {
      id: WORKER_ID,
      email: 'worker@test.com',
      password: workerPassword,
      firstName: 'Test',
      lastName: 'Worker',
      role: 'front_desk_admin',
      // Must start unset — REM-002 sets the manager during the test run.
      resetManager: true,
    },
    org.id,
    facility.id,
  );

  const { membership: sarah } = await upsertOrgUser(
    {
      id: SARAH_ID,
      email: 'sarah.johnson@company.com',
      password: sarahPassword,
      firstName: 'Sarah',
      lastName: 'Johnson',
      role: 'front_desk_admin',
    },
    org.id,
    facility.id,
  );

  const { membership: overdueWorker } = await upsertOrgUser(
    {
      id: OVERDUE_WORKER_ID,
      email: 'olivia.overdue@test.com',
      password: workerPassword,
      firstName: 'Olivia',
      lastName: 'Overdue',
      role: 'front_desk_admin',
    },
    org.id,
    facility.id,
  );

  const { membership: admin2 } = await upsertOrgUser(
    {
      id: ADMIN2_ID,
      email: 'admin2@test.com',
      password: adminPassword,
      firstName: 'Alex',
      lastName: 'Second',
      role: 'supervisor',
    },
    org.id,
    facility.id,
  );

  const { membership: nearDeadlineWorker } = await upsertOrgUser(
    {
      id: NEAR_DEADLINE_WORKER_ID,
      email: 'nadia.nearing@test.com',
      password: workerPassword,
      firstName: 'Nadia',
      lastName: 'Nearing',
      role: 'front_desk_admin',
    },
    org.id,
    facility.id,
  );

  const { membership: assignableWorker } = await upsertOrgUser(
    {
      id: ASSIGNABLE_WORKER_ID,
      email: 'walt.assignable@test.com',
      password: workerPassword,
      firstName: 'Walt',
      lastName: 'Assignable',
      role: 'front_desk_admin',
    },
    org.id,
    facility.id,
  );
  // Idempotency: the assign-page e2e spec enrolls this worker live via the UI
  // on every run — remove any enrollment/assignment it created on a prior run
  // so re-seeding always restores the pristine "not yet assigned" starting
  // state the spec assumes.
  await prisma.enrollment.deleteMany({ where: { organizationUserId: assignableWorker.id } });

  const { membership: nurse } = await upsertOrgUser(
    {
      id: NURSE_ID,
      email: 'nina.nurse@test.com',
      password: workerPassword,
      firstName: 'Nina',
      lastName: 'Nurse',
      role: 'nurse',
    },
    org.id,
    facility.id,
  );

  const { membership: lockoutWorker } = await upsertOrgUser(
    {
      id: LOCKOUT_WORKER_ID,
      email: 'larry.lockout@test.com',
      password: workerPassword,
      firstName: 'Larry',
      lastName: 'Lockout',
      role: 'front_desk_admin',
    },
    org.id,
    facility.id,
  );

  const { membership: retakeWorker } = await upsertOrgUser(
    {
      id: RETAKE_WORKER_ID,
      email: 'rita.retake@test.com',
      password: workerPassword,
      firstName: 'Rita',
      lastName: 'Retake',
      role: 'front_desk_admin',
    },
    org.id,
    facility.id,
  );
  log(
    'users + memberships ready (admin, admin2, worker, sarah, overdueWorker, nearDeadlineWorker, assignableWorker, nurse, lockoutWorker, retakeWorker)',
  );

  // 3. Document + version owned by the admin (feeds the ENG-024 wizard picker).
  await prisma.document.upsert({
    where: { id: DOC_ID },
    update: { organizationUserId: admin.id },
    create: {
      id: DOC_ID,
      organizationUserId: admin.id,
      filename: 'e2e-compliance-policy.pdf',
      originalName: 'Compliance Policy.pdf',
      mimeType: 'application/pdf',
      size: 24_576,
    },
  });
  await prisma.documentVersion.upsert({
    where: { id: DOC_VERSION_ID },
    update: {},
    create: {
      id: DOC_VERSION_ID,
      documentId: DOC_ID,
      version: 1,
      storagePath: 'e2e/documents/e2e-compliance-policy.pdf',
      hash: 'e2e-seed-doc-hash-0001',
      content: 'Employees must report any suspected data breach to their supervisor immediately.',
    },
  });
  // Second document, owned by admin2 — Document Hub full-parity e2e coverage
  // needs a document uploaded by a DIFFERENT org admin than the one logging in.
  const DOC2_ID = '33333333-3333-4333-8333-333333333333';
  const DOC2_VERSION_ID = '33333333-3333-4333-8333-333333333334';
  await prisma.document.upsert({
    where: { id: DOC2_ID },
    update: { organizationUserId: admin2.id },
    create: {
      id: DOC2_ID,
      organizationUserId: admin2.id,
      filename: 'e2e-admin2-policy.pdf',
      originalName: 'Admin2 Policy.pdf',
      mimeType: 'application/pdf',
      size: 12_288,
    },
  });
  await prisma.documentVersion.upsert({
    where: { id: DOC2_VERSION_ID },
    update: {},
    create: {
      id: DOC2_VERSION_ID,
      documentId: DOC2_ID,
      version: 1,
      storagePath: 'e2e/documents/e2e-admin2-policy.pdf',
      hash: 'e2e-seed-doc-hash-0002',
      content: 'This document was uploaded by the second seeded org admin.',
    },
  });
  log('document + version ready (admin, admin2)');

  // 4. Published text course (created by the admin, isGlobal:false → appears in
  //    the admin course list via getCourses() without an OrgCourseOffering row),
  //    with a lesson and a course-level quiz (worker learn flow reads
  //    course.quiz — so the quiz attaches via courseId, not lessonId).
  await prisma.course.upsert({
    where: { id: COURSE_ID },
    update: { status: 'published', createdByOrgUserId: admin.id },
    create: {
      id: COURSE_ID,
      title: 'E2E Compliance Training',
      description: 'A seeded compliance course used by the Playwright e2e suite.',
      status: 'published',
      type: 'text',
      isGlobal: false,
      createdByOrgUserId: admin.id,
      category: 'Compliance',
      overview: 'Learn how to handle sensitive records and report incidents.',
      objectives: ['Recognize a data breach', 'Report incidents correctly'],
    },
  });
  await prisma.lesson.upsert({
    where: { id: LESSON_ID },
    update: {},
    create: {
      id: LESSON_ID,
      courseId: COURSE_ID,
      title: 'Handling Sensitive Records',
      content:
        'Sensitive records must be protected at all times. If you suspect a breach, ' +
        'report it to your supervisor immediately rather than acting on your own.',
      order: 0,
    },
  });
  await prisma.quiz.upsert({
    where: { id: QUIZ_ID },
    update: { courseId: COURSE_ID },
    create: {
      id: QUIZ_ID,
      courseId: COURSE_ID,
      title: 'Compliance Assessment',
      passingScore: 70,
      allowedAttempts: 3,
    },
  });
  await prisma.question.upsert({
    where: { id: QUESTION_ID },
    update: {
      options: QUIZ_OPTIONS,
      correctAnswer: QUIZ_CORRECT_ANSWER,
    },
    create: {
      id: QUESTION_ID,
      quizId: QUIZ_ID,
      text: 'What should you do if you suspect a data breach?',
      type: 'multiple_choice',
      options: QUIZ_OPTIONS,
      correctAnswer: QUIZ_CORRECT_ANSWER,
      order: 0,
    },
  });
  log('course + lesson + quiz + question ready');

  // 5. Enrollments:
  //    - sarah: in_progress (feeds the ENG-020 quiz-taking flow).
  //    - worker: locked with a failing score (feeds the ENG-022 admin
  //      "Assign Retake" surface — assignRetake() only accepts a `locked`
  //      enrollment, matching the RowActionsMenu's own `status !== 'locked'`
  //      disabled guard in TrainingDetails.tsx).
  //
  // Quiz attempts are NOT idempotent by nature: ENG-020 actually interacts with
  // the quiz (selecting an answer autosaves an in-progress QuizAttempt against
  // sarah's enrollment). If a later `db seed` run only upserted the enrollment's
  // status/progress, that leftover QuizAttempt (time_taken IS NULL) would make
  // the learn page restore straight into the ACTIVE quiz view on next load,
  // skipping the lesson content entirely — so "Proceed to Quiz" never renders
  // and the suite is no longer safely re-runnable. Delete any quiz attempts
  // tied to the seeded enrollments first, then reset every mutable enrollment
  // field back to its pristine value, so re-seeding always restores the exact
  // fixture state the specs assume — not just on a fresh database.
  await prisma.quizAttempt.deleteMany({
    where: {
      enrollmentId: {
        in: [
          ENROLLMENT_SARAH_ID,
          ENROLLMENT_WORKER_ID,
          ENROLLMENT_NURSE_ID,
          ENROLLMENT_LOCKOUT_ID,
          ENROLLMENT_RETAKE_ID,
        ],
      },
    },
  });

  // ENG-022 actually calls assignRetake(), which — on success — creates a NEW
  // enrollment row (`retakeOf: ENROLLMENT_WORKER_ID`, status 'enrolled') and a
  // RETAKE_ASSIGNED notification for the worker. assignRetake() refuses to run
  // again while an 'enrolled' retake already exists ("An active retake already
  // exists for this enrollment"), so without cleanup here the SECOND full
  // suite run would fail. Delete both before every seed run.
  await prisma.enrollment.deleteMany({
    where: { retakeOf: { in: [ENROLLMENT_SARAH_ID, ENROLLMENT_WORKER_ID] } },
  });
  await prisma.notification.deleteMany({
    where: { organizationUserId: { in: [worker.id, sarah.id] }, type: 'RETAKE_ASSIGNED' },
  });

  // The Assign-page e2e specs (reminders.spec.ts) exercise enrollUsers/
  // assignCourseToRole against this SAME seeded course, and both upsert a
  // single (organizationId, courseId) CourseAssignment row. Without resetting
  // it, a role-target run (targetRole set) or a due-date run from a PRIOR
  // suite execution persists into the next run and changes which mode
  // (people/role) the Assign page opens in by default — breaking specs that
  // assume the pristine "not yet assigned" starting state. The cascade
  // (schema onDelete) removes its AssignmentReminderStage rows too.
  await prisma.courseAssignment.deleteMany({ where: { courseId: COURSE_ID } });

  const now = new Date();
  await prisma.enrollment.upsert({
    where: { id: ENROLLMENT_SARAH_ID },
    update: {
      status: 'in_progress',
      progress: 10,
      score: null,
      completedAt: null,
      lockedAt: null,
      retakeOf: null,
      retakeReason: null,
    },
    create: {
      id: ENROLLMENT_SARAH_ID,
      organizationUserId: sarah.id,
      courseId: COURSE_ID,
      status: 'in_progress',
      progress: 10,
      startedAt: now,
    },
  });
  await prisma.enrollment.upsert({
    where: { id: ENROLLMENT_WORKER_ID },
    update: {
      status: 'locked',
      progress: 100,
      score: 40,
      completedAt: null,
      lockedAt: now,
      retakeOf: null,
      retakeReason: null,
    },
    create: {
      id: ENROLLMENT_WORKER_ID,
      organizationUserId: worker.id,
      courseId: COURSE_ID,
      status: 'locked',
      progress: 100,
      score: 40,
      startedAt: now,
      lockedAt: now,
    },
  });
  // Overdue enrollment for the Status Tracker fixtures: dueAt is always computed
  // relative to "now" at seed time (10 days ago), so it stays ≥7 days overdue
  // (the HARD_ESCALATION threshold) on every run regardless of when CI executes.
  const tenDaysAgo = new Date(now);
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  await prisma.enrollment.upsert({
    where: { id: ENROLLMENT_OVERDUE_ID },
    update: {
      status: 'in_progress',
      progress: 0,
      score: null,
      completedAt: null,
      lockedAt: null,
      retakeOf: null,
      retakeReason: null,
      dueAt: tenDaysAgo,
    },
    create: {
      id: ENROLLMENT_OVERDUE_ID,
      organizationUserId: overdueWorker.id,
      courseId: COURSE_ID,
      status: 'in_progress',
      progress: 0,
      startedAt: now,
      dueAt: tenDaysAgo,
    },
  });
  // Near-deadline enrollment for the status-tracker "At Risk — Next 7 Days"
  // section: due in 3 days from seed time, so it always lands inside the fixed
  // 7-day window regardless of when CI executes, and stays disjoint from the
  // always-overdue fixture above.
  const threeDaysFromNow = new Date(now);
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
  await prisma.enrollment.upsert({
    where: { id: ENROLLMENT_NEAR_DEADLINE_ID },
    update: {
      status: 'in_progress',
      progress: 20,
      score: null,
      completedAt: null,
      lockedAt: null,
      retakeOf: null,
      retakeReason: null,
      dueAt: threeDaysFromNow,
    },
    create: {
      id: ENROLLMENT_NEAR_DEADLINE_ID,
      organizationUserId: nearDeadlineWorker.id,
      courseId: COURSE_ID,
      status: 'in_progress',
      progress: 20,
      startedAt: now,
      dueAt: threeDaysFromNow,
    },
  });
  // Nurse + lockout-worker enrollments: progress:100 (lesson content already
  // "read") so their specs land straight on the quiz intro screen, in_progress
  // with zero quiz attempts (reset above alongside sarah/worker).
  await prisma.enrollment.upsert({
    where: { id: ENROLLMENT_NURSE_ID },
    update: {
      status: 'in_progress',
      progress: 100,
      score: null,
      completedAt: null,
      attestedAt: null,
      attestationSignature: null,
      lockedAt: null,
      retakeOf: null,
      retakeReason: null,
    },
    create: {
      id: ENROLLMENT_NURSE_ID,
      organizationUserId: nurse.id,
      courseId: COURSE_ID,
      status: 'in_progress',
      progress: 100,
      startedAt: now,
    },
  });
  await prisma.enrollment.upsert({
    where: { id: ENROLLMENT_LOCKOUT_ID },
    update: {
      status: 'in_progress',
      progress: 100,
      score: null,
      completedAt: null,
      attestedAt: null,
      attestationSignature: null,
      lockedAt: null,
      retakeOf: null,
      retakeReason: null,
    },
    create: {
      id: ENROLLMENT_LOCKOUT_ID,
      organizationUserId: lockoutWorker.id,
      courseId: COURSE_ID,
      status: 'in_progress',
      progress: 100,
      startedAt: now,
    },
  });

  await prisma.enrollment.upsert({
    where: { id: ENROLLMENT_RETAKE_ID },
    update: {
      status: 'in_progress',
      progress: 100,
      score: null,
      completedAt: null,
      attestedAt: null,
      attestationSignature: null,
      lockedAt: null,
      retakeOf: null,
      retakeReason: null,
    },
    create: {
      id: ENROLLMENT_RETAKE_ID,
      organizationUserId: retakeWorker.id,
      courseId: COURSE_ID,
      status: 'in_progress',
      progress: 100,
      startedAt: now,
    },
  });

  log(
    'enrollments ready (sarah in_progress, worker locked, overdueWorker 10d overdue, nearDeadlineWorker due in 3d, nurse + lockoutWorker + retakeWorker at progress:100; retakes + quiz attempts reset)',
  );

  // 5. Second organization + a user with an active membership in BOTH orgs —
  //    exercises the 2+-membership login path (org picker) end-to-end.
  const secondOrg = await prisma.organization.upsert({
    where: { slug: SECOND_ORG_SLUG },
    update: { requireMfa: false },
    create: {
      name: 'E2E Second Organization',
      slug: SECOND_ORG_SLUG,
      requireMfa: false,
    },
  });
  const secondFacility = await prisma.facility.upsert({
    where: { id: SECOND_FACILITY_ID },
    update: { organizationId: secondOrg.id },
    create: {
      id: SECOND_FACILITY_ID,
      organizationId: secondOrg.id,
      name: 'E2E Second Facility',
    },
  });
  const multiOrgPassword = await hash('MultiOrg123!');
  // Membership in the primary e2e org — picker card 1.
  await upsertOrgUser(
    {
      id: MULTI_ORG_USER_ID,
      email: 'multi.org@test.com',
      password: multiOrgPassword,
      firstName: 'Morgan',
      lastName: 'Multi',
      role: 'hr',
    },
    org.id,
    facility.id,
  );
  // Membership in the second org — picker card 2. Same identity, different
  // (org, role) pair; upsertOrgUser upserts the User by email idempotently.
  await upsertOrgUser(
    {
      id: MULTI_ORG_USER_ID,
      email: 'multi.org@test.com',
      password: multiOrgPassword,
      firstName: 'Morgan',
      lastName: 'Multi',
      role: 'owner',
    },
    secondOrg.id,
    secondFacility.id,
  );
  // Always start from "no remembered org" so the picker is deterministic —
  // the org-switch e2e spec sets this live and must not leak into re-seeds.
  await prisma.user.update({
    where: { id: MULTI_ORG_USER_ID },
    data: { lastActiveOrganizationId: null },
  });
  log('second organization + multi-membership user ready (multi.org@test.com in 2 orgs)');

  log('seed complete');
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `[seed] failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
