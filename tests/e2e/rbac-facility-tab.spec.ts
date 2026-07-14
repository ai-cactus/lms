/**
 * E2E spec: "Your Facility" tab — permission-gated visibility, read-only content.
 *
 * Acceptance criteria:
 *   - Owner sees the "Your Facility" tab on /dashboard/profile.
 *   - Supervisor sees the "Your Facility" tab on /dashboard/profile.
 *   - HR sees the "Your Facility" tab (every manager role has facility.read —
 *     see src/lib/rbac/permissions.ts and permissions.test.ts:140).
 *   - The facility tab's fields (e.g. phone) are disabled/read-only for every
 *     role, and there is no Save/submit control for the facility form —
 *     editing moved to the owner-only Settings page (see settings-page.spec.ts).
 *
 * Pre-conditions:
 *   - App is running on http://localhost:3005.
 *   - DATABASE_URL reachable for direct DB seeding.
 *
 * Note: the tab visibility is gated purely on can(roleKey, 'facility.read')
 * (src/app/dashboard/(main)/profile/page.tsx:29); FacilityForm itself
 * (src/components/dashboard/FacilityForm.tsx) renders every field disabled
 * regardless of role, with no save flow.
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

type UserRole =
  | 'owner'
  | 'supervisor'
  | 'hr'
  | 'clinical_director'
  | 'finance'
  | 'psychiatrist_prescriber'
  | 'nurse'
  | 'therapist_clinician'
  | 'case_manager'
  | 'behavioral_health_technician'
  | 'peer_support_specialist'
  | 'front_desk_admin'
  | 'facilities_support';

async function seedWithRole(role: UserRole, email: string, password: string): Promise<Seeded> {
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
      await expect(page.getByRole('button', { name: /your facility/i })).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await cleanup(seeded);
    }
  });

  test('supervisor sees the "Your Facility" tab on the profile page', async ({ page }) => {
    const email = uid('supervisor');
    const seeded = await seedWithRole('supervisor', email, 'Sup3rv!s0r');
    try {
      await loginAndGoToProfile(page, email, 'Sup3rv!s0r');
      await expect(page.getByRole('button', { name: /your facility/i })).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await cleanup(seeded);
    }
  });

  test('hr sees the "Your Facility" tab (hr has facility.read)', async ({ page }) => {
    const email = uid('hr');
    const seeded = await seedWithRole('hr', email, 'Hr!Pass99x');
    try {
      await loginAndGoToProfile(page, email, 'Hr!Pass99x');
      await expect(page.getByRole('button', { name: /your facility/i })).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await cleanup(seeded);
    }
  });

  // NOTE: a worker-category role (e.g. 'nurse') cannot be exercised through
  // loginAndGoToProfile() here — src/app/actions/auth.ts redirects any
  // isWorkerRole() user straight to /worker regardless of which login portal
  // was used, so it never reaches /dashboard/profile at all. That is already
  // covered at the routing layer by tests/e2e/rbac-roles.spec.ts (worker-category
  // login lands at /worker); asserting tab *invisibility* for a role that can't
  // reach the page would be redundant with that routing guard.
});

test.describe('"Your Facility" tab — read-only content', () => {
  test('owner sees the facility tab rendered read-only with no save control', async ({
    page,
  }) => {
    const email = uid('owner-readonly');
    const seeded = await seedWithRole('owner', email, 'Owne!r99xP');
    try {
      await loginAndGoToProfile(page, email, 'Owne!r99xP');

      // Click the "Your Facility" tab — ProfileForm renders tabs as <button> elements (no role="tab")
      await page.getByRole('button', { name: /your facility/i }).click();
      await page.waitForLoadState('networkidle');

      // PhoneInput renders <input type="tel"> — there is no htmlFor/id link so
      // getByLabel() won't find it. Target by type instead.
      const phoneInput = page.locator('input[type="tel"]').first();
      await expect(phoneInput).toBeVisible();
      await expect(phoneInput).toBeDisabled();

      // Editing moved to the owner-only Settings page — the profile facility
      // tab has no Save/submit control of its own.
      await expect(page.getByRole('button', { name: /save/i })).toHaveCount(0);
    } finally {
      await cleanup(seeded);
    }
  });
});
