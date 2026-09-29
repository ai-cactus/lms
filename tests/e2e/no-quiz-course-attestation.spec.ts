/**
 * E2E spec: a course with NO quiz can be completed (BUG-28), and completing it
 * cannot be replayed (RISK-10).
 *
 * Attestation is this product's completion act, and `AttestationModal` used to
 * render only from `QuizResults` — so a course with neither a lesson- nor a
 * course-level quiz reached `lessons_complete` and stopped there for good. The
 * learn player now ends such a course with "Complete Course & Attest", which
 * opens the same modal and runs the same `attestCourse` + `issueCertificate`
 * path the quiz results screen uses.
 *
 * The attestation is asserted in the DATABASE, not only on screen:
 * `attestCourse` writes `attested` before `issueCertificate` runs, so the
 * compliance record is provable even where certificate upload cannot complete
 * (local sandboxes without MinIO — see quiz-retake-attestation.spec.ts). The
 * certificate success modal is asserted only when MinIO is reachable.
 *
 * Pre-conditions:
 *   - App running on the Playwright webServer.
 *   - DATABASE_URL reachable for direct DB seeding.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import net from 'net';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

const WORKER_PASSWORD = 'NoQuizAttest!9';
const SIGNATURE = 'Nora NoQuiz';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@no-quiz-attestation-e2e.invalid`;
}

/** Same probe as quiz-retake-attestation.spec.ts: certificate upload needs MinIO here. */
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

interface Seeded {
  orgId: string;
  facilityId: string;
  userIds: string[];
  orgUserIds: string[];
  workerEmail: string;
  courseId: string;
  enrollmentId: string;
}

async function seedFixture(): Promise<Seeded> {
  const client = await db();
  try {
    const slug = `no-quiz-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `No-Quiz Attestation E2E ${slug}`, slug, uid('org')],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `No-Quiz Facility ${slug}`],
    );
    // A raw-seeded org needs an active subscription or the worker billing gate
    // turns the learner away before the course opens.
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

    const seedMember = async (role: string, email: string, first: string, last: string) => {
      const userId = crypto.randomUUID();
      const orgUserId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
         VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
        [userId, email, await bcrypt.hash(WORKER_PASSWORD, 10), first, last, `${first} ${last}`],
      );
      await client.query(
        `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
        [orgUserId, userId, orgId, role],
      );
      await client.query(
        `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
         VALUES ($1, $2, $3, true, NOW())`,
        [crypto.randomUUID(), orgUserId, facilityId],
      );
      return { userId, orgUserId };
    };

    // The owner authors the course (`created_by_org_user_id` is a NOT NULL FK)
    // and never logs in.
    const owner = await seedMember('owner', uid('owner'), 'NoQuiz', 'Owner');
    const workerEmail = uid('worker');
    // A full name is required for certificate issuance.
    const worker = await seedMember('nurse', workerEmail, 'Nora', 'NoQuiz');

    const courseId = crypto.randomUUID();
    await client.query(
      `INSERT INTO courses (
         id, title, description, status, created_by_org_user_id, organization_id,
         type, is_global, review_required, created_at, updated_at
       ) VALUES ($1, $2, $3, 'published'::"CourseStatus", $4, $5, 'text'::"CourseType", false, false, NOW(), NOW())`,
      [courseId, `No-Quiz Course ${slug}`, 'A course with no quiz at all.', owner.orgUserId, orgId],
    );
    // One lesson and deliberately NO quiz row anywhere — neither on the lesson
    // nor on the course.
    await client.query(
      `INSERT INTO lessons (id, course_id, title, content, "order", media_status, created_at, updated_at)
       VALUES ($1, $2, 'Module 1', '<p>Everything there is to know.</p>', 0, 'ready'::"MediaStatus", NOW(), NOW())`,
      [crypto.randomUUID(), courseId],
    );

    const enrollmentId = crypto.randomUUID();
    await client.query(
      `INSERT INTO enrollments (id, organization_user_id, course_id, facility_id, status, progress, started_at)
       VALUES ($1, $2, $3, $4, 'in_progress'::"EnrollmentStatus", 0, NOW())`,
      [enrollmentId, worker.orgUserId, courseId, facilityId],
    );

    return {
      orgId,
      facilityId,
      userIds: [owner.userId, worker.userId],
      orgUserIds: [owner.orgUserId, worker.orgUserId],
      workerEmail,
      courseId,
      enrollmentId,
    };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM certificates WHERE enrollment_id = $1`, [seeded.enrollmentId]);
    await client.query(`DELETE FROM enrollments WHERE course_id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM lessons WHERE course_id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM courses WHERE id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM notifications WHERE organization_user_id = ANY($1)`, [
      seeded.orgUserIds,
    ]);
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [seeded.orgUserIds],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [seeded.orgUserIds]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [seeded.userIds]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

async function loginAsWorker(page: Page, email: string): Promise<void> {
  // Random per-login IP so runs don't share the credential rate-limit bucket.
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', WORKER_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/worker**', { timeout: 45000 });
}

async function readEnrollment(enrollmentId: string) {
  const client = await db();
  try {
    const { rows } = await client.query(
      `SELECT status, progress, attested_at, completed_at, attestation_signature
         FROM enrollments WHERE id = $1`,
      [enrollmentId],
    );
    return rows[0] as {
      status: string;
      progress: number;
      attested_at: Date | null;
      completed_at: Date | null;
      attestation_signature: string | null;
    };
  } finally {
    await client.end();
  }
}

test.describe('No-quiz course completes through attestation (BUG-28)', () => {
  test('a learner finishes the lessons, attests, and the attestation cannot be re-stamped', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const minioReachable = await isMinioReachable();
    const seeded = await seedFixture();

    try {
      await loginAsWorker(page, seeded.workerEmail);
      await page.goto(`/learn/${seeded.courseId}`);
      await page.waitForLoadState('networkidle');

      // No quiz anywhere, so no quiz entry point — the course ends in the
      // attestation instead.
      await expect(page.getByRole('button', { name: 'Proceed to Quiz' })).toHaveCount(0);
      const attest = page.getByRole('button', { name: 'Complete Course & Attest' });
      await expect(attest).toBeEnabled({ timeout: 15000 });
      await attest.click();

      const dialog = page.getByRole('dialog', {
        name: 'Training Attestation of Understanding and Compliance',
      });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Name').fill(SIGNATURE);
      await dialog.getByRole('checkbox').nth(0).click();
      await dialog.getByRole('checkbox').nth(1).click();
      await dialog.getByRole('button', { name: 'Confirm' }).click();

      // The compliance record is written before certificate issuance, so it is
      // provable here whether or not object storage is available.
      await expect
        .poll(async () => (await readEnrollment(seeded.enrollmentId)).status, { timeout: 20000 })
        .toBe('attested');
      const attested = await readEnrollment(seeded.enrollmentId);
      expect(attested.progress).toBe(100);
      expect(attested.attestation_signature).toBe(SIGNATURE);
      expect(attested.attested_at).not.toBeNull();
      expect(attested.completed_at?.getTime()).toBe(attested.attested_at?.getTime());

      if (minioReachable) {
        await expect(page.getByRole('dialog', { name: 'Certificate earned' })).toBeVisible({
          timeout: 20000,
        });
      }

      // Once attested there is nothing further to sign, and revisiting the
      // course leaves the compliance date where it was (RISK-10; the replay
      // refusal itself is pinned by course.attest.test.ts).
      await page.goto(`/learn/${seeded.courseId}`);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('button', { name: 'Complete Course & Attest' })).toHaveCount(0);
      const afterReload = await readEnrollment(seeded.enrollmentId);
      expect(afterReload.attested_at?.getTime()).toBe(attested.attested_at?.getTime());
    } finally {
      await cleanup(seeded);
    }
  });
});
