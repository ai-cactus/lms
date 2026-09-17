/**
 * E2E spec: in-place staff role change — WHO reaches the UI path.
 *
 * SUPERSEDED PREMISE, REWRITTEN 2026-09-17.
 *
 * This spec previously asserted that NO in-place role-editing path existed for
 * anyone. That was never a product decision: the staff-profile header was
 * reworked to the Figma design, `EditStaffModal` was left with zero usages and
 * deleted as dead code, and this spec froze the resulting GAP as if it were
 * intended. Live QA then found `updateStaffDetails` correctly authorized and
 * invoked by nothing — two founder rulings (Q2, Q11) shipped as permissions
 * against an action no screen could reach.
 *
 * The path is back, as two separate affordances, so the spec's subject is no
 * longer "nothing exists" but WHICH VIEWER REACHES WHICH — which is the part
 * that actually encodes the rulings:
 *   - "Edit Profile"  → STAFF_PROFILE_ACTOR_ROLES (owner, admin, hr, supervisor)
 *   - "Change Role"   → ROLE_CHANGE_ACTOR_ROLES  (owner, admin, hr)
 *
 * Scenarios covered here:
 *   - Owner / HR see both affordances on a reachable target's profile;
 *     Supervisor sees Edit Profile and NEVER Change Role (Q2 grants basic
 *     profile editing, Q11 keeps re-roling with Owner/Admin/HR).
 *   - Nobody re-roles THEMSELVES — Change Role is absent on the viewer's own
 *     profile (`canChangeRole`'s `self_change`), though Edit Profile remains.
 *   - Owner / Supervisor can still remove a staff member from the roster via
 *     the staff-list row kebab (`RemoveStaffModal`, unaffected) — and that
 *     kebab still offers no re-role affordance, so the profile page remains
 *     the only in-place path.
 *
 * The flows themselves (a supervisor's edit persisting, HR's picker omitting
 * Owner/Admin, the sessionVersion kill-switch) are driven in
 * `tests/e2e/staff-profile-edit.spec.ts`; this spec stays a gating spec.
 *
 * Still covered at the server-action level rather than here: the
 * `canChangeRole` guard's four denial reasons and the no-cascading-writes
 * guarantee — `src/app/actions/staff.test.ts` ("in-place role change
 * (canChangeRole integration)") and `src/lib/rbac/role-utils.test.ts`.
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

// Every viewer here reaches the staff profile's mutating affordances. What
// separates them is the ROLE change: supervisor regained profile editing and
// course assignment on 2026-09-16 (founder Q2 — the supervisor's "U" on Staff
// Management covers "assigning courses and basic profile editing"), but re-roling
// stays ROLE_CHANGE_ACTOR_ROLES (Owner/Admin/HR) per Q11. Two actor lists, and
// this spec is what stops them being collapsed into one.

test.describe('Staff role change — who reaches the in-place UI path', () => {
  // `expect.soft` is deliberate on none of these: each is a distinct ruling.
  const CHANGE_ROLE_ACTORS = { owner: true, hr: true, supervisor: false } as const;

  for (const role of ['owner', 'supervisor', 'hr'] as const) {
    test(`${role}: profile offers Edit Profile, and Change Role only if entitled`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const viewerEmail = uid(`viewer-${role}`);
      const viewerPassword = 'RoleChgView!9';
      const targetEmail = uid('target-nurse');

      const seeded = await seedScenario(role, viewerEmail, viewerPassword, targetEmail);
      try {
        await loginAs(page, viewerEmail, viewerPassword);
        await page.goto(`/dashboard/staff/${seeded.targetOrgUserId}`);

        await expect(page.getByRole('heading', { name: 'Trainings' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Assign Course' })).toBeVisible();

        // Q2 — every staff-profile actor, supervisor included.
        await expect(page.getByRole('button', { name: 'Edit Profile' })).toBeVisible();

        // Q11 — the supervisor is the whole reason the two lists are separate.
        await expect(page.getByRole('button', { name: 'Change Role' })).toHaveCount(
          CHANGE_ROLE_ACTORS[role] ? 1 : 0,
        );

        // Nothing opens until asked: both modals mount on demand, so the page
        // carries no dialog and no role combobox at rest.
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByRole('combobox')).toHaveCount(0);
      } finally {
        await cleanupScenario(seeded);
      }
    });
  }

  // `canChangeRole` refuses `self_change`, so the control is absent rather than
  // offered and then refused. Editing your own name is not a role change and
  // stays available.
  test('owner: viewing their own profile can edit it but cannot re-role themselves', async ({
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
      await expect(page.getByRole('button', { name: 'Edit Profile' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Change Role' })).toHaveCount(0);
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

      // supervisor is neither a Rule A facility-change actor nor a `user.delete`
      // holder, so the row kebab — now limited to Change Facility / Remove
      // Staff — renders not at all. Gaining the profile-edit and assign powers
      // (Q2) deliberately did NOT add anything here.
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
