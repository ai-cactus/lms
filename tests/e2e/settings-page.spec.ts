/**
 * E2E spec: /dashboard/settings (Phase C — new owner-only Settings page).
 *
 * Acceptance criteria:
 *   - Owner sees all three tabs (Users & Permissions, Roles, Facility) and the
 *     "Settings" nav entry in the sidebar.
 *   - A non-owner admin (hr) gets the styled access-denied card at
 *     /dashboard/settings AND does not see the "Settings" nav item at all.
 *   - Saving the Facility tab's name/type persists via `updateFacility` (DB
 *     row updated), matching the "Your Facility" persistence pattern already
 *     covered for /dashboard/profile in rbac-facility-tab.spec.ts.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005.
 *   - DATABASE_URL reachable for seeding + DB assertions.
 */

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

type Role = 'owner' | 'hr';

interface Seeded {
  userId: string;
  orgId: string;
  facilityId: string;
}

async function seedWithRole(role: Role, email: string, password: string): Promise<Seeded> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const hashed = await bcrypt.hash(password, 10);
    const slug = `settings-test-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Settings Test ${slug}`, slug, email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Settings Test Facility ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4::"UserRole", true, $5, $6, NOW(), NOW())`,
      [userId, email, hashed, role, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, email, 'Settings', 'Test', 'Settings Test'],
    );
    return { userId, orgId, facilityId };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM profiles WHERE id = $1`, [seeded.userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.userId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@settings-e2e.invalid`;
}

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 15000 });
}

test.describe('Settings page — owner-only access', () => {
  test('owner sees the Settings nav entry and all three tabs at /dashboard/settings', async ({
    page,
  }) => {
    const email = uid('owner');
    const seeded = await seedWithRole('owner', email, 'Owne!rSet99x');
    try {
      await login(page, email, 'Owne!rSet99x');

      await expect(page.getByRole('link', { name: /^settings$/i })).toBeVisible();
      await page.getByRole('link', { name: /^settings$/i }).click();
      await page.waitForURL('**/dashboard/settings**');

      await expect(page.getByRole('tab', { name: /users.*permissions/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /^roles$/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /^facility$/i })).toBeVisible();
      await expect(page.getByText(/don.t have access to settings/i)).not.toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });

  test('hr gets access-denied at /dashboard/settings and has no Settings nav entry', async ({
    page,
  }) => {
    const email = uid('hr');
    const seeded = await seedWithRole('hr', email, 'HrSet!99xPP');
    try {
      await login(page, email, 'HrSet!99xPP');

      // No Settings nav entry at all for a non-owner admin.
      await expect(page.getByRole('link', { name: /^settings$/i })).not.toBeVisible();

      // Direct navigation is still gated server-side.
      await page.goto('/dashboard/settings');
      await page.waitForLoadState('networkidle');
      await expect(page.getByText(/don.t have access to settings/i)).toBeVisible();
      await expect(page.getByRole('tab', { name: /^facility$/i })).not.toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });
});

test.describe('Settings page — Facility tab persistence', () => {
  test('owner can update facility name/type and the change persists via updateFacility', async ({
    page,
  }) => {
    const email = uid('owner-facility');
    const seeded = await seedWithRole('owner', email, 'Own3rFacil!ty9');
    const newName = `Renamed Facility ${crypto.randomBytes(3).toString('hex')}`;
    try {
      await login(page, email, 'Own3rFacil!ty9');
      await page.goto('/dashboard/settings');
      await page.waitForLoadState('networkidle');

      await page.getByRole('tab', { name: /^facility$/i }).click();

      // "Facility name" is a real <Input> — Field's id-clone reaches its DOM
      // node correctly here (unlike the Select-based "Facility type" field).
      const nameInput = page.getByLabel('Facility name');
      await nameInput.fill(newName);

      await page.getByRole('combobox').click();
      await page.getByRole('option', { name: 'Outpatient clinic' }).click();

      const responsePromise = page.waitForResponse(
        (resp) => resp.url().includes('/dashboard/settings') && resp.status() === 200,
        { timeout: 10000 },
      );
      await page.getByRole('button', { name: /save changes/i }).click();
      await responsePromise;

      await expect(page.getByText(/facility updated/i)).toBeVisible({ timeout: 10000 });

      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const res = await client.query(`SELECT name, type FROM facilities WHERE id = $1`, [
          seeded.facilityId,
        ]);
        expect(res.rows[0]).toMatchObject({ name: newName, type: 'Outpatient clinic' });
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });
});
