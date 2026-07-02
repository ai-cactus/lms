/**
 * E2E spec: "Your Facility" tab — permission-gated visibility and persistence.
 *
 * Acceptance criteria:
 *   - Owner sees the "Your Facility" tab on /dashboard/profile.
 *   - Supervisor sees the "Your Facility" tab on /dashboard/profile.
 *   - HR does NOT see the "Your Facility" tab (no facility.read permission).
 *   - Worker does NOT see the "Your Facility" tab.
 *   - Editing a facility field as owner persists the value (API call returns 200).
 *   - The "Organization" tab remains intact and saves org-only fields independently.
 *
 * Pre-conditions:
 *   - App is running on http://localhost:3005.
 *   - DATABASE_URL reachable for direct DB seeding.
 *
 * Note: facility.edit is gated on the RBAC permission, so only owner and supervisor
 * can reach the tab and submit edits. The UI shows the tab conditionally based on
 * can(roleKey, 'facility.read').
 */

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

// ── DB helpers ────────────────────────────────────────────────────────────────

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

interface Seeded {
  userId: string;
  orgId: string;
  facilityId: string;
}

async function seedWithRole(
  role: 'owner' | 'supervisor' | 'hr' | 'clinical_director' | 'finance' | 'worker',
  email: string,
  password: string,
): Promise<Seeded> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const hashed = await bcrypt.hash(password, 10);
    const slug = `fac-test-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `FacTest ${slug}`, slug, email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `FacTest ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4::\"UserRole\", true, $5, $6, NOW(), NOW())`,
      [userId, email, hashed, role, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, email, 'Fac', 'Test', 'Fac Test'],
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
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@fac-e2e.invalid`;
}

async function loginAndGoToProfile(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
): Promise<void> {
  // Give each login attempt a unique source IP so the in-memory rate-limit
  // bucket (login:${ip}) doesn't accumulate across tests when the dev server
  // is reused and Redis is unavailable.
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 15000 });
  await page.goto('/dashboard/profile');
  await page.waitForLoadState('networkidle');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('"Your Facility" tab — visibility per role', () => {
  test('owner sees the "Your Facility" tab on the profile page', async ({ page }) => {
    const email = uid('owner');
    const seeded = await seedWithRole('owner', email, 'Owne!r99xP');
    try {
      await loginAndGoToProfile(page, email, 'Owne!r99xP');
      // The tab should be visible — ProfileForm renders tabs as <button> elements (no role="tab")
      await expect(
        page.getByRole('button', { name: /your facility/i }),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanup(seeded);
    }
  });

  test('supervisor sees the "Your Facility" tab on the profile page', async ({ page }) => {
    const email = uid('supervisor');
    const seeded = await seedWithRole('supervisor', email, 'Sup3rv!s0r');
    try {
      await loginAndGoToProfile(page, email, 'Sup3rv!s0r');
      await expect(
        page.getByRole('button', { name: /your facility/i }),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanup(seeded);
    }
  });

  test('hr does NOT see the "Your Facility" tab', async ({ page }) => {
    const email = uid('hr');
    const seeded = await seedWithRole('hr', email, 'Hr!Pass99x');
    try {
      await loginAndGoToProfile(page, email, 'Hr!Pass99x');
      // The "Your Facility" tab must be absent for HR — ProfileForm renders tabs as <button> elements
      await expect(
        page.getByRole('button', { name: /your facility/i }),
      ).not.toBeVisible({ timeout: 5000 });
    } finally {
      await cleanup(seeded);
    }
  });
});

test.describe('"Your Facility" tab — owner can edit and persist a facility field', () => {
  test('owner can update facility phone and the change is persisted via the API', async ({
    page,
  }) => {
    const email = uid('owner-edit');
    const seeded = await seedWithRole('owner', email, 'Owne!r99xP');
    // Use a 10-digit US number unique to this run. PhoneInput formats digits-only
    // input as "+1 (NXX)-XXX-XXXX" and passes that formatted string to onChange.
    const suffix = (Math.floor(Math.random() * 9000) + 1000).toString(); // 1000-9999
    const testDigits = `555012${suffix}`; // exactly 10 digits: (555)-012-XXXX
    const expectedPhone = `+1 (555)-012-${suffix}`;
    try {
      await loginAndGoToProfile(page, email, 'Owne!r99xP');

      // Click the "Your Facility" tab — ProfileForm renders tabs as <button> elements (no role="tab")
      await page.getByRole('button', { name: /your facility/i }).click();
      await page.waitForLoadState('networkidle');

      // PhoneInput renders <input type="tel"> — there is no htmlFor/id link so
      // getByLabel() won't find it. Target by type instead.
      const phoneInput = page.locator('input[type="tel"]').first();
      // Triple-click selects all existing text, then pressSequentially fires onChange
      // for each character so PhoneInput's digit formatter processes the full sequence.
      await phoneInput.click({ clickCount: 3 });
      await phoneInput.pressSequentially(testDigits, { delay: 30 });

      // Listen for the updateFacility server action to fire and get a 200
      const responsePromise = page.waitForResponse(
        (resp) => resp.url().includes('/dashboard/profile') && resp.status() === 200,
        { timeout: 10000 },
      );

      // Submit (locate a Save button within the facility tab context)
      await page.getByRole('button', { name: /save/i }).last().click();
      await responsePromise;

      // Verify the value persisted in the DB — PhoneInput stores the formatted "+1 (NXX)-XXX-XXXX"
      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const res = await client.query(
          `SELECT phone FROM facilities WHERE id = $1`,
          [seeded.facilityId],
        );
        expect(res.rows[0]?.phone).toBe(expectedPhone);
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });
});
