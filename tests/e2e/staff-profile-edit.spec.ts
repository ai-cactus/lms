/**
 * E2E spec: staff-profile "Edit Profile" and "Change Role" — the UI callers for
 * `updateStaffDetails` (src/app/actions/staff.ts).
 *
 * Live QA found the action correctly authorized and INVOKED BY NOTHING: two
 * founder rulings had shipped as permissions against a dead action. This spec
 * covers the journey that was unreachable.
 *
 * Acceptance criteria:
 *   - A facility supervisor opens a staff member in THEIR OWN facility, edits
 *     the name and job title, and the change persists (founder Q2 — the
 *     supervisor's "U" on Staff Management covers basic profile editing) AND is
 *     visible on the reloaded profile.
 *   - That supervisor never sees "Change Role": they are in
 *     STAFF_PROFILE_ACTOR_ROLES but not ROLE_CHANGE_ACTOR_ROLES.
 *   - HR re-roles a worker, and Owner/Admin are ABSENT from the role list rather
 *     than offered and refused (founder Q11 — "except Owner and Admin"). The
 *     re-role bumps the target's `session_version`, so their live sessions die.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
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

type ViewerRole = 'supervisor' | 'hr';

interface Seeded {
  orgId: string;
  facilityId: string;
  viewerId: string;
  viewerOrgUserId: string;
  viewerEmail: string;
  viewerPassword: string;
  staffUserId: string;
  staffOrgUserId: string;
  staffFullName: string;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@staff-edit-e2e.invalid`;
}

/**
 * One org, one facility, the viewer under test and a nurse to edit — both
 * assigned to that same facility, so the supervisor's own-facility narrowing
 * admits the target.
 */
async function seedFixture(viewerRole: ViewerRole): Promise<Seeded> {
  const client = await db();
  try {
    const viewerEmail = uid(`viewer-${viewerRole}`);
    const viewerPassword = 'StaffEdit!Vw9x';
    const viewerHashed = await bcrypt.hash(viewerPassword, 10);
    const staffEmail = uid('staff');
    const staffHashed = await bcrypt.hash('StaffEdit!Wk9x', 10);
    const slug = `staff-edit-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const viewerId = crypto.randomUUID();
    const viewerOrgUserId = crypto.randomUUID();
    const staffUserId = crypto.randomUUID();
    const staffOrgUserId = crypto.randomUUID();
    const staffFullName = 'Dana Editable';

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Staff Edit E2E ${slug}`, slug, viewerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Staff Edit Facility ${slug}`],
    );

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Viewer', 'Under Test', 'Viewer Under Test', NOW(), NOW())`,
      [viewerId, viewerEmail, viewerHashed],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, job_title, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4::"UserRole", 'Viewer', true, NOW(), NOW(), NOW(), NOW())`,
      [viewerOrgUserId, viewerId, orgId, viewerRole],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), viewerOrgUserId, facilityId],
    );

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Dana', 'Editable', $4, NOW(), NOW())`,
      [staffUserId, staffEmail, staffHashed, staffFullName],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, job_title, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", 'Staff Nurse', true, NOW(), NOW(), NOW(), NOW())`,
      [staffOrgUserId, staffUserId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), staffOrgUserId, facilityId],
    );

    return {
      orgId,
      facilityId,
      viewerId,
      viewerOrgUserId,
      viewerEmail,
      viewerPassword,
      staffUserId,
      staffOrgUserId,
      staffFullName,
    };
  } finally {
    await client.end();
  }
}

async function cleanup(s: Seeded): Promise<void> {
  const client = await db();
  try {
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [[s.viewerOrgUserId, s.staffOrgUserId]],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [
      [s.viewerOrgUserId, s.staffOrgUserId],
    ]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [[s.viewerId, s.staffUserId]]);
    await client.query(`DELETE FROM facilities WHERE organization_id = $1`, [s.orgId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [s.orgId]);
  } finally {
    await client.end();
  }
}

async function login(page: Page, email: string, password: string): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 45000 });
}

test.describe('Staff profile — Edit Profile (founder Q2)', () => {
  test('a facility supervisor edits a staff member in their own facility and it persists', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seeded = await seedFixture('supervisor');
    try {
      await login(page, seeded.viewerEmail, seeded.viewerPassword);
      await page.goto(`/dashboard/staff/${seeded.staffOrgUserId}`);
      await page.waitForLoadState('networkidle');

      await expect(page.getByRole('heading', { name: seeded.staffFullName })).toBeVisible();
      await page.getByRole('button', { name: 'Edit Profile' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Edit profile' })).toBeVisible();

      // Prefilled from the stored record, not from a display fallback.
      await expect(dialog.getByLabel(/First name/)).toHaveValue('Dana');
      await expect(dialog.getByLabel(/Job title/)).toHaveValue('Staff Nurse');

      await dialog.getByLabel(/First name/).fill('Danielle');
      await dialog.getByLabel(/Last name/).fill('Okafor');
      await dialog.getByLabel(/Job title/).fill('Charge Nurse');
      await dialog.getByRole('button', { name: 'Save changes' }).click();

      await expect(dialog).toBeHidden();
      await expect(page.getByRole('heading', { name: 'Danielle Okafor' })).toBeVisible();

      // QA reported the job title as "never persisting". It was written and read
      // back correctly all along — the profile header rendered it behind
      // `getRoleDisplayName(role) || user.jobTitle`, a branch that never falls
      // through, so the saved value appeared NOWHERE on the page. Assert on a
      // RELOADED page, not the post-save render, so this covers the store as
      // well as the display.
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Charge Nurse')).toBeVisible();

      await page.getByRole('button', { name: 'Edit Profile' }).click();
      const reopened = page.getByRole('dialog');
      await expect(reopened.getByLabel(/Job title/)).toHaveValue('Charge Nurse');
      await reopened.getByRole('button', { name: 'Cancel' }).click();

      const client = await db();
      try {
        const names = await client.query(
          `SELECT first_name, last_name, full_name FROM users WHERE id = $1`,
          [seeded.staffUserId],
        );
        expect(names.rows[0]).toMatchObject({
          first_name: 'Danielle',
          last_name: 'Okafor',
          full_name: 'Danielle Okafor',
        });

        // The role must be untouched: the modal echoes it back unchanged, so
        // the action's role-change branch never runs for a profile edit.
        const membership = await client.query(
          `SELECT role::text AS role, job_title FROM organization_users WHERE id = $1`,
          [seeded.staffOrgUserId],
        );
        expect(membership.rows[0]).toMatchObject({ role: 'nurse', job_title: 'Charge Nurse' });
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });

  // Two actor lists, not one. A supervisor edits profiles under Q2 and must
  // never re-role anyone — collapsing the gates would surface this control.
  test('a facility supervisor sees Edit Profile but never Change Role', async ({ page }) => {
    test.setTimeout(90_000);
    const seeded = await seedFixture('supervisor');
    try {
      await login(page, seeded.viewerEmail, seeded.viewerPassword);
      await page.goto(`/dashboard/staff/${seeded.staffOrgUserId}`);
      await page.waitForLoadState('networkidle');

      await expect(page.getByRole('button', { name: 'Edit Profile' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Change Role' })).toHaveCount(0);
    } finally {
      await cleanup(seeded);
    }
  });
});

test.describe('Staff profile — Change Role (founder Q11)', () => {
  test('HR re-roles a worker, with Owner and Admin absent from the options', async ({ page }) => {
    test.setTimeout(90_000);
    const seeded = await seedFixture('hr');
    try {
      await login(page, seeded.viewerEmail, seeded.viewerPassword);
      await page.goto(`/dashboard/staff/${seeded.staffOrgUserId}`);
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: 'Change Role' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Change role' })).toBeVisible();

      await dialog.getByRole('combobox').click();
      const options = page.getByRole('listbox');
      await expect(options).toBeVisible();

      // Q11's carve-out is STRUCTURAL — HR's GRANTABLE_ROLES omits both, so
      // neither option exists to be clicked. QA checked for exactly this.
      await expect(options.getByRole('option', { name: /^Owner/ })).toHaveCount(0);
      await expect(options.getByRole('option', { name: /^Admin/ })).toHaveCount(0);

      await options.getByRole('option', { name: /Case Manager/ }).click();
      await dialog.getByRole('button', { name: 'Change role' }).click();

      // Two-step: the consequence is named before anything is written.
      await expect(dialog.getByText(/signed out of any active session/)).toBeVisible();
      await dialog.getByRole('button', { name: 'Change role' }).click();

      await expect(dialog).toBeHidden();

      const client = await db();
      try {
        const membership = await client.query(
          `SELECT role::text AS role, job_title FROM organization_users WHERE id = $1`,
          [seeded.staffOrgUserId],
        );
        // Job title echoed back untouched — this affordance only re-roles.
        expect(membership.rows[0]).toMatchObject({
          role: 'case_manager',
          job_title: 'Staff Nurse',
        });

        // F-059 kill-switch: the target's live sessions die on their next decode.
        const identity = await client.query(`SELECT session_version FROM users WHERE id = $1`, [
          seeded.staffUserId,
        ]);
        expect(Number(identity.rows[0].session_version)).toBeGreaterThan(0);
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });
});
