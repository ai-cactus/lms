/**
 * E2E spec: staff "Change Facility" flow (multi-facility v3 increment 2) —
 * driven from /dashboard/staff's per-row kebab menu, gated on `user.edit` and
 * only offered when the caller's org has 2+ facilities.
 *
 * Acceptance criteria:
 *   - Owner opens "Change Facility" from a staff row's kebab menu, selects a
 *     new facility, confirms the two-step dialog, and the change persists to
 *     `organization_user_facilities` (old assignment deactivated, new one
 *     active) via setStaffFacilities.
 *   - Cancelling from the confirm step makes no change.
 *   - Supervisor (lacks `user.edit`) never sees the "Change Facility" item.
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
  ownerId: string;
  ownerOrgUserId: string;
  ownerEmail: string;
  ownerPassword: string;
  facilityAId: string;
  facilityAName: string;
  facilityBId: string;
  facilityBName: string;
  staffUserId: string;
  staffOrgUserId: string;
  staffFullName: string;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@staff-facility-e2e.invalid`;
}

async function seedOrgWithStaffAndTwoFacilities(): Promise<Seeded> {
  const client = await db();
  try {
    const ownerEmail = uid('owner');
    const ownerPassword = 'StaffFac!Owner9';
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const staffEmail = uid('staff');
    const staffHashed = await bcrypt.hash('StaffFac!Worker9', 10);
    const slug = `staff-facility-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const ownerOrgUserId = crypto.randomUUID();
    const staffUserId = crypto.randomUUID();
    const staffOrgUserId = crypto.randomUUID();
    const facilityAId = crypto.randomUUID();
    const facilityBId = crypto.randomUUID();
    const facilityAName = `Alpha Site ${slug}`;
    const facilityBName = `Beta Site ${slug}`;
    const staffFullName = 'Sam Staffer';

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Staff Facility E2E ${slug}`, slug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityAId, orgId, facilityAName],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityBId, orgId, facilityBName],
    );
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
      [ownerId, ownerEmail, ownerHashed, 'Staff', 'Owner', 'Staff Owner'],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [ownerOrgUserId, ownerId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), ownerOrgUserId, facilityAId],
    );

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
      [staffUserId, staffEmail, staffHashed, 'Sam', 'Staffer', staffFullName],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [staffOrgUserId, staffUserId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), staffOrgUserId, facilityAId],
    );

    return {
      orgId,
      ownerId,
      ownerOrgUserId,
      ownerEmail,
      ownerPassword,
      facilityAId,
      facilityAName,
      facilityBId,
      facilityBName,
      staffUserId,
      staffOrgUserId,
      staffFullName,
    };
  } finally {
    await client.end();
  }
}

async function addSupervisor(seeded: Seeded, email: string, password: string): Promise<string> {
  const client = await db();
  try {
    const hashed = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    const orgUserId = crypto.randomUUID();
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Sup', 'Ervisor', 'Sup Ervisor', NOW(), NOW())`,
      [userId, email, hashed],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'supervisor'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [orgUserId, userId, seeded.orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), orgUserId, seeded.facilityAId],
    );
    return orgUserId;
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded, extraOrgUserIds: string[] = []): Promise<void> {
  const client = await db();
  try {
    const allOrgUserIds = [seeded.ownerOrgUserId, seeded.staffOrgUserId, ...extraOrgUserIds];
    for (const orgUserId of allOrgUserIds) {
      await client.query(
        `DELETE FROM organization_user_facilities WHERE organization_user_id = $1`,
        [orgUserId],
      );
    }
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [[...allOrgUserIds]]);
    await client.query(`DELETE FROM users WHERE id = $1 OR id = $2`, [
      seeded.ownerId,
      seeded.staffUserId,
    ]);
    await client.query(`DELETE FROM facilities WHERE id = $1 OR id = $2`, [
      seeded.facilityAId,
      seeded.facilityBId,
    ]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
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
  await page.waitForURL('**/dashboard**', { timeout: 15000 });
}

test.describe('Staff — Change Facility flow', () => {
  test("owner changes a staff member's facility via the two-step confirm dialog, and it persists", async ({
    page,
  }) => {
    const seeded = await seedOrgWithStaffAndTwoFacilities();
    try {
      await login(page, seeded.ownerEmail, seeded.ownerPassword);
      await page.goto('/dashboard/staff');
      await page.waitForLoadState('networkidle');

      const staffRow = page.getByRole('row', { name: new RegExp(seeded.staffFullName, 'i') });
      await expect(staffRow).toBeVisible();
      await staffRow.getByRole('button', { name: 'Row actions' }).click();
      await page.getByRole('menuitem', { name: 'Change Facility' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      // The dialog's heading and its confirm button both read "Change
      // facility" (ChangeFacilityModal.tsx), so a plain getByText match is
      // ambiguous (strict-mode violation) — scope to the heading.
      await expect(dialog.getByRole('heading', { name: 'Change facility' })).toBeVisible();

      await dialog.getByRole('radio', { name: new RegExp(seeded.facilityBName) }).click();
      await dialog.getByRole('button', { name: 'Change facility' }).click();

      await expect(
        dialog.getByRole('heading', { name: new RegExp(`Switch.*${seeded.facilityBName}`) }),
      ).toBeVisible();

      await dialog.getByRole('button', { name: 'Switch facility' }).click();
      await expect(dialog).toBeHidden();

      const client = await db();
      try {
        const res = await client.query(
          `SELECT facility_id, active FROM organization_user_facilities WHERE organization_user_id = $1 ORDER BY facility_id`,
          [seeded.staffOrgUserId],
        );
        const activeFacilityIds = res.rows.filter((r) => r.active).map((r) => r.facility_id);
        expect(activeFacilityIds).toEqual([seeded.facilityBId]);
        const facilityARow = res.rows.find((r) => r.facility_id === seeded.facilityAId);
        expect(facilityARow?.active).toBe(false);
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });

  test('cancelling at the confirm step makes no change', async ({ page }) => {
    const seeded = await seedOrgWithStaffAndTwoFacilities();
    try {
      await login(page, seeded.ownerEmail, seeded.ownerPassword);
      await page.goto('/dashboard/staff');
      await page.waitForLoadState('networkidle');

      const staffRow = page.getByRole('row', { name: new RegExp(seeded.staffFullName, 'i') });
      await staffRow.getByRole('button', { name: 'Row actions' }).click();
      await page.getByRole('menuitem', { name: 'Change Facility' }).click();

      const dialog = page.getByRole('dialog');
      await dialog.getByRole('radio', { name: new RegExp(seeded.facilityBName) }).click();
      await dialog.getByRole('button', { name: 'Change facility' }).click();
      // "Cancel" on the confirm step returns to the select step — it does not
      // close the dialog (ChangeFacilityModal.tsx: onClick={() => setStep('select')}).
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog.getByRole('button', { name: 'Change facility' })).toBeVisible();
      // Closing from the select step is what actually dismisses the dialog.
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();

      const client = await db();
      try {
        const res = await client.query(
          `SELECT facility_id FROM organization_user_facilities WHERE organization_user_id = $1 AND active = true`,
          [seeded.staffOrgUserId],
        );
        expect(res.rows.map((r) => r.facility_id)).toEqual([seeded.facilityAId]);
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });

  test('supervisor (lacks user.edit) never sees "Change Facility" in the row menu', async ({
    page,
  }) => {
    const seeded = await seedOrgWithStaffAndTwoFacilities();
    const supervisorEmail = uid('supervisor');
    const supervisorPassword = 'StaffFac!Sup9x';
    const supervisorOrgUserId = await addSupervisor(seeded, supervisorEmail, supervisorPassword);
    try {
      await login(page, supervisorEmail, supervisorPassword);
      await page.goto('/dashboard/staff');
      await page.waitForLoadState('networkidle');

      const staffRow = page.getByRole('row', { name: new RegExp(seeded.staffFullName, 'i') });
      await expect(staffRow).toBeVisible();
      // A supervisor has neither `user.edit` (Change Facility) nor
      // `user.delete` (Remove Staff) on this row, so StaffListClient.tsx's
      // action cell renders no kebab trigger at all — not a kebab with a
      // hidden/disabled item (see its "Action cell" comment).
      await expect(staffRow.getByRole('button', { name: 'Row actions' })).not.toBeVisible();
    } finally {
      await cleanup(seeded, [supervisorOrgUserId]);
    }
  });
});
