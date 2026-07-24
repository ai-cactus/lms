/**
 * E2E spec: assign a course to a brand-new email → pending invite → accept →
 * course appears in the worker's trainings (fix/worker-invite).
 *
 * Root-cause bug: assigning a course to an unknown email used to silently
 * create a full org-linked user account with a temp password and email a
 * bare `/login` link (which could point at the wrong domain if APP_URL was
 * unset). This unifies course assignment with the staff-invite flow: an
 * unknown email is sent a `/join/{token}` invite with the course parked on
 * it (InviteCourseAssignment), materialised into a real enrollment only when
 * the invite is accepted.
 *
 * This spec drives the real Assign page (AssignPublishClient, reached via
 * /dashboard/training/courses/[id]/assign — NOT the currently-unused
 * ShareCourseModal component) end to end:
 *   1. Owner assigns a seeded course to a brand-new email.
 *   2. The "Pending invites for this course" section on the assign page shows
 *      the email, and the DB has a pending Invite + InviteCourseAssignment row.
 *   3. The invite token is fetched directly from the DB (see the email-fetch
 *      gap note in staff-re-invite-lifecycle.spec.ts) and used to drive the
 *      real /join/[token] page.
 *   4. The new worker logs in and the course appears in /worker/trainings —
 *      proving enrollInviteCourses materialised the parked course on accept.
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
  courseId: string;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@assign-invite-e2e.invalid`;
}

/** Seed an org (with active billing) + owner + a published course they own. */
async function seedOrgWithOwnerAndCourse(): Promise<Seeded> {
  const client = await db();
  try {
    const ownerEmail = uid('owner');
    const ownerPassword = 'AssignInv!Owner9';
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const slug = `assign-invite-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const courseId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Assign Invite E2E ${slug}`, slug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Assign Invite E2E Facility ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, $4, $5, NOW(), NOW())`,
      [ownerId, ownerEmail, ownerHashed, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, 'Assign', 'Owner', 'Assign Owner', NOW(), NOW())`,
      [ownerId, ownerEmail],
    );

    // Active subscription: enrollUsers' billing gate requires it, and the
    // worker portal later gates on it too (see worker-billing-gate.spec.ts).
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
      [courseId, `Assign Invite E2E Course ${slug}`, ownerId],
    );

    return { orgId, facilityId, ownerId, ownerEmail, ownerPassword, courseId };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded, inviteeEmail: string): Promise<void> {
  const client = await db();
  try {
    await client.query(
      `DELETE FROM invite_course_assignments WHERE course_id = $1`,
      [seeded.courseId],
    );
    await client.query(`DELETE FROM invites WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM enrollments WHERE course_id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM course_assignments WHERE course_id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM profiles WHERE email IN ($1, $2)`, [
      seeded.ownerEmail,
      inviteeEmail,
    ]);
    await client.query(`DELETE FROM users WHERE email = $1`, [inviteeEmail]);
    await client.query(`DELETE FROM courses WHERE id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.ownerId]);
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

test.describe('Assign course to a brand-new email — unified invite flow', () => {
  test('admin assigns a course to a new email, the invite is visible, and the course is enrolled on accept', async ({
    page,
  }) => {
    // Generous timeout: this journey chains an admin login, the Assign page's
    // first (dev-server, on-demand-compiled) render, a course-assignment
    // submit, a second browser context for the /join accept, and a worker
    // login — see staff-invite-flow.spec.ts's note on first-hit compile cost.
    test.setTimeout(180_000);
    const seeded = await seedOrgWithOwnerAndCourse();
    const inviteeEmail = uid('new-hire');
    const workerPassword = 'BrandNewWorker!9';

    try {
      // ── Step 1: owner assigns the course to the brand-new email ────────────
      await login(page, seeded.ownerEmail, seeded.ownerPassword);
      await page.waitForURL('**/dashboard**', { timeout: 45000 });

      await page.goto(`/dashboard/training/courses/${seeded.courseId}/assign`);
      await page.waitForLoadState('networkidle');

      await page.locator('#assign-input').fill(inviteeEmail);
      await page.getByRole('button', { name: 'Invite' }).click();
      await expect(page.getByText(inviteeEmail).first()).toBeVisible();

      await page.getByRole('button', { name: /assign course/i }).click();
      await expect(page.getByText('Course Assigned Successfully')).toBeVisible({
        timeout: 20000,
      });

      // ── Step 2: DB confirms a pending invite + parked course, no account ───
      const dbAfterAssign = await db();
      let token: string;
      try {
        const inviteRes = await dbAfterAssign.query(
          `SELECT id, token, status, role FROM invites WHERE email = $1 AND organization_id = $2`,
          [inviteeEmail, seeded.orgId],
        );
        expect(inviteRes.rows).toHaveLength(1);
        expect(inviteRes.rows[0].status).toBe('pending');
        token = inviteRes.rows[0].token;
        const inviteId = inviteRes.rows[0].id;

        const parkedRes = await dbAfterAssign.query(
          `SELECT course_id FROM invite_course_assignments WHERE invite_id = $1`,
          [inviteId],
        );
        expect(parkedRes.rows).toHaveLength(1);
        expect(parkedRes.rows[0].course_id).toBe(seeded.courseId);

        // No premature account — the root-cause bug this fix removes.
        const userRes = await dbAfterAssign.query(`SELECT id FROM users WHERE email = $1`, [
          inviteeEmail,
        ]);
        expect(userRes.rows).toHaveLength(0);
      } finally {
        await dbAfterAssign.end();
      }

      // ── Step 2b: the assign page surfaces the pending invitee ──────────────
      await page.goto(`/dashboard/training/courses/${seeded.courseId}/assign`);
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Pending invites for this course')).toBeVisible();
      await expect(page.getByText(inviteeEmail)).toBeVisible();

      // ── Step 3: accept the invite via the real /join/[token] page ──────────
      const joinContext = await page.context().browser()!.newContext();
      const joinPage = await joinContext.newPage();
      try {
        await joinPage.goto(`/join/${token}`);
        await expect(joinPage.getByText(/you've been invited to join/i)).toBeVisible({
          timeout: 15000,
        });

        await joinPage.getByPlaceholder('Enter your first name').fill('Brand');
        await joinPage.getByPlaceholder('Enter your last name').fill('New');
        await joinPage.getByPlaceholder(/^password \(at least/i).first().fill(workerPassword);
        await joinPage
          .getByPlaceholder(/^password \(at least/i)
          .nth(1)
          .fill(workerPassword);
        await joinPage.getByRole('checkbox').check();
        await joinPage.getByRole('button', { name: /create account|join|sign up/i }).click();

        await joinPage.waitForURL('**/login**', { timeout: 20000 });
      } finally {
        await joinContext.close();
      }

      // ── Step 4: the new worker logs in and sees the course in Trainings ────
      const workerContext = await page.context().browser()!.newContext();
      const workerPage = await workerContext.newPage();
      try {
        await login(workerPage, inviteeEmail, workerPassword);
        await workerPage.waitForURL('**/worker**', { timeout: 45000 });

        await workerPage.goto('/worker/trainings');
        await workerPage.waitForLoadState('networkidle');
        await expect(
          workerPage.getByText(`Assign Invite E2E Course`, { exact: false }).first(),
        ).toBeVisible({ timeout: 15000 });
      } finally {
        await workerContext.close();
      }

      // ── DB-level confirmation: a real enrollment now exists ────────────────
      const dbAfterAccept = await db();
      try {
        const enrollmentRes = await dbAfterAccept.query(
          `SELECT e.status FROM enrollments e
           JOIN users u ON u.id = e.user_id
           WHERE u.email = $1 AND e.course_id = $2`,
          [inviteeEmail, seeded.courseId],
        );
        expect(enrollmentRes.rows).toHaveLength(1);
        expect(['enrolled', 'assigned', 'in_progress']).toContain(enrollmentRes.rows[0].status);

        const inviteRes = await dbAfterAccept.query(
          `SELECT status FROM invites WHERE email = $1 AND organization_id = $2`,
          [inviteeEmail, seeded.orgId],
        );
        expect(inviteRes.rows[0].status).toBe('accepted');
      } finally {
        await dbAfterAccept.end();
      }
    } finally {
      await cleanup(seeded, inviteeEmail);
    }
  });
});
