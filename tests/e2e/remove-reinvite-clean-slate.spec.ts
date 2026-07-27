/**
 * E2E spec: removing a staffer with in-flight training, then re-inviting the
 * same email, yields a clean slate for in-flight work while completed
 * training history survives (fix/worker-invite, Phase 3 of the plan).
 *
 * Root-cause bug this guards: removeStaff() previously only nulled
 * organizationId — the User row and ALL enrollments (including in-flight
 * ones) survived, so a re-invite/relink resurrected stale in-flight course
 * assignments the client did not expect. The fix deletes the removed user's
 * ACTIVE-status enrollments (enrolled | assigned | in_progress |
 * lessons_complete) inside the same transaction as the org-unlink, while
 * terminal statuses (completed, attested, ...) and their certificates are
 * retained for compliance — and expires any pending invite for that email so
 * a live `/join` token can't immediately re-add the person.
 *
 * This spec seeds a worker with ONE in-flight enrollment and ONE completed
 * enrollment (different courses), removes them via the real Staff page UI,
 * confirms the DB-level split, re-invites the same email, accepts via
 * /join/[token], and confirms the worker's Trainings list post-accept: the
 * in-flight course is gone, the completed one remains.
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

interface Seeded {
  orgId: string;
  facilityId: string;
  ownerId: string;
  ownerEmail: string;
  ownerPassword: string;
  workerId: string;
  workerEmail: string;
  inFlightCourseId: string;
  inFlightCourseTitle: string;
  completedCourseId: string;
  completedCourseTitle: string;
  inFlightEnrollmentId: string;
  completedEnrollmentId: string;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@remove-reinvite-e2e.invalid`;
}

async function seedOrgOwnerWorkerAndEnrollments(): Promise<Seeded> {
  const client = await db();
  try {
    const slug = `remove-reinvite-${crypto.randomBytes(4).toString('hex')}`;
    const ownerEmail = uid('owner');
    const ownerPassword = 'RemoveReinv!Owner9';
    const workerEmail = uid('worker');
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const workerId = crypto.randomUUID();
    const inFlightCourseId = crypto.randomUUID();
    const completedCourseId = crypto.randomUUID();
    const inFlightEnrollmentId = crypto.randomUUID();
    const completedEnrollmentId = crypto.randomUUID();
    const inFlightCourseTitle = `Remove-Reinvite In-Flight ${slug}`;
    const completedCourseTitle = `Remove-Reinvite Completed ${slug}`;

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Remove Reinvite E2E ${slug}`, slug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Remove Reinvite E2E Facility ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, $4, $5, NOW(), NOW())`,
      [ownerId, ownerEmail, await bcrypt.hash(ownerPassword, 10), orgId, facilityId],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", true, $4, $5, NOW(), NOW())`,
      [workerId, workerEmail, await bcrypt.hash('OriginalWorkerPass!9', 10), orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, 'Remove', 'Owner', 'Remove Owner', NOW(), NOW())`,
      [ownerId, ownerEmail],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, 'Original', 'Worker', 'Original Worker', NOW(), NOW())`,
      [workerId, workerEmail],
    );

    const subNow = new Date();
    const subPeriodEnd = new Date(subNow);
    subPeriodEnd.setFullYear(subPeriodEnd.getFullYear() + 1);
    await client.query(
      `INSERT INTO subscriptions (
         id, organization_id, stripe_subscription_id, stripe_price_id, plan,
         billing_cycle, status, current_period_start, current_period_end,
         cancel_at_period_end, paused_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'professional'::"SubscriptionPlan", 'yearly'::"SubscriptionBillingCycle",
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
      `INSERT INTO courses (id, title, status, created_by, type, is_global, created_at, updated_at)
       VALUES ($1, $2, 'published'::"CourseStatus", $3, 'text'::"CourseType", false, NOW(), NOW())`,
      [inFlightCourseId, inFlightCourseTitle, ownerId],
    );
    await client.query(
      `INSERT INTO courses (id, title, status, created_by, type, is_global, created_at, updated_at)
       VALUES ($1, $2, 'published'::"CourseStatus", $3, 'text'::"CourseType", false, NOW(), NOW())`,
      [completedCourseId, completedCourseTitle, ownerId],
    );

    // In-flight enrollment: the "active" status set removeStaff() must drop.
    await client.query(
      `INSERT INTO enrollments (id, user_id, course_id, status, progress, started_at)
       VALUES ($1, $2, $3, 'in_progress'::"EnrollmentStatus", 40, NOW())`,
      [inFlightEnrollmentId, workerId, inFlightCourseId],
    );
    // Completed enrollment: a terminal status removeStaff() must retain.
    await client.query(
      `INSERT INTO enrollments (id, user_id, course_id, status, progress, score, started_at, completed_at)
       VALUES ($1, $2, $3, 'completed'::"EnrollmentStatus", 100, 95, NOW() - interval '10 days', NOW())`,
      [completedEnrollmentId, workerId, completedCourseId],
    );

    return {
      orgId,
      facilityId,
      ownerId,
      ownerEmail,
      ownerPassword,
      workerId,
      workerEmail,
      inFlightCourseId,
      inFlightCourseTitle,
      completedCourseId,
      completedCourseTitle,
      inFlightEnrollmentId,
      completedEnrollmentId,
    };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM invites WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM enrollments WHERE course_id IN ($1, $2)`, [
      seeded.inFlightCourseId,
      seeded.completedCourseId,
    ]);
    await client.query(`DELETE FROM courses WHERE id IN ($1, $2)`, [
      seeded.inFlightCourseId,
      seeded.completedCourseId,
    ]);
    await client.query(`DELETE FROM profiles WHERE id IN ($1, $2)`, [
      seeded.ownerId,
      seeded.workerId,
    ]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.ownerId]);
    await client.query(`DELETE FROM users WHERE email = $1`, [seeded.workerEmail]);
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

test.describe('Remove staffer with in-flight training, then re-invite — clean slate', () => {
  test('in-flight enrollment is dropped on removal and never resurrected; completed training is retained', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const seeded = await seedOrgOwnerWorkerAndEnrollments();
    const newPassword = 'ReinvitedWorker!99';

    try {
      // ── Step 1: owner removes the worker via the Staff page UI ─────────────
      await login(page, seeded.ownerEmail, seeded.ownerPassword);
      await page.waitForURL('**/dashboard**', { timeout: 45000 });

      await page.goto('/dashboard/staff');
      await page.waitForLoadState('networkidle');
      await page.getByPlaceholder('Search for staff...').fill(seeded.workerEmail);

      await page.getByRole('button', { name: 'Row actions' }).click();
      await page.getByRole('menuitem', { name: 'Remove Staff' }).click();
      const removeDialog = page.getByRole('dialog');
      await expect(removeDialog.getByText('Remove Staff Member')).toBeVisible();
      await removeDialog.getByRole('button', { name: 'Remove Staff' }).click();
      await expect(removeDialog).toBeHidden({ timeout: 10000 });

      // ── DB confirmation: in-flight enrollment gone, completed one retained ──
      const dbAfterRemoval = await db();
      try {
        const userRes = await dbAfterRemoval.query(
          `SELECT organization_id FROM users WHERE id = $1`,
          [seeded.workerId],
        );
        expect(userRes.rows[0].organization_id).toBeNull();

        const inFlightRes = await dbAfterRemoval.query(
          `SELECT id FROM enrollments WHERE id = $1`,
          [seeded.inFlightEnrollmentId],
        );
        expect(inFlightRes.rows).toHaveLength(0);

        const completedRes = await dbAfterRemoval.query(
          `SELECT id, status FROM enrollments WHERE id = $1`,
          [seeded.completedEnrollmentId],
        );
        expect(completedRes.rows).toHaveLength(1);
        expect(completedRes.rows[0].status).toBe('completed');
      } finally {
        await dbAfterRemoval.end();
      }

      // ── Step 2: owner re-invites the SAME email, same role ──────────────────
      await page.goto('/dashboard/staff');
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: /add workers?/i }).first().click();
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
      await expect(page.getByText('Invite New Staffs')).toBeVisible();
      await page.getByPlaceholder(/enter emails separated by/i).fill(seeded.workerEmail);
      await page.getByRole('button', { name: /^continue$/i }).click();

      await expect(page.getByText('Assign roles')).toBeVisible();
      await page.getByRole('combobox').nth(1).click();
      await page.getByRole('option', { name: /^nurse\b/i }).click();
      await page.getByRole('button', { name: /^continue$/i }).click();

      await expect(page.getByText('Invite sent')).toBeVisible({ timeout: 10000 });
      await page.getByRole('button', { name: /^done$/i }).click();

      const dbAfterReinvite = await db();
      let token: string;
      try {
        const res = await dbAfterReinvite.query(
          `SELECT token, role, status FROM invites WHERE email = $1 AND organization_id = $2 ORDER BY created_at DESC LIMIT 1`,
          [seeded.workerEmail, seeded.orgId],
        );
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0]).toMatchObject({ role: 'nurse', status: 'pending' });
        token = res.rows[0].token;
      } finally {
        await dbAfterReinvite.end();
      }

      // ── Step 3: accept via the real /join/[token] page ──────────────────────
      const joinContext = await page.context().browser()!.newContext();
      const joinPage = await joinContext.newPage();
      try {
        await joinPage.goto(`/join/${token}`);
        await expect(joinPage.getByText(/you've been invited to join/i)).toBeVisible({
          timeout: 15000,
        });
        await joinPage.getByPlaceholder('Enter your first name').fill('Rejoined');
        await joinPage.getByPlaceholder('Enter your last name').fill('Worker');
        await joinPage.getByPlaceholder(/^password \(at least/i).first().fill(newPassword);
        await joinPage
          .getByPlaceholder(/^password \(at least/i)
          .nth(1)
          .fill(newPassword);
        await joinPage.getByRole('checkbox').check();
        await joinPage.getByRole('button', { name: /create account|join|sign up/i }).click();

        await joinPage.waitForURL('**/login**', { timeout: 20000 });
      } finally {
        await joinContext.close();
      }

      // ── Step 4: log back in and confirm Trainings shows a clean slate ───────
      const reloginContext = await page.context().browser()!.newContext();
      const reloginPage = await reloginContext.newPage();
      try {
        await login(reloginPage, seeded.workerEmail, newPassword);
        await reloginPage.waitForURL('**/worker**', { timeout: 45000 });

        await reloginPage.goto('/worker/trainings');
        await reloginPage.waitForLoadState('networkidle');

        // The re-invite (a plain staff invite, not a course invite) parks no
        // course — the in-flight course must NOT reappear on the Active tab.
        await expect(reloginPage.getByRole('button', { name: /^active/i })).toContainText('0');
        await expect(reloginPage.getByText(seeded.inFlightCourseTitle)).toHaveCount(0);
        // The completed course's history survives the removal — it lives under
        // the Completed tab (a plain button toggle), which must be selected
        // before asserting.
        await reloginPage.getByRole('button', { name: /^completed/i }).click();
        await expect(reloginPage.getByText(seeded.completedCourseTitle)).toBeVisible({
          timeout: 15000,
        });
      } finally {
        await reloginContext.close();
      }

      // ── Final DB confirmation: same user id, back in the same org ──────────
      const dbAfterAccept = await db();
      try {
        const res = await dbAfterAccept.query(
          `SELECT id, organization_id, role FROM users WHERE email = $1`,
          [seeded.workerEmail],
        );
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0].id).toBe(seeded.workerId);
        expect(res.rows[0].organization_id).toBe(seeded.orgId);

        const enrollmentsRes = await dbAfterAccept.query(
          `SELECT course_id, status FROM enrollments WHERE user_id = $1`,
          [seeded.workerId],
        );
        expect(enrollmentsRes.rows).toHaveLength(1);
        expect(enrollmentsRes.rows[0]).toMatchObject({
          course_id: seeded.completedCourseId,
          status: 'completed',
        });
      } finally {
        await dbAfterAccept.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });
});
