/**
 * E2E spec: the facilities section on Profile Settings — permission-gated
 * visibility and the two nav variants in the Figma mocks.
 *
 * Acceptance criteria:
 *   - An org-wide admin seat (Owner, HR) sees a "My Facilities" nav item listing
 *     every facility in the organization, read-only, with the banner pointing at
 *     Settings for edits.
 *   - A facility Supervisor sees "Assigned Facilities" instead — only the sites
 *     on their own assignments — and each card carries its own Edit control
 *     (PROF-002: supervisors may edit their own facility's details).
 *   - A Supervisor has no "My Organization" nav item; an org-wide seat does.
 *
 * Pre-conditions:
 *   - App is running on http://localhost:3005.
 *   - DATABASE_URL reachable for direct DB seeding.
 *
 * Nav visibility is derived in src/app/dashboard/(main)/profile/page.tsx from
 * can(roleKey, 'facility.read') plus isOrgWideFacilityRole(role); the panels
 * themselves live in src/components/dashboard/profile/.
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
  orgUserId: string;
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
    const orgUserId = crypto.randomUUID();

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
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
      [userId, email, hashed, 'Fac', 'Test', 'Fac Test'],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4::\"UserRole\", true, NOW(), NOW(), NOW(), NOW())`,
      [orgUserId, userId, orgId, role],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), orgUserId, facilityId],
    );
    return { userId, orgUserId, orgId, facilityId };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM organization_user_facilities WHERE organization_user_id = $1`, [
      seeded.orgUserId,
    ]);
    await client.query(`DELETE FROM organization_users WHERE id = $1`, [seeded.orgUserId]);
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

test.describe('Profile Settings — facilities nav per role', () => {
  test('owner sees the org-wide "My Facilities" section', async ({ page }) => {
    const email = uid('owner');
    const seeded = await seedWithRole('owner', email, 'Owne!r99xP');
    try {
      await loginAndGoToProfile(page, email, 'Owne!r99xP');
      await expect(page.getByRole('tab', { name: 'My Facilities' })).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByRole('tab', { name: 'Assigned Facilities' })).toHaveCount(0);
    } finally {
      await cleanup(seeded);
    }
  });

  test('hr sees the org-wide "My Facilities" section (hr has facility.read)', async ({ page }) => {
    const email = uid('hr');
    const seeded = await seedWithRole('hr', email, 'Hr!Pass99x');
    try {
      await loginAndGoToProfile(page, email, 'Hr!Pass99x');
      await expect(page.getByRole('tab', { name: 'My Facilities' })).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await cleanup(seeded);
    }
  });

  test('supervisor sees "Assigned Facilities" and no organization section', async ({ page }) => {
    const email = uid('supervisor');
    const seeded = await seedWithRole('supervisor', email, 'Sup3rv!s0r');
    try {
      await loginAndGoToProfile(page, email, 'Sup3rv!s0r');
      await expect(page.getByRole('tab', { name: 'Assigned Facilities' })).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByRole('tab', { name: 'My Organization' })).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'My Facilities' })).toHaveCount(0);
    } finally {
      await cleanup(seeded);
    }
  });

  // NOTE: a worker-category role (e.g. 'nurse') cannot be exercised through
  // loginAndGoToProfile() here — src/app/actions/auth.ts redirects any
  // isWorkerRole() user straight to /worker regardless of which login portal
  // was used, so it never reaches /dashboard/profile at all. That is already
  // covered at the routing layer by tests/e2e/rbac-roles.spec.ts.
});

test.describe('Profile Settings — facility card content', () => {
  test('owner gets read-only cards pointing at Settings, with no per-card Edit', async ({
    page,
  }) => {
    const email = uid('owner-readonly');
    const seeded = await seedWithRole('owner', email, 'Owne!r99xP');
    try {
      await loginAndGoToProfile(page, email, 'Owne!r99xP');
      await page.getByRole('tab', { name: 'My Facilities' }).click();

      await expect(page.getByRole('heading', { name: 'My facilities' })).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByRole('link', { name: /settings/i })).toBeVisible();
      // Editing a facility from here moved to the owner-only Settings page.
      await expect(page.getByRole('button', { name: /^edit$/i })).toHaveCount(0);
    } finally {
      await cleanup(seeded);
    }
  });

  test('supervisor gets an Edit control that opens the facility form, name first', async ({
    page,
  }) => {
    const email = uid('supervisor-edit');
    const seeded = await seedWithRole('supervisor', email, 'Sup3rv!s0r');
    try {
      await loginAndGoToProfile(page, email, 'Sup3rv!s0r');
      await page.getByRole('tab', { name: 'Assigned Facilities' }).click();

      await expect(page.getByRole('heading', { name: 'Assigned facilities' })).toBeVisible({
        timeout: 10000,
      });
      await page
        .getByRole('button', { name: /^edit$/i })
        .first()
        .click();

      // PROF-003: the facility name is the first field on the form.
      await expect(page.getByLabel('Facility name')).toBeVisible();
      await expect(page.getByRole('button', { name: /^save$/i })).toBeVisible();
      // A supervisor never reassigns their facility, so no supervisor field.
      await expect(page.getByLabel(/supervisor/i)).toHaveCount(0);
    } finally {
      await cleanup(seeded);
    }
  });
});
