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
import { BCRYPT_COST } from '../src/lib/bcrypt-config';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ── Fixed identifiers ────────────────────────────────────────────────────────
// Hard-coded UUIDs keep the seed idempotent: upserting by these keys updates the
// same rows on every run instead of accumulating duplicates.
const ORG_SLUG = 'e2e-test-org';
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
const SUBSCRIPTION_ID = '99999999-9999-4999-8999-999999999991';

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
      plan: 'professional',
      billingCycle: 'yearly',
      status: 'active',
      currentPeriodStart: subNow,
      currentPeriodEnd: subPeriodEnd,
    },
  });
  log('subscription ready (active)');

  // 2. Users + profiles. All users belong to the org (a worker with no org is
  //    bounced to /onboarding-worker), have verified emails, and MFA disabled.
  const [adminPassword, workerPassword, sarahPassword] = await Promise.all([
    hash('Admin123!'),
    hash('TestPassword123!'),
    hash('TestPassword123!'),
  ]);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@test.com' },
    update: {
      password: adminPassword,
      role: 'admin',
      emailVerified: true,
      mfaEnabled: false,
      organizationId: org.id,
      passwordResetRequired: false,
    },
    create: {
      id: ADMIN_ID,
      email: 'admin@test.com',
      password: adminPassword,
      role: 'admin',
      emailVerified: true,
      mfaEnabled: false,
      organizationId: org.id,
      authProvider: 'credentials',
    },
  });
  await prisma.profile.upsert({
    where: { id: admin.id },
    update: { fullName: 'Jane Doe', firstName: 'Jane', lastName: 'Doe' },
    create: {
      id: admin.id,
      email: 'admin@test.com',
      fullName: 'Jane Doe',
      firstName: 'Jane',
      lastName: 'Doe',
    },
  });

  const worker = await prisma.user.upsert({
    where: { email: 'worker@test.com' },
    update: {
      password: workerPassword,
      role: 'worker',
      emailVerified: true,
      mfaEnabled: false,
      organizationId: org.id,
      // Must start unset — REM-002 sets the manager during the test run.
      managerId: null,
      passwordResetRequired: false,
    },
    create: {
      id: WORKER_ID,
      email: 'worker@test.com',
      password: workerPassword,
      role: 'worker',
      emailVerified: true,
      mfaEnabled: false,
      organizationId: org.id,
      authProvider: 'credentials',
    },
  });
  await prisma.profile.upsert({
    where: { id: worker.id },
    update: { fullName: 'Test Worker', firstName: 'Test', lastName: 'Worker' },
    create: {
      id: worker.id,
      email: 'worker@test.com',
      fullName: 'Test Worker',
      firstName: 'Test',
      lastName: 'Worker',
    },
  });

  const sarah = await prisma.user.upsert({
    where: { email: 'sarah.johnson@company.com' },
    update: {
      password: sarahPassword,
      role: 'worker',
      emailVerified: true,
      mfaEnabled: false,
      organizationId: org.id,
      passwordResetRequired: false,
    },
    create: {
      id: SARAH_ID,
      email: 'sarah.johnson@company.com',
      password: sarahPassword,
      role: 'worker',
      emailVerified: true,
      mfaEnabled: false,
      organizationId: org.id,
      authProvider: 'credentials',
    },
  });
  await prisma.profile.upsert({
    where: { id: sarah.id },
    update: { fullName: 'Sarah Johnson', firstName: 'Sarah', lastName: 'Johnson' },
    create: {
      id: sarah.id,
      email: 'sarah.johnson@company.com',
      fullName: 'Sarah Johnson',
      firstName: 'Sarah',
      lastName: 'Johnson',
    },
  });
  log('users + profiles ready (admin, worker, sarah)');

  // 3. Document + version owned by the admin (feeds the ENG-024 wizard picker).
  await prisma.document.upsert({
    where: { id: DOC_ID },
    update: { userId: admin.id },
    create: {
      id: DOC_ID,
      userId: admin.id,
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
  log('document + version ready');

  // 4. Published text course (created by the admin, isGlobal:false → appears in
  //    the admin course list via getCourses() without an OrgCourseOffering row),
  //    with a lesson and a course-level quiz (worker learn flow reads
  //    course.quiz — so the quiz attaches via courseId, not lessonId).
  await prisma.course.upsert({
    where: { id: COURSE_ID },
    update: { status: 'published', createdBy: admin.id },
    create: {
      id: COURSE_ID,
      title: 'E2E Compliance Training',
      description: 'A seeded compliance course used by the Playwright e2e suite.',
      status: 'published',
      type: 'text',
      isGlobal: false,
      createdBy: admin.id,
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
    where: { enrollmentId: { in: [ENROLLMENT_SARAH_ID, ENROLLMENT_WORKER_ID] } },
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
    where: { userId: { in: [worker.id, sarah.id] }, type: 'RETAKE_ASSIGNED' },
  });

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
      userId: sarah.id,
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
      userId: worker.id,
      courseId: COURSE_ID,
      status: 'locked',
      progress: 100,
      score: 40,
      startedAt: now,
      lockedAt: now,
    },
  });
  log('enrollments ready (sarah in_progress, worker locked; retakes + quiz attempts reset)');

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
