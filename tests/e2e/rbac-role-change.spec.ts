/**
 * E2E spec: in-place staff role change — the UI path was REMOVED.
 *
 * Background: the staff-profile header was reworked to the Figma design
 * (see rbac-staff-view-only.spec.ts) and now carries a single mutating
 * action, "Assign Course". `EditStaffModal` — which used to render an
 * editable, grouped role picker for an Owner/Supervisor re-roling a
 * reachable target, or a read-only role field otherwise — has ZERO product
 * usages left and has been deleted as dead code. There is no UI path left
 * to change a staff member's role in place; role assignment now happens
 * only at invite time (`InviteStaffModal`, see rbac-invite-roles.spec.ts).
 *
 * Scenarios covered here:
 *   - Owner / Supervisor / HR (every role holding `user.edit`) see NO
 *     role-editing affordance anywhere on a staff profile — only "Assign
 *     Course" — including when viewing their OWN profile.
 *   - Owner / Supervisor can still remove a staff member from the roster via
 *     the staff-list row kebab (`RemoveStaffModal`, unaffected by this
 *     change) — but that same kebab menu offers no re-role affordance
 *     either, confirming role assignment isn't reachable from there.
 *
 * Dropped (entire premise required the deleted UI):
 *   - "owner changes an HR staffer to Nurse: live session dies, re-login
 *     lands on /worker, history preserved" — exercised `EditStaffModal`'s
 *     editable role picker end-to-end, including the sessionVersion-bump
 *     kill-switch and post-change re-login. That picker no longer exists.
 *     The underlying `updateStaffDetails` behavior (session kill via
 *     `sessionVersion` bump, the `canChangeRole` guard, and the fact that
 *     `managerId`/enrollments/certificates are untouched by design — no
 *     cascading writes) remains covered at the server-action level in
 *     `src/app/actions/staff.test.ts` ("in-place role change (canChangeRole
 *     integration)") and `src/lib/rbac/role-utils.test.ts`.
 *   - "supervisor cannot select Owner in the role picker" and "hr sees a
 *     read-only role field" — both asserted properties of a combobox that
 *     no longer renders; superseded here by the blanket "no role-editing
 *     affordance at all" assertion, which is true regardless of viewer role.
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

type ViewerRole = 'owner' | 'supervisor' | 'hr';

interface SeededScenario {
  viewerId: string;
  viewerOrgUserId: string;
  targetId: string;
  targetOrgUserId: string;
  orgId: string;
  facilityId: string;
}

/** Seeds one org containing the viewer (the role under test) and an active target staff member. */
async function seedScenario(
  viewerRole: ViewerRole,
  viewerEmail: string,
  viewerPassword: string,
  targetEmail: string,
): Promise<SeededScenario> {
  const client = await db();
  try {
    const hashed = await bcrypt.hash(viewerPassword, 10);
    const slug = `role-chg-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const viewerId = crypto.randomUUID();
    const targetId = crypto.randomUUID();
    const viewerOrgUserId = crypto.randomUUID();
    const targetOrgUserId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Role Change Test ${slug}`, slug, viewerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Role Change Test ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Viewer', 'Test', 'Viewer Test', NOW(), NOW())`,
      [viewerId, viewerEmail, hashed],
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
       VALUES ($1, $2, $3, true, 'credentials', 'Target', 'Nurse', 'Target Nurse', NOW(), NOW())`,
      [targetId, targetEmail, hashed],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, job_title, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", 'Staff Nurse', true, NOW(), NOW(), NOW(), NOW())`,
      [targetOrgUserId, targetId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), targetOrgUserId, facilityId],
    );

    return { viewerId, viewerOrgUserId, targetId, targetOrgUserId, orgId, facilityId };
  } finally {
    await client.end();
  }
}

async function cleanupScenario(s: SeededScenario): Promise<void> {
  const client = await db();
  try {
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [[s.viewerOrgUserId, s.targetOrgUserId]],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [
      [s.viewerOrgUserId, s.targetOrgUserId],
    ]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [[s.viewerId, s.targetId]]);
    await client.query(`DELETE FROM facilities WHERE organization_id = $1`, [s.orgId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [s.orgId]);
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
  await page.waitForURL('**/dashboard**', { timeout: 45000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// RBAC ruling bundled with the multi-org schema refactor (src/lib/rbac/permissions.ts,
// 427/427 passing, treated as ground truth): supervisor became READ-ONLY on every
// resource (readEverythingExceptBilling + self-service perms only) — it no longer
// holds `user.edit`, so it can no longer reach the "Assign Course" affordance that
// updateStaffDetails/assignCourseToStaffMember gate on. Owner and hr are unaffected.
const ASSIGN_COURSE_VISIBLE: Record<ViewerRole, boolean> = {
  owner: true,
  supervisor: false,
  hr: true,
};

test.describe('Staff role change — no in-place UI path remains', () => {
  for (const role of ['owner', 'supervisor', 'hr'] as const) {
    test(`${role}: staff profile shows no role-editing affordance`, async ({ page }) => {
      test.setTimeout(90_000);
      const viewerEmail = uid(`viewer-${role}`);
      const viewerPassword = 'RoleChgView!9';
      const targetEmail = uid('target-nurse');

      const seeded = await seedScenario(role, viewerEmail, viewerPassword, targetEmail);
      try {
        await loginAs(page, viewerEmail, viewerPassword);
        await page.goto(`/dashboard/staff/${seeded.targetOrgUserId}`);

        await expect(page.getByRole('heading', { name: 'Trainings' })).toBeVisible();

        if (ASSIGN_COURSE_VISIBLE[role]) {
          // This viewer holds user.edit — "Assign Course" is the ONLY mutating
          // affordance left on the profile.
          await expect(page.getByRole('button', { name: 'Assign Course' })).toBeVisible();
        } else {
          // supervisor lost user.edit under the RBAC ruling — no mutating
          // affordance at all remains on the profile.
          await expect(page.getByRole('button', { name: 'Assign Course' })).toHaveCount(0);
        }

        // The deleted EditStaffModal's affordances must not exist anywhere.
        await expect(page.getByRole('button', { name: 'Edit Profile' })).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByRole('combobox')).toHaveCount(0);
      } finally {
        await cleanupScenario(seeded);
      }
    });
  }

  test('owner: viewing their own profile also shows no role-editing affordance', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ownerEmail = uid('owner-self');
    const ownerPassword = 'RoleChgSelf!9';

    const seeded = await seedScenario('owner', ownerEmail, ownerPassword, uid('unused-target'));
    try {
      await loginAs(page, ownerEmail, ownerPassword);
      await page.goto(`/dashboard/staff/${seeded.viewerOrgUserId}`);

      await expect(page.getByRole('heading', { name: 'Trainings' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit Profile' })).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('combobox')).toHaveCount(0);
    } finally {
      await cleanupScenario(seeded);
    }
  });

  test('owner: can remove a staff member via the list kebab; the same menu offers no re-role option', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const viewerEmail = uid('viewer-owner');
    const viewerPassword = 'RoleChgRemove!9';
    const targetEmail = uid('target-nurse');

    const seeded = await seedScenario('owner', viewerEmail, viewerPassword, targetEmail);
    try {
      await loginAs(page, viewerEmail, viewerPassword);
      await page.goto('/dashboard/staff');
      await page.waitForLoadState('networkidle');

      const staffRow = page.locator('tr', { hasText: targetEmail });
      await expect(staffRow).toBeVisible();
      const staffRowMenuBtn = staffRow.getByRole('button', { name: 'Row actions' });
      await staffRowMenuBtn.waitFor({ state: 'visible' });
      await staffRowMenuBtn.click();

      // No re-role affordance anywhere in the row menu.
      await expect(page.getByRole('menuitem', { name: /edit profile/i })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: /change role/i })).toHaveCount(0);

      const removeItem = page.getByRole('menuitem', { name: 'Remove Staff' });
      await expect(removeItem).toBeVisible({ timeout: 15000 });
      await removeItem.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Remove Staff' }).click();
      await expect(dialog).toBeHidden({ timeout: 15000 });

      // Removed staff no longer appear in the org roster.
      await expect(page.locator('tr', { hasText: targetEmail })).toHaveCount(0, {
        timeout: 15000,
      });
    } finally {
      await cleanupScenario(seeded);
    }
  });

  // RBAC-ruling regression: supervisor lost user.delete (read-only tier), so the
  // list kebab must offer neither removal nor any re-role affordance for it.
  test('supervisor: list kebab offers no Remove Staff or re-role affordance', async ({ page }) => {
    test.setTimeout(90_000);
    const viewerEmail = uid('viewer-supervisor');
    const viewerPassword = 'RoleChgRemove!9';
    const targetEmail = uid('target-nurse');

    const seeded = await seedScenario('supervisor', viewerEmail, viewerPassword, targetEmail);
    try {
      await loginAs(page, viewerEmail, viewerPassword);
      await page.goto('/dashboard/staff');
      await page.waitForLoadState('networkidle');

      const staffRow = page.locator('tr', { hasText: targetEmail });
      await expect(staffRow).toBeVisible();

      // supervisor holds neither user.edit nor user.delete, so the row kebab —
      // now limited to Change Facility / Remove Staff — renders not at all.
      // Read-only access to the profile survives as the row click.
      await expect(staffRow.getByRole('button', { name: 'Row actions' })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: /edit profile/i })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: /change role/i })).toHaveCount(0);

      // Staff member remains in the roster — no removal path was reachable.
      await expect(page.locator('tr', { hasText: targetEmail })).toBeVisible();
    } finally {
      await cleanupScenario(seeded);
    }
  });
});
