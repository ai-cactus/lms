/**
 * E2E spec: multi-facility v3 increment 2 — the Global (all-facilities)
 * dashboard and its facility-scoped drill-down.
 *
 * Acceptance criteria:
 *   - An org-wide role (owner) with 2+ facilities lands on the Global View
 *     ("Here is an overview across all your facilities"), can click "View
 *     dashboard" for one facility to reach its scoped dashboard (breadcrumb
 *     shows the facility name, copy reads "overview of your facility"), and
 *     the FacilityScopeSwitcher's "All Facilities" option returns to Global.
 *   - A tampered `?facility=<foreign-id>` (belonging to another org, or
 *     simply nonexistent) silently falls back to the Global View rather than
 *     leaking whether that facility exists or erroring.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005.
 *   - DATABASE_URL reachable for direct DB seeding.
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
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@facility-dash-e2e.invalid`;
}

/** Seed an org with an owner and TWO facilities — the minimum for a Global View. */
async function seedOrgWithTwoFacilities(): Promise<Seeded> {
  const client = await db();
  try {
    const ownerEmail = uid('owner');
    const ownerPassword = 'FacDash!Owner9';
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const slug = `facility-dash-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const ownerOrgUserId = crypto.randomUUID();
    const facilityAId = crypto.randomUUID();
    const facilityBId = crypto.randomUUID();
    const facilityAName = `Alpha Site ${slug}`;
    const facilityBName = `Beta Site ${slug}`;

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Facility Dash E2E ${slug}`, slug, ownerEmail],
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
      [ownerId, ownerEmail, ownerHashed, 'Facility', 'Owner', 'Facility Owner'],
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
    };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM organization_user_facilities WHERE organization_user_id = $1`, [
      seeded.ownerOrgUserId,
    ]);
    await client.query(`DELETE FROM organization_users WHERE id = $1`, [seeded.ownerOrgUserId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.ownerId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityAId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityBId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

async function login(page: Page, email: string, password: string): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  // Pre-dismiss the "create your first course" empty-state modal — its overlay
  // would otherwise intercept clicks on the dashboard content.
  await page.addInitScript(() => {
    window.localStorage.setItem('modal_dismissed_dashboardEmptyState', 'forever');
  });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 15000 });
}

test.describe('Global (multi-facility) dashboard', () => {
  test('owner with 2 facilities lands on the Global View, drills into a facility, and the switcher returns to All Facilities', async ({
    page,
  }) => {
    const seeded = await seedOrgWithTwoFacilities();
    try {
      await login(page, seeded.ownerEmail, seeded.ownerPassword);

      // Global View landing state. Both the Priority Risks and Facilities
      // Overview tables render a row per facility, so scope to the Facilities
      // Overview section before addressing a facility's row.
      await expect(page.getByText('Here is an overview across all your facilities')).toBeVisible();
      await expect(page.getByLabel('Facility scope')).toBeVisible();
      const overviewSection = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Facilities Overview' }) });
      await expect(overviewSection.getByRole('row', { name: seeded.facilityAName })).toBeVisible();
      await expect(overviewSection.getByRole('row', { name: seeded.facilityBName })).toBeVisible();

      // Drill into facility A: the row itself is the navigation affordance.
      await overviewSection.getByRole('row', { name: seeded.facilityAName }).click();
      await page.waitForURL(`**/dashboard?facility=${seeded.facilityAId}`);

      await expect(page.getByText('Here is an overview of your facility')).toBeVisible();
      // Breadcrumb shows the scoped facility's name (the switcher's <select>
      // value also renders that name, so scope past it with .first()).
      await expect(page.getByText(seeded.facilityAName).first()).toBeVisible();

      // The switcher on the scoped view is set to facility A.
      const switcher = page.getByLabel('Facility scope');
      await expect(switcher).toContainText(seeded.facilityAName);

      // Clearing the selection in the scope palette returns to the Global View.
      // The "All facilities" chip applies immediately and closes the palette
      // (FacilityScopePalette.tsx's applyAllFacilities) — there is no separate
      // confirmation step once it's clicked.
      await switcher.click();
      await page.getByRole('button', { name: 'All facilities' }).click();
      await page.waitForURL('**/dashboard');
      await expect(page.getByText('Here is an overview across all your facilities')).toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });

  test('a tampered ?facility= id (foreign/nonexistent) falls back to the Global View, not an error', async ({
    page,
  }) => {
    const seeded = await seedOrgWithTwoFacilities();
    try {
      await login(page, seeded.ownerEmail, seeded.ownerPassword);

      await page.goto(`/dashboard?facility=${crypto.randomUUID()}`);
      await page.waitForLoadState('networkidle');

      await expect(page.getByText('Here is an overview across all your facilities')).toBeVisible();
      await expect(page.getByText(/error|forbidden|not found/i)).not.toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });
});
