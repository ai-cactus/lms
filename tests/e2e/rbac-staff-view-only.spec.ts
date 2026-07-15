/**
 * E2E spec: RBAC matrix realignment (Change 1) — Finance and Clinical Director
 * become VIEW-ONLY over the staff roster; HR (and Owner/Supervisor) retain
 * full staff CRUD.
 *
 * Background: `updateStaffDetails`, `removeStaff`, `setStaffManager`,
 * `revokeInvite` and `resendInvite` (src/app/actions/staff.ts) previously
 * gated on the coarse `isAdminRole()` check, which let every admin-tier role
 * — including Finance and Clinical Director, who only hold `user.read` in
 * the permission registry — mutate the staff roster. The fix replaces those
 * gates with `can(role, '<resource>.<action>')`. The corresponding UI
 * (`StaffListClient`, `StaffProfileClient`, `EditStaffModal`) now hides the
 * dead-end affordances for view-only roles; the server independently
 * enforces the same gates (see `src/app/actions/staff.test.ts` for direct
 * server-action denial coverage — this spec verifies the UI-level and
 * full-stack browser behavior instead of re-testing the pure gate logic).
 *
 * Scenarios:
 *   - Finance / Clinical Director: no Edit Profile / Remove Staff / Assign
 *     Course on a staff profile; manager select disabled with a caption; no
 *     row-level Remove Staff action in the staff list; no kebab at all on a
 *     pending-invite row (no invite.edit/invite.delete).
 *   - HR: retains every affordance above (regression against the coarse
 *     isAdminRole() gate that used to grant this implicitly).
 *   - Owner: retains every affordance above (regression / control group).
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - DATABASE_URL reachable for direct DB seeding.
 */

import { test, expect, type Page } from '@playwright/test';
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

type ViewerRole = 'finance' | 'clinical_director' | 'hr' | 'owner' | 'supervisor';

interface SeededScenario {
  viewerId: string;
  targetId: string;
  inviteId: string;
  orgId: string;
  facilityId: string;
}

/**
 * Seeds one org containing:
 *   - the viewer (the role under test)
 *   - an active target staff member (nurse) with a job title
 *   - one pending invite (nurse) — used to probe the invite-row kebab
 */
async function seedScenario(
  viewerRole: ViewerRole,
  viewerEmail: string,
  viewerPassword: string,
  targetEmail: string,
  inviteEmail: string,
): Promise<SeededScenario> {
  const client = await db();
  try {
    const hashed = await bcrypt.hash(viewerPassword, 10);
    const slug = `view-only-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const viewerId = crypto.randomUUID();
    const targetId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();
    const inviteToken = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `View-Only Test ${slug}`, slug, viewerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `View-Only Test ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4::"UserRole", true, $5, $6, NOW(), NOW())`,
      [viewerId, viewerEmail, hashed, viewerRole, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, job_title, created_at, updated_at)
       VALUES ($1, $2, 'Viewer', 'Test', 'Viewer Test', 'Viewer', NOW(), NOW())`,
      [viewerId, viewerEmail],
    );

    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", true, $4, $5, NOW(), NOW())`,
      [targetId, targetEmail, hashed, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, job_title, created_at, updated_at)
       VALUES ($1, $2, 'Target', 'Nurse', 'Target Nurse', 'Staff Nurse', NOW(), NOW())`,
      [targetId, targetEmail],
    );

    await client.query(
      `INSERT INTO invites (id, email, token, organization_id, role, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, 'nurse'::"UserRole", 'pending', NOW() + INTERVAL '7 days', NOW())`,
      [inviteId, inviteEmail, inviteToken, orgId],
    );

    return { viewerId, targetId, inviteId, orgId, facilityId };
  } finally {
    await client.end();
  }
}

async function cleanupScenario(s: SeededScenario): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM invites WHERE id = $1`, [s.inviteId]);
    await client.query(`DELETE FROM profiles WHERE id = ANY($1)`, [[s.viewerId, s.targetId]]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [[s.viewerId, s.targetId]]);
    await client.query(`DELETE FROM facilities WHERE organization_id = $1`, [s.orgId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [s.orgId]);
  } finally {
    await client.end();
  }
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@view-only-e2e.invalid`;
}

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 45000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('RBAC matrix realignment — Finance / Clinical Director are view-only on staff', () => {
  for (const role of ['finance', 'clinical_director'] as const) {
    test(`${role}: no mutating staff affordances on the list or a profile`, async ({ page }) => {
      test.setTimeout(90_000);
      const viewerEmail = uid(`viewer-${role}`);
      const viewerPassword = 'V13w0nly!Pwd9';
      const targetEmail = uid('target-nurse');
      const inviteEmail = uid('pending-invite');

      const seeded = await seedScenario(role, viewerEmail, viewerPassword, targetEmail, inviteEmail);
      try {
        await loginAs(page, viewerEmail, viewerPassword);
        await page.goto('/dashboard/staff');
        await page.waitForLoadState('networkidle');

        // "Add Workers" is gone (no invite.create) — established regression coverage
        // (rbac-invite-roles / StaffListClient.test.tsx); re-asserted here as a
        // sanity check that this is the same view-only seed.
        await expect(
          page.getByRole('button', { name: /add workers?/i }),
        ).not.toBeVisible();

        // Pending-invite row: neither invite.edit nor invite.edit/delete are held,
        // so the kebab itself must not render at all for that row.
        const inviteRow = page.locator('tr', { hasText: inviteEmail });
        await expect(inviteRow).toBeVisible();
        await expect(inviteRow.getByRole('button', { name: 'Row actions' })).toHaveCount(0);

        // Active staff row: View Profile / Export PDF still show (unrelated to
        // user.delete), but "Remove Staff" must be absent from the menu.
        const staffRow = page.locator('tr', { hasText: targetEmail });
        await expect(staffRow).toBeVisible();
        const staffRowMenuBtn = staffRow.getByRole('button', { name: 'Row actions' });
        await staffRowMenuBtn.waitFor({ state: 'visible' });
        await staffRowMenuBtn.click();
        await expect(page.getByRole('menuitem', { name: 'View Profile' })).toBeVisible({
          timeout: 15000,
        });
        await expect(page.getByRole('menuitem', { name: 'Remove Staff' })).not.toBeVisible();
        await page.keyboard.press('Escape');

        // Staff profile page — navigate directly rather than clicking the row:
        // this scenario is about profile-level permission gating, not row-click
        // behavior — a direct nav decouples it from list/HMR timing.
        await page.goto(`/dashboard/staff/${seeded.targetId}`);

        await expect(page.getByRole('button', { name: 'Edit Profile' })).not.toBeVisible();
        await expect(page.getByRole('button', { name: 'Remove Staff' })).not.toBeVisible();
        await expect(page.getByRole('button', { name: 'Assign Course' })).not.toBeVisible();

        const managerSelect = page.getByLabel('Assign manager');
        await expect(managerSelect).toBeDisabled();
        await expect(
          page.getByText(/view only.*can.t change this staff member.s manager/i),
        ).toBeVisible();
      } finally {
        await cleanupScenario(seeded);
      }
    });
  }

  test('hr: retains full staff CRUD affordances (regression against the old coarse isAdminRole gate)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const viewerEmail = uid('viewer-hr');
    const viewerPassword = 'HrFullCrud!9';
    const targetEmail = uid('target-nurse');
    const inviteEmail = uid('pending-invite');

    const seeded = await seedScenario('hr', viewerEmail, viewerPassword, targetEmail, inviteEmail);
    try {
      await loginAs(page, viewerEmail, viewerPassword);
      await page.goto('/dashboard/staff');
      await page.waitForLoadState('networkidle');

      await expect(page.getByRole('button', { name: /add workers?/i })).toBeVisible();

      const inviteRow = page.locator('tr', { hasText: inviteEmail });
      const inviteRowMenuBtn = inviteRow.getByRole('button', { name: 'Row actions' });
      await inviteRowMenuBtn.waitFor({ state: 'visible' });
      await inviteRowMenuBtn.click();
      await expect(page.getByRole('menuitem', { name: 'Resend Invite' })).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByRole('menuitem', { name: 'Revoke Invite' })).toBeVisible();
      await page.keyboard.press('Escape');

      const staffRow = page.locator('tr', { hasText: targetEmail });
      const staffRowMenuBtn = staffRow.getByRole('button', { name: 'Row actions' });
      await staffRowMenuBtn.waitFor({ state: 'visible' });
      await staffRowMenuBtn.click();
      // NOTE: at the time this spec was written, HR is missing `user.delete` in
      // the RBAC permission registry (src/lib/rbac/permissions.ts), so this
      // assertion is expected to fail until that registry gap is fixed — see the
      // matching unit-test failure in staff.test.ts ("removeStaff() — permission
      // matrix ... allows hr to remove a staff member"). Per the approved plan's
      // decision ("HR keeps full staff CRUD"), HR must see this action.
      await expect(page.getByRole('menuitem', { name: 'Remove Staff' })).toBeVisible({
        timeout: 15000,
      });
      await page.keyboard.press('Escape');

      // Navigate directly rather than clicking the row: this scenario is
      // about profile-level permission gating, not row-click behavior — a
      // direct nav decouples it from the list's own click/HMR timing.
      await page.goto(`/dashboard/staff/${seeded.targetId}`);

      await expect(page.getByRole('button', { name: 'Edit Profile' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Assign Course' })).toBeVisible();
      // Same registry gap as above.
      await expect(page.getByRole('button', { name: 'Remove Staff' })).toBeVisible();

      const managerSelect = page.getByLabel('Assign manager');
      await expect(managerSelect).toBeEnabled();
    } finally {
      await cleanupScenario(seeded);
    }
  });

  test('owner: retains full staff CRUD affordances (control group)', async ({ page }) => {
    test.setTimeout(90_000);
    const viewerEmail = uid('viewer-owner');
    const viewerPassword = 'OwnerFullCr!9';
    const targetEmail = uid('target-nurse');
    const inviteEmail = uid('pending-invite');

    const seeded = await seedScenario(
      'owner',
      viewerEmail,
      viewerPassword,
      targetEmail,
      inviteEmail,
    );
    try {
      await loginAs(page, viewerEmail, viewerPassword);
      await page.goto('/dashboard/staff');
      await page.waitForLoadState('networkidle');

      const staffRow = page.locator('tr', { hasText: targetEmail });
      const staffRowMenuBtn = staffRow.getByRole('button', { name: 'Row actions' });
      await staffRowMenuBtn.waitFor({ state: 'visible' });
      await staffRowMenuBtn.click();
      await expect(page.getByRole('menuitem', { name: 'Remove Staff' })).toBeVisible({
        timeout: 15000,
      });
      await page.keyboard.press('Escape');

      // Navigate directly rather than clicking the row: this scenario is
      // about profile-level permission gating, not row-click behavior — a
      // direct nav decouples it from the list's own click/HMR timing.
      await page.goto(`/dashboard/staff/${seeded.targetId}`);

      await expect(page.getByRole('button', { name: 'Edit Profile' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Remove Staff' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Assign Course' })).toBeVisible();
    } finally {
      await cleanupScenario(seeded);
    }
  });
});
