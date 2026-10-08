/**
 * E2E spec: a locked learner requests a retry, and an admin grants it (Q-35).
 *
 *  1. The learner — every quiz attempt used, so the enrolment is `locked` —
 *     selects "Request retry" on the course page. It turns into "Retry
 *     requested", and stays that way across a reload. The enrolment is still
 *     `locked` afterwards: a request never reopens the course itself (SEC-18).
 *  2. The admin opens the "Course Retry Requested" notice; its link lands on
 *     the learner's staff profile with the Assign Retake dialog already open,
 *     and the admin assigns the retake.
 *  3. The learner sees the retake in their course list.
 *
 * Two browser contexts, because one browser holds one session per portal.
 *
 * Self-provisioned: a throwaway organization, facility, subscription, owner,
 * learner, course and locked enrolment, all removed afterwards. The shared
 * seeded worker@test.com locked enrolment is NOT reused — course.spec.ts's
 * ENG-022 grants a retake on it, after which it can no longer be requested.
 *
 * The org's Training email switch is off by default, so this asserts the
 * in-app notice only.
 *
 * Pre-conditions:
 *   - App running on the Playwright webServer.
 *   - DATABASE_URL reachable for direct DB seeding.
 */

import { test, expect, type Browser, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

const PASSWORD = 'RetryRequest!9';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@retry-request-e2e.invalid`;
}

interface Seeded {
  orgId: string;
  facilityId: string;
  userIds: string[];
  orgUserIds: string[];
  ownerEmail: string;
  workerEmail: string;
  workerOrgUserId: string;
  courseId: string;
  courseTitle: string;
  enrollmentId: string;
}

async function seedFixture(): Promise<Seeded> {
  const client = await db();
  try {
    const slug = `retry-request-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Retry Request E2E ${slug}`, slug, uid('org')],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Retry Request Facility ${slug}`],
    );
    // A request is refused while billing is paused, and the worker portal turns
    // a learner away without an active subscription.
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

    const hashed = await bcrypt.hash(PASSWORD, 10);
    const seedMember = async (role: string, email: string, first: string, last: string) => {
      const userId = crypto.randomUUID();
      const orgUserId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
         VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
        [userId, email, hashed, first, last, `${first} ${last}`],
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

    const ownerEmail = uid('owner');
    const owner = await seedMember('owner', ownerEmail, 'Rhea', 'Owner');
    const workerEmail = uid('worker');
    const worker = await seedMember('nurse', workerEmail, 'Remy', 'Retry');

    const courseId = crypto.randomUUID();
    const courseTitle = `Retry Request Course ${slug}`;
    await client.query(
      `INSERT INTO courses (
         id, title, description, status, created_by_org_user_id, organization_id,
         type, is_global, review_required, created_at, updated_at
       ) VALUES ($1, $2, $3, 'published'::"CourseStatus", $4, $5, 'text'::"CourseType", false, false, NOW(), NOW())`,
      [courseId, courseTitle, 'A course the learner is locked out of.', owner.orgUserId, orgId],
    );
    await client.query(
      `INSERT INTO lessons (id, course_id, title, content, "order", media_status, created_at, updated_at)
       VALUES ($1, $2, 'Module 1', '<p>Course material.</p>', 0, 'ready'::"MediaStatus", NOW(), NOW())`,
      [crypto.randomUUID(), courseId],
    );

    // Every attempt used: `locked`, a failing score, no request yet.
    const enrollmentId = crypto.randomUUID();
    await client.query(
      `INSERT INTO enrollments (id, organization_user_id, course_id, facility_id, status, progress, score, started_at, locked_at)
       VALUES ($1, $2, $3, $4, 'locked'::"EnrollmentStatus", 100, 40, NOW(), NOW())`,
      [enrollmentId, worker.orgUserId, courseId, facilityId],
    );

    return {
      orgId,
      facilityId,
      userIds: [owner.userId, worker.userId],
      orgUserIds: [owner.orgUserId, worker.orgUserId],
      ownerEmail,
      workerEmail,
      workerOrgUserId: worker.orgUserId,
      courseId,
      courseTitle,
      enrollmentId,
    };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    const enrollmentsOfCourse = `SELECT id FROM enrollments WHERE course_id = $1`;
    await client.query(
      `DELETE FROM reminder_logs WHERE enrollment_id IN (${enrollmentsOfCourse})`,
      [seeded.courseId],
    );
    await client.query(
      `DELETE FROM reminder_nudges WHERE enrollment_id IN (${enrollmentsOfCourse})`,
      [seeded.courseId],
    );
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

async function readEnrollment(enrollmentId: string) {
  const client = await db();
  try {
    const { rows } = await client.query(
      `SELECT status, score, retry_requested_at FROM enrollments WHERE id = $1`,
      [enrollmentId],
    );
    return rows[0] as { status: string; score: number | null; retry_requested_at: Date | null };
  } finally {
    await client.end();
  }
}

async function countRetakes(enrollmentId: string): Promise<number> {
  const client = await db();
  try {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM enrollments WHERE retake_of = $1`,
      [enrollmentId],
    );
    return rows[0].n as number;
  } finally {
    await client.end();
  }
}

async function signIn(browser: Browser, email: string, landing: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Random per-login IP so runs don't share the credential rate-limit bucket.
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(landing, { timeout: 45000 });
  return page;
}

test.describe('Locked learner requests a retry (Q-35)', () => {
  test('the learner requests a retry, the admin follows the notice and grants it, and the learner sees the retake', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const seeded = await seedFixture();

    try {
      // ── 1. Learner requests a retry ────────────────────────────────────────
      const learner = await signIn(browser, seeded.workerEmail, '**/worker**');
      await learner.goto(`/worker/courses/${seeded.courseId}`);

      // A locked learner is offered the request, never a Start Course the
      // server would refuse.
      await expect(learner.getByRole('button', { name: 'Start Course' })).toHaveCount(0);
      await learner.getByRole('button', { name: 'Request retry' }).click();
      await expect(learner.getByText('Retry requested')).toBeVisible();

      await learner.reload();
      await expect(learner.getByText('Retry requested')).toBeVisible();
      await expect(learner.getByRole('button', { name: 'Request retry' })).toHaveCount(0);

      // The course list says the same thing in its status column.
      await learner.goto('/worker/trainings');
      await expect(learner.getByText('Retry requested')).toBeVisible();

      const afterRequest = await readEnrollment(seeded.enrollmentId);
      expect(afterRequest.retry_requested_at).not.toBeNull();
      // SEC-18: the request records itself and nothing else.
      expect(afterRequest.status).toBe('locked');
      expect(afterRequest.score).toBe(40);

      // ── 2. Admin follows the notice and grants the retake ──────────────────
      const admin = await signIn(browser, seeded.ownerEmail, '**/dashboard**');
      await admin.goto('/dashboard/notifications');
      await admin.getByText('Course Retry Requested').first().click();
      await admin.waitForURL(
        `**/dashboard/staff/${seeded.workerOrgUserId}?retake=${seeded.enrollmentId}`,
      );

      const dialog = admin.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Assign Retake' })).toBeVisible();
      await expect(dialog).toContainText(seeded.courseTitle);
      await dialog.getByRole('button', { name: 'Assign Retake' }).click();
      await expect(dialog).toBeHidden();
      await expect(admin.getByText('Retake assigned')).toBeVisible();
      expect(await countRetakes(seeded.enrollmentId)).toBe(1);

      // ── 3. Learner sees the retake ─────────────────────────────────────────
      await learner.goto('/worker/trainings');
      await expect(learner.getByText('Retake required')).toBeVisible();
      await expect(learner.getByRole('button', { name: 'Retake' })).toBeVisible();

      await learner.context().close();
      await admin.context().close();
    } finally {
      await cleanup(seeded);
    }
  });
});
