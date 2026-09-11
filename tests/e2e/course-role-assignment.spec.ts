/**
 * E2E spec: role-target course assignment (RoleTargetPicker / D5-D6, PR-2 of
 * the role-target-picker branch) — /dashboard/training/courses/[id]/assign.
 *
 * Deliberately does NOT touch the course-creation wizard: that flow is being
 * redesigned in PR-3, and its own e2e coverage belongs there.
 *
 * Acceptance criteria:
 *   - Targeting a role on the assign page enrolls its current holders
 *     (assignCourseToRoleTargets).
 *   - Reopening the assign page for an already role-targeted course loads the
 *     picker in `live` mode; unticking a role opens the D6 confirm naming the
 *     assignment's `enrolledCount`.
 *   - Confirming the removal narrows `targetRoles` but leaves existing
 *     enrollees' enrollment rows untouched (soft revoke — D6).
 *   - Once a role is no longer targeted, someone who newly gains that role
 *     (via the real staff-invite → /join/[token] accept flow) is NOT
 *     auto-enrolled (enrollUserForRoleTargets reads live `targetRoles`).
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005.
 *   - DATABASE_URL reachable for direct DB seeding + assertions.
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
  ownerOrgUserId: string;
  ownerEmail: string;
  ownerPassword: string;
  nurseUserId: string;
  nurseOrgUserId: string;
  courseId: string;
  courseTitle: string;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@role-assign-e2e.invalid`;
}

/** Owner (active billing) + one existing `nurse` holder + a published course the owner authored. */
async function seedFixture(): Promise<Seeded> {
  const client = await db();
  try {
    const ownerEmail = uid('owner');
    const ownerPassword = 'RoleAsn!Owner9';
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const nurseEmail = uid('nurse');
    const nurseHashed = await bcrypt.hash('RoleAsn!Nurse9', 10);
    const slug = `role-assign-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const ownerOrgUserId = crypto.randomUUID();
    const nurseUserId = crypto.randomUUID();
    const nurseOrgUserId = crypto.randomUUID();
    const courseId = crypto.randomUUID();
    const courseTitle = `Role Assign E2E Course ${slug}`;

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Role Assign E2E ${slug}`, slug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Role Assign E2E Facility ${slug}`],
    );

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Role', 'Owner', 'Role Owner', NOW(), NOW())`,
      [ownerId, ownerEmail, ownerHashed],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [ownerOrgUserId, ownerId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), ownerOrgUserId, facilityId],
    );

    // The current holder of the targeted role, seeded BEFORE the assignment
    // exists — its enrollment proves "targeting a role enrolls current holders".
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Nora', 'Nurse', 'Nora Nurse', NOW(), NOW())`,
      [nurseUserId, nurseEmail, nurseHashed],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [nurseOrgUserId, nurseUserId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), nurseOrgUserId, facilityId],
    );

    // Active subscription: assignCourseToRoleTargets' billing gate requires it.
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
      `INSERT INTO courses (id, title, status, created_by_org_user_id, type, is_global, created_at, updated_at)
       VALUES ($1, $2, 'published'::"CourseStatus", $3, 'text'::"CourseType", false, NOW(), NOW())`,
      [courseId, courseTitle, ownerOrgUserId],
    );

    return {
      orgId,
      facilityId,
      ownerId,
      ownerOrgUserId,
      ownerEmail,
      ownerPassword,
      nurseUserId,
      nurseOrgUserId,
      courseId,
      courseTitle,
    };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded, extraInviteeEmail?: string): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM enrollments WHERE course_id = $1`, [seeded.courseId]);
    await client.query(
      `DELETE FROM assignment_reminder_stages WHERE assignment_id IN
       (SELECT id FROM course_assignments WHERE course_id = $1)`,
      [seeded.courseId],
    );
    await client.query(`DELETE FROM course_assignments WHERE course_id = $1`, [seeded.courseId]);
    if (extraInviteeEmail) {
      await client.query(`DELETE FROM invites WHERE email = $1`, [extraInviteeEmail]);
      await client.query(
        `DELETE FROM organization_user_facilities WHERE organization_user_id IN
           (SELECT ou.id FROM organization_users ou JOIN users u ON u.id = ou.user_id WHERE u.email = $1)`,
        [extraInviteeEmail],
      );
      await client.query(
        `DELETE FROM organization_users WHERE id IN
           (SELECT ou.id FROM organization_users ou JOIN users u ON u.id = ou.user_id WHERE u.email = $1)`,
        [extraInviteeEmail],
      );
      await client.query(`DELETE FROM users WHERE email = $1`, [extraInviteeEmail]);
    }
    await client.query(`DELETE FROM courses WHERE id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [seeded.orgId]);
    const orgUserIds = [seeded.ownerOrgUserId, seeded.nurseOrgUserId];
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [orgUserIds],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [orgUserIds]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [
      [seeded.ownerId, seeded.nurseUserId],
    ]);
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
  await page.waitForURL('**/dashboard**', { timeout: 45000 });
}

test.describe('Assign page — role targeting, D6 soft revoke, and post-untarget auto-enroll', () => {
  test('targets a role, enrolls current holders, then untargeting confirms the enrolled count, keeps enrollees, and stops future auto-enroll', async ({
    page,
  }) => {
    // Chains an owner login, the Assign page's first (on-demand-compiled)
    // render, a role-target submit, a reload into `live` mode, a D6 confirm,
    // a second staff-invite journey, and a third browser context for the
    // /join accept — see assign-course-invite.spec.ts's note on this cost.
    test.setTimeout(180_000);

    const seeded = await seedFixture();
    const newNurseEmail = uid('new-nurse');
    const newNursePassword = 'BrandNewNurse!9';

    try {
      await login(page, seeded.ownerEmail, seeded.ownerPassword);

      // ── Step 1: target the "Nurse" role and enroll its current holder ──────
      await page.goto(`/dashboard/training/courses/${seeded.courseId}/assign`);
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: 'A whole role' }).click();
      await page.getByRole('button', { name: 'Choose roles' }).click();
      await page.getByRole('checkbox', { name: 'Nurse' }).click();
      await expect(page.getByText('Nurse', { exact: true }).first()).toBeVisible();

      // Close the roles dropdown (it overlays the rest of the form) before
      // clicking anything below it — a mousedown outside the picker's
      // container is what the component listens for to collapse it.
      await page.getByRole('heading', { name: 'Assign', exact: true, level: 1 }).click();
      await expect(page.getByRole('group', { name: 'Assignable roles' })).toBeHidden();

      await page.getByRole('button', { name: /assign course/i }).click();
      await expect(page.getByText('Course Assigned Successfully')).toBeVisible({
        timeout: 20000,
      });

      let nurseEnrollmentId: string;
      const dbAfterAssign = await db();
      try {
        const assignmentRes = await dbAfterAssign.query(
          `SELECT id, target_roles::text[] AS target_roles FROM course_assignments WHERE course_id = $1`,
          [seeded.courseId],
        );
        expect(assignmentRes.rows).toHaveLength(1);
        expect(assignmentRes.rows[0].target_roles).toEqual(['nurse']);
        const assignmentId = assignmentRes.rows[0].id;

        const enrollmentRes = await dbAfterAssign.query(
          `SELECT id, status FROM enrollments WHERE course_id = $1 AND organization_user_id = $2`,
          [seeded.courseId, seeded.nurseOrgUserId],
        );
        expect(enrollmentRes.rows).toHaveLength(1);
        expect(enrollmentRes.rows[0].status).not.toBe('failed');
        expect(assignmentId).toBeTruthy();
        nurseEnrollmentId = enrollmentRes.rows[0].id;
      } finally {
        await dbAfterAssign.end();
      }

      // ── Step 2: reopen the assign page — the picker now loads `live` ───────
      await page.goto(`/dashboard/training/courses/${seeded.courseId}/assign`);
      await page.waitForLoadState('networkidle');

      await expect(page.getByRole('button', { name: 'Remove Nurse' })).toBeVisible();
      await page.getByRole('button', { name: 'Remove Nurse' }).click();

      // ── Step 3: D6 confirm names the enrolled count before retracting ──────
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(/stop enrolling new staff\?/i)).toBeVisible();
      await expect(dialog.getByText(/1 already enrolled/i)).toBeVisible();

      await dialog.getByRole('button', { name: 'Remove' }).click();
      await expect(dialog).toBeHidden({ timeout: 15000 });

      // ── Step 4: the role is untargeted, but the existing enrollee is untouched ─
      const dbAfterRevoke = await db();
      try {
        const assignmentRes = await dbAfterRevoke.query(
          `SELECT target_roles::text[] AS target_roles FROM course_assignments WHERE course_id = $1`,
          [seeded.courseId],
        );
        expect(assignmentRes.rows[0].target_roles).toEqual([]);

        const enrollmentRes = await dbAfterRevoke.query(
          `SELECT id, status FROM enrollments WHERE course_id = $1 AND organization_user_id = $2`,
          [seeded.courseId, seeded.nurseOrgUserId],
        );
        expect(enrollmentRes.rows).toHaveLength(1);
        expect(enrollmentRes.rows[0].id).toBe(nurseEnrollmentId);
      } finally {
        await dbAfterRevoke.end();
      }

      // ── Step 5: invite + accept a BRAND NEW nurse via the real staff-invite
      //            flow — untargeted, so this must NOT auto-enroll them ──────
      await page.goto('/dashboard/staff');
      await page
        .getByRole('button', { name: /add staff/i })
        .first()
        .click();
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

      await page.getByRole('combobox', { name: 'Facility' }).click();
      await page.getByRole('option', { name: /^global/i }).click();
      await page.getByPlaceholder(/enter emails separated by/i).fill(newNurseEmail);
      await page.getByRole('button', { name: /^continue$/i }).click();

      await expect(page.getByRole('heading', { name: 'Assign roles', exact: true })).toBeVisible();
      await page.getByRole('combobox').nth(1).click();
      await page.getByRole('option', { name: /^nurse$/i }).click();
      await page.getByRole('button', { name: /^invite \d+ staffs?$/i }).click();
      await expect(page.getByRole('button', { name: /^okay$/i })).toBeVisible({ timeout: 15000 });
      await page.getByRole('button', { name: /^okay$/i }).click();

      const dbInvite = await db();
      let token: string;
      try {
        const inviteRes = await dbInvite.query(
          `SELECT token FROM invites WHERE email = $1 AND organization_id = $2 AND role = 'nurse'::"UserRole"`,
          [newNurseEmail, seeded.orgId],
        );
        expect(inviteRes.rows).toHaveLength(1);
        token = inviteRes.rows[0].token;
      } finally {
        await dbInvite.end();
      }

      const joinContext = await page.context().browser()!.newContext();
      const joinPage = await joinContext.newPage();
      try {
        await joinPage.goto(`/join/${token}`);
        await expect(joinPage.getByText(/you've been invited to join/i)).toBeVisible({
          timeout: 15000,
        });
        await joinPage.getByPlaceholder('Enter your first name').fill('Brandnew');
        await joinPage.getByPlaceholder('Enter your last name').fill('Nurse');
        await joinPage
          .getByPlaceholder(/^password \(at least/i)
          .first()
          .fill(newNursePassword);
        await joinPage
          .getByPlaceholder(/^password \(at least/i)
          .nth(1)
          .fill(newNursePassword);
        await joinPage.getByRole('checkbox').check();
        await joinPage.getByRole('button', { name: /create account|join|sign up/i }).click();
        await joinPage.waitForURL('**/login**', { timeout: 20000 });
      } finally {
        await joinContext.close();
      }

      // ── Step 6: the new nurse holds the role, but is NOT auto-enrolled ─────
      const dbFinal = await db();
      try {
        const newUserRes = await dbFinal.query(
          `SELECT ou.id AS org_user_id, ou.role FROM organization_users ou
           JOIN users u ON u.id = ou.user_id
           WHERE u.email = $1 AND ou.organization_id = $2`,
          [newNurseEmail, seeded.orgId],
        );
        expect(newUserRes.rows).toHaveLength(1);
        expect(newUserRes.rows[0].role).toBe('nurse');
        const newNurseOrgUserId = newUserRes.rows[0].org_user_id;

        const enrollmentRes = await dbFinal.query(
          `SELECT id FROM enrollments WHERE course_id = $1 AND organization_user_id = $2`,
          [seeded.courseId, newNurseOrgUserId],
        );
        expect(enrollmentRes.rows).toHaveLength(0);
      } finally {
        await dbFinal.end();
      }
    } finally {
      await cleanup(seeded, newNurseEmail);
    }
  });
});
