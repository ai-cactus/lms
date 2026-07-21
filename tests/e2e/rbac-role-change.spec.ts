/**
 * E2E spec: in-place staff role change (RBAC matrix realignment, Change 2).
 *
 * Background: `EditStaffModal` now renders an editable, grouped role picker
 * for an Owner/Supervisor re-roling a reachable target (`roleFieldEditable`
 * in EditStaffModal.tsx), or a read-only role field with a caption
 * otherwise. `updateStaffDetails` (src/app/actions/staff.ts) runs the pure
 * `canChangeRole` guard (src/lib/rbac/role-utils.ts) on any role-changing
 * submit; a successful change bumps `sessionVersion` in the SAME write
 * (killing the target's live sessions via the existing F-059 kill-switch)
 * and records a `staff.role.change` audit entry. No cascading writes:
 * `managerId`, enrollments and certificates are untouched by design.
 *
 * Scenarios:
 *   - Owner changes an HR staffer to Nurse: target's live admin session dies
 *     on next navigation; target's re-login lands on /worker (routing is
 *     always driven by the current DB role, per authenticate() in
 *     src/app/actions/auth.ts); the target's enrollment + certificate are
 *     still present (history preserved, no cascading writes).
 *   - Owner promotes a worker to an admin-tier role: target's next login
 *     lands on /dashboard.
 *   - HR opens Edit Profile on a staff member and sees a READ-ONLY role
 *     field (HR may edit staff but not re-role them).
 *   - Supervisor cannot select Owner in the role picker (the option is
 *     absent — `groupRolesForSelect` never includes it). Direct
 *     server-action denial for supervisor→owner is unit-tested in
 *     src/lib/rbac/role-utils.test.ts (`role_not_grantable`) and
 *     src/app/actions/staff.test.ts; not re-verified here.
 *   - Self role change is blocked: an Owner viewing their own profile sees
 *     the role field as read-only with a "cannot change your own role"
 *     caption.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - DATABASE_URL reachable for direct DB seeding.
 */

import { test, expect, type Page, type Browser } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

// ── DB helpers ────────────────────────────────────────────────────────────────

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

type SeedRole =
  | 'owner'
  | 'supervisor'
  | 'hr'
  | 'clinical_director'
  | 'finance'
  | 'nurse'
  | 'front_desk_admin';

interface SeededOrg {
  actorId: string;
  targetId: string;
  orgId: string;
  facilityId: string;
}

interface SeededOrgWithHistory extends SeededOrg {
  courseId: string;
  courseTitle: string;
  enrollmentId: string;
}

async function insertUser(
  client: Client,
  opts: { id: string; email: string; hashed: string; role: SeedRole; orgId: string; facilityId: string; firstName: string; lastName: string },
): Promise<void> {
  await client.query(
    `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4::"UserRole", true, $5, $6, NOW(), NOW())`,
    [opts.id, opts.email, opts.hashed, opts.role, opts.orgId, opts.facilityId],
  );
  await client.query(
    `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    [opts.id, opts.email, opts.firstName, opts.lastName, `${opts.firstName} ${opts.lastName}`],
  );
}

/** Seed an org with an actor (the role-changer) and a target staff member. */
async function seedActorAndTarget(
  actorRole: SeedRole,
  actorEmail: string,
  actorPassword: string,
  targetRole: SeedRole,
  targetEmail: string,
  targetPassword: string,
): Promise<SeededOrg> {
  const client = await db();
  try {
    const actorHashed = await bcrypt.hash(actorPassword, 10);
    const targetHashed = await bcrypt.hash(targetPassword, 10);
    const slug = `role-chg-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const targetId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Role Change Test ${slug}`, slug, actorEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Role Change Test ${slug}`],
    );
    await insertUser(client, {
      id: actorId,
      email: actorEmail,
      hashed: actorHashed,
      role: actorRole,
      orgId,
      facilityId,
      firstName: 'Actor',
      lastName: 'Test',
    });
    await insertUser(client, {
      id: targetId,
      email: targetEmail,
      hashed: targetHashed,
      role: targetRole,
      orgId,
      facilityId,
      firstName: 'Target',
      lastName: 'Staffer',
    });
    // An active subscription is required so the target's worker-portal login
    // (several scenarios re-login as the target after the role change) isn't
    // blocked by the worker billing gate (TC-041-B) — a missing subscription
    // row is treated as inactive billing, which is unrelated to what this
    // spec actually tests.
    const subNow = new Date();
    const subPeriodEnd = new Date(subNow);
    subPeriodEnd.setFullYear(subPeriodEnd.getFullYear() + 1);
    await client.query(
      `INSERT INTO subscriptions (
         id, organization_id, stripe_subscription_id, stripe_price_id, plan,
         billing_cycle, status, current_period_start, current_period_end,
         cancel_at_period_end, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'professional'::"SubscriptionPlan", 'yearly'::"SubscriptionBillingCycle",
         'active'::"SubscriptionStatus", $5, $6, false, NOW(), NOW())`,
      [
        crypto.randomUUID(),
        orgId,
        `sub_e2e_${crypto.randomBytes(6).toString('hex')}`,
        `price_e2e_${crypto.randomBytes(6).toString('hex')}`,
        subNow,
        subPeriodEnd,
      ],
    );

    return { actorId, targetId, orgId, facilityId };
  } finally {
    await client.end();
  }
}

/**
 * Same as {@link seedActorAndTarget} but also gives the target one completed
 * enrollment + issued certificate — used by the "history preserved" scenario.
 */
async function seedActorAndTargetWithHistory(
  actorRole: SeedRole,
  actorEmail: string,
  actorPassword: string,
  targetRole: SeedRole,
  targetEmail: string,
  targetPassword: string,
): Promise<SeededOrgWithHistory> {
  const seeded = await seedActorAndTarget(
    actorRole,
    actorEmail,
    actorPassword,
    targetRole,
    targetEmail,
    targetPassword,
  );
  const client = await db();
  try {
    const courseId = crypto.randomUUID();
    const enrollmentId = crypto.randomUUID();
    const certificateId = crypto.randomUUID();
    const courseTitle = `Role-Change History Course ${crypto.randomBytes(3).toString('hex')}`;

    await client.query(
      `INSERT INTO courses (id, title, status, type, created_by, created_at, updated_at)
       VALUES ($1, $2, 'published'::"CourseStatus", 'text'::"CourseType", $3, NOW(), NOW())`,
      [courseId, courseTitle, seeded.actorId],
    );
    await client.query(
      `INSERT INTO enrollments (id, user_id, course_id, status, progress, score, started_at, completed_at)
       VALUES ($1, $2, $3, 'completed'::"EnrollmentStatus", 100, 95, NOW(), NOW())`,
      [enrollmentId, seeded.targetId, courseId],
    );
    await client.query(
      `INSERT INTO certificates (id, enrollment_id, user_id, course_id, issued_at, score)
       VALUES ($1, $2, $3, $4, NOW(), 95)`,
      [certificateId, enrollmentId, seeded.targetId, courseId],
    );

    return { ...seeded, courseId, courseTitle, enrollmentId };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: SeededOrg): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM certificates WHERE user_id = ANY($1)`, [
      [seeded.actorId, seeded.targetId],
    ]);
    await client.query(`DELETE FROM enrollments WHERE user_id = ANY($1)`, [
      [seeded.actorId, seeded.targetId],
    ]);
    await client.query(`DELETE FROM courses WHERE created_by = $1`, [seeded.actorId]);
    await client.query(`DELETE FROM profiles WHERE id = ANY($1)`, [
      [seeded.actorId, seeded.targetId],
    ]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [
      [seeded.actorId, seeded.targetId],
    ]);
    await client.query(`DELETE FROM facilities WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@role-change-e2e.invalid`;
}

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

async function openEditStaffModal(page: Page, targetId: string) {
  await page.goto(`/dashboard/staff/${targetId}`);
  await page.getByRole('button', { name: 'Edit Profile' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('In-place staff role change', () => {
  test('owner changes an HR staffer to Nurse: live session dies, re-login lands on /worker, history preserved', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    test.setTimeout(120_000);
    const ownerEmail = uid('owner');
    const ownerPassword = 'RoleChgOwner!9';
    const targetEmail = uid('target-hr');
    const targetPassword = 'RoleChgTarget!9';

    const seeded = await seedActorAndTargetWithHistory(
      'owner',
      ownerEmail,
      ownerPassword,
      'hr',
      targetEmail,
      targetPassword,
    );

    try {
      // Target logs in FIRST and stays live in their own browser context.
      const targetContext = await browser.newContext();
      const targetPage = await targetContext.newPage();
      await loginAs(targetPage, targetEmail, targetPassword);
      await targetPage.waitForURL('**/dashboard', { timeout: 45000 });

      // Owner changes the target's role via Edit Profile.
      const ownerContext = await browser.newContext();
      const ownerPage = await ownerContext.newPage();
      try {
        await loginAs(ownerPage, ownerEmail, ownerPassword);
        await ownerPage.waitForURL('**/dashboard', { timeout: 45000 });

        const dialog = await openEditStaffModal(ownerPage, seeded.targetId);
        await dialog.getByRole('combobox').click();
        await ownerPage.getByRole('option', { name: /^nurse$/i }).click();
        await expect(
          dialog.getByText(/changing this person.s role will sign them out/i),
        ).toBeVisible();
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        // The success message is only shown for ~1s before the modal
        // auto-closes (EditStaffModal.tsx) — asserting on that transient text
        // is racy under dev-server compile latency. Wait directly for the
        // modal to close, which only happens on the successful path.
        await expect(dialog).toBeHidden({ timeout: 15000 });
      } finally {
        await ownerContext.close();
      }

      // The target's LIVE admin session is now killed (sessionVersion bump) —
      // the next navigation must redirect to /login.
      await targetPage.goto('/dashboard');
      await targetPage.waitForURL('**/login**', { timeout: 15000 });
      await targetContext.close();

      // Re-login: routing is driven by the CURRENT DB role (now nurse) — lands
      // on /worker even though the target originally logged in as HR.
      const reloginContext = await browser.newContext();
      const reloginPage = await reloginContext.newPage();
      try {
        await loginAs(reloginPage, targetEmail, targetPassword);
        await reloginPage.waitForURL(/\/(worker|onboarding-worker)/, { timeout: 20000 });
        // First client-side landing on /worker can visibly "stick" without the
        // redirect firing — force a hard nav (see agent memory: e2e gotchas).
        await reloginPage.goto('/worker');

        // History preserved: no cascading writes touched the enrollment/certificate.
        await reloginPage.goto('/worker/certificates');
        await expect(reloginPage.getByText(seeded.courseTitle)).toBeVisible({ timeout: 15000 });
      } finally {
        await reloginContext.close();
      }
    } finally {
      await cleanup(seeded);
    }
  });

  test('owner promotes a worker to an admin-tier role: next login lands on /dashboard', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ownerEmail = uid('owner');
    const ownerPassword = 'RoleChgOwner!9';
    const targetEmail = uid('target-worker');
    const targetPassword = 'RoleChgTarget!9';

    const seeded = await seedActorAndTarget(
      'owner',
      ownerEmail,
      ownerPassword,
      'front_desk_admin',
      targetEmail,
      targetPassword,
    );

    try {
      await loginAs(page, ownerEmail, ownerPassword);
      await page.waitForURL('**/dashboard', { timeout: 45000 });

      const dialog = await openEditStaffModal(page, seeded.targetId);
      await dialog.getByRole('combobox').click();
      await page.getByRole('option', { name: /^hr$/i }).click();
      await dialog.getByRole('button', { name: 'Save Changes' }).click();
      // See the note in the previous test — assert the modal closes rather
      // than the transient (~1s) success message, which is racy under
      // dev-server compile latency.
      await expect(dialog).toBeHidden({ timeout: 15000 });

      // Fresh login (no prior live session to kill) — role is now admin-tier.
      await loginAs(page, targetEmail, targetPassword);
      await page.waitForURL('**/dashboard', { timeout: 45000 });
      expect(page.url()).toContain('/dashboard');
    } finally {
      await cleanup(seeded);
    }
  });

  test('hr sees a READ-ONLY role field on Edit Profile (may edit staff but not re-role them)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const hrEmail = uid('hr-actor');
    const hrPassword = 'RoleChgHr!9';
    const targetEmail = uid('target-nurse');
    const targetPassword = 'RoleChgTarget!9';

    const seeded = await seedActorAndTarget(
      'hr',
      hrEmail,
      hrPassword,
      'nurse',
      targetEmail,
      targetPassword,
    );

    try {
      await loginAs(page, hrEmail, hrPassword);
      await page.waitForURL('**/dashboard', { timeout: 45000 });

      const dialog = await openEditStaffModal(page, seeded.targetId);
      await expect(dialog.getByRole('combobox')).toHaveCount(0);
      await expect(
        dialog.getByText(/only an owner or supervisor can change a staff member.s role/i),
      ).toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });

  test('supervisor cannot select Owner in the role picker (option absent)', async ({ page }) => {
    test.setTimeout(90_000);
    const supEmail = uid('sup-actor');
    const supPassword = 'RoleChgSup!9';
    const targetEmail = uid('target-hr');
    const targetPassword = 'RoleChgTarget!9';

    const seeded = await seedActorAndTarget(
      'supervisor',
      supEmail,
      supPassword,
      'hr',
      targetEmail,
      targetPassword,
    );

    try {
      await loginAs(page, supEmail, supPassword);
      await page.waitForURL('**/dashboard', { timeout: 45000 });

      const dialog = await openEditStaffModal(page, seeded.targetId);
      await dialog.getByRole('combobox').click();
      await expect(page.getByRole('option', { name: /^owner/i })).not.toBeVisible();
      // The role the target already holds (hr) and other grantable roles ARE
      // present — confirms the Select rendered real options, not an empty list.
      await expect(page.getByRole('option', { name: /^hr$/i })).toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });

  test('self role change is blocked: owner sees their own role field as read-only', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ownerEmail = uid('owner-self');
    const ownerPassword = 'RoleChgSelf!9';
    // The seed helper always creates an actor + a target; the target here is
    // unused filler (this scenario is the owner viewing/editing THEIR OWN
    // profile via `seeded.actorId`).
    const seeded = await seedActorAndTarget(
      'owner',
      ownerEmail,
      ownerPassword,
      'nurse',
      uid('unused-filler'),
      'unused-password-99',
    );

    try {
      await loginAs(page, ownerEmail, ownerPassword);
      await page.waitForURL('**/dashboard', { timeout: 45000 });

      const dialog = await openEditStaffModal(page, seeded.actorId);
      await expect(dialog.getByRole('combobox')).toHaveCount(0);
      await expect(dialog.getByText(/you cannot change your own role/i)).toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });
});
