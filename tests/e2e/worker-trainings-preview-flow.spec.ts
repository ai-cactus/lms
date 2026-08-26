/**
 * E2E spec: Issue #2 — "Start Course" and "Continue" on `/worker/trainings`
 * used to jump straight into the player at `/learn/[id]`, skipping the course
 * preview entirely. `WorkerTrainingList.handleStartClick` now routes both
 * entry points through `/worker/courses/[id]` (CoursePreview in worker mode)
 * first; the preview's own Start/Continue button is what actually lands on
 * `/learn/[id]`.
 *
 * Unit coverage for the routing decision itself lives in
 * WorkerTrainingList.test.tsx (mocked router, every button/tab combination).
 * This spec proves the full chain through a real browser and a real DB-backed
 * enrollment: /worker/trainings -> /worker/courses/[id] -> /learn/[id].
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - DATABASE_URL reachable for direct DB seeding/mutation.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@worker-trainings-preview-e2e.invalid`;
}

interface Seeded {
  orgId: string;
  facilityId: string;
  workerId: string;
  workerOrgUserId: string;
  courseId: string;
  enrollmentId: string;
  email: string;
  password: string;
}

/** Fresh org + worker + a published, non-video course with ONE enrollment. */
async function seedWorkerWithEnrollment(status: 'assigned' | 'in_progress'): Promise<Seeded> {
  const client = await db();
  try {
    const email = uid('worker');
    const password = 'TrainingsPreview!9';
    const hashed = await bcrypt.hash(password, 10);
    const slug = `trainings-preview-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const workerId = crypto.randomUUID();
    const workerOrgUserId = crypto.randomUUID();
    const courseId = crypto.randomUUID();
    const enrollmentId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Worker Trainings Preview E2E ${slug}`, slug, email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Worker Trainings Preview Facility ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Preview', 'Worker', 'Preview Worker', NOW(), NOW())`,
      [workerId, email, hashed],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [workerOrgUserId, workerId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), workerOrgUserId, facilityId],
    );

    const subNow = new Date();
    const subPeriodEnd = new Date(subNow);
    subPeriodEnd.setFullYear(subPeriodEnd.getFullYear() + 1);
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
        subNow,
        subPeriodEnd,
      ],
    );

    await client.query(
      `INSERT INTO courses (id, title, description, status, created_by_org_user_id, type, is_global, created_at, updated_at)
       VALUES ($1, $2, $3, 'published'::"CourseStatus", $4, 'text'::"CourseType", false, NOW(), NOW())`,
      [
        courseId,
        `Trainings Preview E2E Course ${slug}`,
        'A short compliance course.',
        workerOrgUserId,
      ],
    );

    const progress = status === 'in_progress' ? 40 : 0;
    await client.query(
      `INSERT INTO enrollments (id, organization_user_id, course_id, facility_id, status, progress, started_at)
       VALUES ($1, $2, $3, $4, $5::"EnrollmentStatus", $6, NOW())`,
      [enrollmentId, workerOrgUserId, courseId, facilityId, status, progress],
    );

    return {
      orgId,
      facilityId,
      workerId,
      workerOrgUserId,
      courseId,
      enrollmentId,
      email,
      password,
    };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM enrollments WHERE id = $1`, [seeded.enrollmentId]);
    await client.query(`DELETE FROM courses WHERE id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM organization_user_facilities WHERE organization_user_id = $1`, [
      seeded.workerOrgUserId,
    ]);
    await client.query(`DELETE FROM organization_users WHERE id = $1`, [seeded.workerOrgUserId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.workerId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/worker**', { timeout: 45000 });
}

test.describe('Worker trainings list routes through the course preview (Issue #2)', () => {
  test('"Start Course" lands on /worker/courses/[id], and the preview\'s own Start button reaches /learn/[id]', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seeded = await seedWorkerWithEnrollment('assigned');

    try {
      await loginAs(page, seeded.email, seeded.password);
      await page.goto('/worker/trainings');

      await page.getByRole('button', { name: 'Start Course' }).click();

      // Never the old direct-to-player URL.
      await expect(page).toHaveURL(new RegExp(`/worker/courses/${seeded.courseId}$`), {
        timeout: 20000,
      });

      // The preview page's own button starts the enrollment and lands on /learn.
      await page.getByRole('button', { name: 'Start Course' }).click();
      await expect(page).toHaveURL(new RegExp(`/learn/${seeded.courseId}$`), { timeout: 20000 });
    } finally {
      await cleanup(seeded);
    }
  });

  test('"Continue" (an already-started enrollment) also lands on /worker/courses/[id], and "Continue Course" there reaches /learn/[id]', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seeded = await seedWorkerWithEnrollment('in_progress');

    try {
      await loginAs(page, seeded.email, seeded.password);
      await page.goto('/worker/trainings');

      await page.getByRole('button', { name: 'Continue' }).click();

      await expect(page).toHaveURL(new RegExp(`/worker/courses/${seeded.courseId}$`), {
        timeout: 20000,
      });

      await page.getByRole('button', { name: 'Continue Course' }).click();
      await expect(page).toHaveURL(new RegExp(`/learn/${seeded.courseId}$`), { timeout: 20000 });
    } finally {
      await cleanup(seeded);
    }
  });
});
