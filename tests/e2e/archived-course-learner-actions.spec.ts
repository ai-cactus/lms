/**
 * E2E spec: archiving a course CANCELS it for learners (founder rulings
 * Q-04/Q-05/Q-06/Q-21, #681).
 *
 * Seeds an archived course directly via raw SQL (the pattern already used by
 * course-details-hero.spec.ts / no-quiz-course-attestation.spec.ts) and drives
 * four things live:
 *
 *   1. A learner with an ACTIVE (in-progress) enrollment in the now-archived
 *      course sees "Cancelled" on their course list, and the row's action is
 *      genuinely disabled (a real `disabled` HTML button, not just styled to
 *      look inert) — Q-21.
 *   2. That learner cannot open the player directly: `/learn/[id]` answers
 *      with the site's "Page Not Found" page (get-learn-payload.ts collapses
 *      its internal 403 into the same 404 the caller sees, on purpose, so a
 *      learner who may not open the course cannot tell whether it exists).
 *   3. The learner's direct API calls are refused too — the UI being inert is
 *      not the gate: quiz start answers 403 `COURSE_ARCHIVED`, the lesson
 *      progress route answers 403 with the learner message, and the stored
 *      progress does not move.
 *   4. A SEPARATE learner who genuinely earned a certificate through the real
 *      quiz + attestation flow BEFORE the course was archived can still
 *      download it afterward — `issueCertificate`/the certificate download
 *      route are deliberately left ungated by the archived check.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - DATABASE_URL reachable for direct DB seeding.
 *   - MinIO reachable — issueCertificate() falls back to it when GCS is
 *     unconfigured (same constraint documented in quiz-retake-attestation.spec.ts).
 *     Brought up automatically by `npm run e2e:local`.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import net from 'net';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

const ARCHIVED_COURSE_LEARNER_MESSAGE =
  'This course has been cancelled by your organization and is no longer available.';

function isMinioReachable(): Promise<boolean> {
  const host = process.env.MINIO_ENDPOINT || 'localhost';
  const port = Number(process.env.MINIO_PORT) || 9000;
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 800 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@archived-course-e2e.invalid`;
}

interface Seeded {
  orgId: string;
  facilityId: string;
  adminOrgUserId: string;
  courseId: string;
  quizId: string;
  lessonId: string;
  certWorkerId: string;
  certOrgUserId: string;
  certEmail: string;
  certPassword: string;
  inProgressWorkerId: string;
  inProgressOrgUserId: string;
  inProgressEmail: string;
  inProgressPassword: string;
  inProgressEnrollmentId: string;
}

async function seedFixture(): Promise<Seeded> {
  const client = await db();
  try {
    const slug = `archived-course-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const adminId = crypto.randomUUID();
    const adminOrgUserId = crypto.randomUUID();
    const courseId = crypto.randomUUID();
    const lessonId = crypto.randomUUID();
    const quizId = crypto.randomUUID();
    const questionId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Archived Course E2E ${slug}`, slug, uid('org')],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Archived Course Facility ${slug}`],
    );

    const periodStart = new Date();
    const periodEnd = new Date(periodStart);
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    await client.query(
      `INSERT INTO subscriptions (
         id, organization_id, stripe_subscription_id, stripe_price_id, plan,
         billing_cycle, status, current_period_start, current_period_end,
         cancel_at_period_end, paused_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'growth'::"SubscriptionPlan", 'yearly'::"SubscriptionBillingCycle",
         'active'::"SubscriptionStatus", $5, $6, false, NULL, NOW(), NOW())`,
      [
        crypto.randomUUID(),
        orgId,
        `sub_e2e_${crypto.randomBytes(6).toString('hex')}`,
        `price_e2e_${crypto.randomBytes(6).toString('hex')}`,
        periodStart,
        periodEnd,
      ],
    );

    const adminEmail = uid('admin');
    const adminHashed = await bcrypt.hash('unused-not-logged-in', 10);
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Archive', 'Admin', $4, NOW(), NOW())`,
      [adminId, adminEmail, adminHashed, 'Archive Admin'],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [adminOrgUserId, adminId, orgId],
    );

    // certWorkerId: earns a REAL certificate through the live quiz + attest
    // flow while the course is still published — the case that must survive
    // archival.
    const certWorkerId = crypto.randomUUID();
    const certOrgUserId = crypto.randomUUID();
    const certPassword = 'ArchivedCourseCert!9';
    const certEmail = uid('cert-worker');
    const certHashed = await bcrypt.hash(certPassword, 10);
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Cert', 'Worker', $4, NOW(), NOW())`,
      [certWorkerId, certEmail, certHashed, 'Cert Worker'],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [certOrgUserId, certWorkerId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), certOrgUserId, facilityId],
    );

    // inProgressWorkerId: mid-course when the archive lands — the case that
    // must be cancelled and read as such.
    const inProgressWorkerId = crypto.randomUUID();
    const inProgressOrgUserId = crypto.randomUUID();
    const inProgressPassword = 'ArchivedCourseInProgress!9';
    const inProgressEmail = uid('inprogress-worker');
    const inProgressHashed = await bcrypt.hash(inProgressPassword, 10);
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'InProgress', 'Worker', $4, NOW(), NOW())`,
      [inProgressWorkerId, inProgressEmail, inProgressHashed, 'InProgress Worker'],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [inProgressOrgUserId, inProgressWorkerId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), inProgressOrgUserId, facilityId],
    );

    await client.query(
      `INSERT INTO courses (
         id, title, description, status, created_by_org_user_id, organization_id,
         type, is_global, review_required, created_at, updated_at
       ) VALUES ($1, $2, $3, 'published'::"CourseStatus", $4, $5, 'text'::"CourseType", false, false, NOW(), NOW())`,
      [
        courseId,
        `Archived Course E2E Course ${slug}`,
        'A course seeded to exercise post-archival learner refusals.',
        adminOrgUserId,
        orgId,
      ],
    );
    await client.query(
      `INSERT INTO lessons (id, course_id, title, content, "order", media_status, created_at, updated_at)
       VALUES ($1, $2, 'Module 1', $3, 0, 'ready'::"MediaStatus", NOW(), NOW())`,
      [lessonId, courseId, '<p>Lesson content for the archived-course spec.</p>'],
    );
    await client.query(
      `INSERT INTO quizzes (id, lesson_id, title, passing_score, allowed_attempts, created_at)
       VALUES ($1, $2, 'Archived Course E2E Quiz', 70, 3, NOW())`,
      [quizId, lessonId],
    );
    await client.query(
      `INSERT INTO questions (id, quiz_id, text, type, options, correct_answer, "order")
       VALUES ($1, $2, $3, 'multiple_choice', $4::jsonb, $5, 0)`,
      [
        questionId,
        quizId,
        'What do you do when this course is archived?',
        JSON.stringify(['Stop', 'Continue anyway', 'Ignore it', 'Escalate']),
        'Stop',
      ],
    );

    const inProgressEnrollmentId = crypto.randomUUID();
    await client.query(
      `INSERT INTO enrollments (id, course_id, organization_user_id, facility_id, status, progress, started_at)
       VALUES ($1, $2, $3, $4, 'in_progress'::"EnrollmentStatus", 40, NOW())`,
      [inProgressEnrollmentId, courseId, inProgressOrgUserId, facilityId],
    );
    // Without an enrollment row, the course never appears on the cert
    // worker's dashboard at all — 'enrolled' with no progress, matching a
    // course they have been assigned but not yet started.
    await client.query(
      `INSERT INTO enrollments (id, course_id, organization_user_id, facility_id, status, progress, started_at)
       VALUES ($1, $2, $3, $4, 'enrolled'::"EnrollmentStatus", 0, NOW())`,
      [crypto.randomUUID(), courseId, certOrgUserId, facilityId],
    );

    return {
      orgId,
      facilityId,
      adminOrgUserId,
      courseId,
      quizId,
      lessonId,
      certWorkerId,
      certOrgUserId,
      certEmail,
      certPassword,
      inProgressWorkerId,
      inProgressOrgUserId,
      inProgressEmail,
      inProgressPassword,
      inProgressEnrollmentId,
    };
  } finally {
    await client.end();
  }
}

async function archiveCourse(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    await client.query(
      `UPDATE courses SET archived_at = NOW(), archived_by_org_user_id = $1 WHERE id = $2`,
      [seeded.adminOrgUserId, seeded.courseId],
    );
  } finally {
    await client.end();
  }
}

async function getEnrollmentProgress(enrollmentId: string): Promise<number> {
  const client = await db();
  try {
    const { rows } = await client.query(`SELECT progress FROM enrollments WHERE id = $1`, [
      enrollmentId,
    ]);
    return rows[0].progress;
  } finally {
    await client.end();
  }
}

async function getCertificateId(courseId: string, orgUserId: string): Promise<string> {
  const client = await db();
  try {
    const { rows } = await client.query(
      `SELECT c.id FROM certificates c
       JOIN enrollments e ON e.id = c.enrollment_id
       WHERE e.course_id = $1 AND e.organization_user_id = $2`,
      [courseId, orgUserId],
    );
    if (rows.length !== 1) {
      throw new Error(
        `Expected exactly one certificate for course=${courseId} org_user=${orgUserId}, found ${rows.length}`,
      );
    }
    return rows[0].id;
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    await client.query(
      `DELETE FROM certificates WHERE enrollment_id IN (
      SELECT id FROM enrollments WHERE course_id = $1
    )`,
      [seeded.courseId],
    );
    await client.query(
      `DELETE FROM quiz_attempts WHERE enrollment_id IN (
      SELECT id FROM enrollments WHERE course_id = $1
    )`,
      [seeded.courseId],
    );
    await client.query(`DELETE FROM enrollments WHERE course_id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM notifications WHERE organization_user_id = ANY($1)`, [
      [seeded.adminOrgUserId, seeded.certOrgUserId, seeded.inProgressOrgUserId],
    ]);
    await client.query(`DELETE FROM questions WHERE quiz_id = $1`, [seeded.quizId]);
    await client.query(`DELETE FROM quizzes WHERE id = $1`, [seeded.quizId]);
    await client.query(`DELETE FROM lessons WHERE course_id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM courses WHERE id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [[seeded.certOrgUserId, seeded.inProgressOrgUserId]],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [
      [seeded.adminOrgUserId, seeded.certOrgUserId, seeded.inProgressOrgUserId],
    ]);
    // Deleted by the shared email suffix, not by exact id: unlike
    // course-details-hero.spec.ts this spec's two tests run sequentially, not
    // concurrently, so a wildcard DELETE here cannot race another still-running
    // test's rows.
    await client.query(`DELETE FROM users WHERE email LIKE $1`, ['%@archived-course-e2e.invalid']);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

async function loginAsWorker(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/worker');
}

test.describe('Archived course cancels it for learners (Q-04/Q-05/Q-06, Q-21)', () => {
  test('an in-progress learner sees Cancelled with a disabled action, /learn/[id] 404s and the API refuses, once the course is archived', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const seeded = await seedFixture();

    try {
      await archiveCourse(seeded);

      await loginAsWorker(page, seeded.inProgressEmail, seeded.inProgressPassword);

      // Q-21: the row stays on the list (history must not vanish) and reads
      // as cancelled.
      const row = page.locator('tr', { hasText: 'Archived Course E2E Course' });
      await expect(row).toBeVisible();
      await expect(row.getByText('Cancelled')).toBeVisible();

      // Disabled rather than hidden or merely styled to look inert — a real
      // HTML `disabled` button, which the browser itself refuses to click.
      const actionButton = row.getByRole('button', { name: 'Continue' });
      await expect(actionButton).toBeDisabled();

      // Direct navigation to the player must not leak whether the course
      // exists — a learner who may not open it sees the same 404 as a
      // nonexistent id.
      await page.goto(`/learn/${seeded.courseId}`);
      await expect(page.getByRole('heading', { name: 'Page Not Found' })).toBeVisible();

      // Q-04: the server refuses the learner's actions on its own, whatever
      // the UI offers. `page.request` carries the learner's session cookies.
      const quizStart = await page.request.post(`/api/quiz/${seeded.quizId}/start`, {
        data: { enrollmentId: seeded.inProgressEnrollmentId },
      });
      expect(quizStart.status()).toBe(403);
      expect(await quizStart.json()).toEqual({
        error: 'COURSE_ARCHIVED',
        message: ARCHIVED_COURSE_LEARNER_MESSAGE,
      });

      const progress = await page.request.post(
        `/api/enrollments/${seeded.inProgressEnrollmentId}/progress`,
        { data: { progress: 80 } },
      );
      expect(progress.status()).toBe(403);
      expect(await progress.json()).toEqual({ error: ARCHIVED_COURSE_LEARNER_MESSAGE });
      expect(await getEnrollmentProgress(seeded.inProgressEnrollmentId)).toBe(40);
    } finally {
      await cleanup(seeded);
    }
  });

  test('a certificate earned before archival is still downloadable afterward', async ({ page }) => {
    test.setTimeout(90_000);
    test.skip(
      !(await isMinioReachable()),
      'Local MinIO not running — issueCertificate() falls back to MinIO when GCS is ' +
        'unconfigured, so certificate-PDF upload cannot complete here (same constraint ' +
        'documented in quiz-retake-attestation.spec.ts).',
    );
    const seeded = await seedFixture();

    try {
      // Earn the certificate for real, through the live quiz + attest flow,
      // BEFORE the course is archived.
      await loginAsWorker(page, seeded.certEmail, seeded.certPassword);
      await page.goto(`/worker/courses/${seeded.courseId}`);
      await page.waitForLoadState('networkidle');
      await page
        .getByRole('button', { name: /continue course|start course|resume course/i })
        .click();
      await page.waitForURL('**/learn/**');

      await page.getByRole('button', { name: 'Proceed to Quiz' }).click();
      await page.getByRole('button', { name: 'Start Quiz' }).click();
      await page.locator('[data-quiz-option="0"]').click(); // "Stop" — the correct answer
      await page.getByRole('button', { name: /Submit Quiz/ }).click();
      await expect(page.getByText(/nice work/i)).toBeVisible();

      const attestButton = page.getByRole('button', { name: 'Attest' });
      await expect(attestButton).toBeVisible();
      await attestButton.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await page.getByLabel('Name').fill('Cert Worker');
      await dialog.getByRole('checkbox').nth(0).click();
      await dialog.getByRole('checkbox').nth(1).click();
      await dialog.getByRole('button', { name: 'Confirm' }).click();
      await expect(page.getByText("Well done! You've earned a Certificate!")).toBeVisible({
        timeout: 10000,
      });

      const certificateId = await getCertificateId(seeded.courseId, seeded.certOrgUserId);

      // NOW archive the course — after the certificate already exists.
      await archiveCourse(seeded);

      // The download route is deliberately left ungated by the archived
      // check: the certificate is read from the Certificate table, not
      // re-derived from the (now-cancelled) course/enrollment state.
      const response = await page.request.get(`/api/certificates/${certificateId}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('pdf');
      const body = await response.body();
      expect(body.length).toBeGreaterThan(0);
    } finally {
      await cleanup(seeded);
    }
  });
});
