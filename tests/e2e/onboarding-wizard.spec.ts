/**
 * E2E spec: the 5-step onboarding wizard (Phase A rewrite).
 *
 * Acceptance criteria:
 *   - A freshly-authenticated owner with no organization can walk step1..step5
 *     and land on /onboarding/complete.
 *   - Step1: legal name, staff count, contact fields, phone, and country (US,
 *     defaulted) are required; street/zip/city/state are optional and left
 *     blank here.
 *   - Step3: a primary business type + at least one additional business type
 *     (via the "Additional Business Type" popover-checkbox list) are required.
 *   - Step4 "Invite your managers": a single manager row (email + role) is
 *     filled in; submitting creates a pending `Invite` row with that role.
 *   - Step5: "Skip for now" still calls completeOnboarding (workerEmails: []),
 *     completing the organization/facility creation without any worker invites.
 *   - After completion: an Organization + Facility row exist for the legal
 *     name entered, the founding user is linked as 'owner' with a facilityId,
 *     and exactly one pending Invite exists (the step4 manager row).
 *
 * Notes on selectors: none of the onboarding step pages set `data-testid`.
 * Every dropdown is a Radix/shadcn `Select`, and the shared `Field` wrapper's
 * `id` clone does NOT reach the Select's real trigger DOM node (Radix
 * `Select.Root` doesn't render an element, so the `htmlFor`/`id` pairing is
 * inert) — `getByLabel()` does not resolve these triggers. Selectors below
 * target comboboxes positionally (DOM order) or by their visible placeholder/
 * option text instead. See onboarding step1-5 source for the authoritative
 * field order if this spec needs updating.
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

interface SeededOwner {
  userId: string;
  email: string;
  password: string;
}

/** Seed a verified 'owner' with NO organization/facility — mirrors a freshly
 * signed-up founder about to complete onboarding. */
async function seedUnboardedOwner(): Promise<SeededOwner> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const email = `onb-owner-${crypto.randomBytes(4).toString('hex')}@onb-e2e.invalid`;
    const password = 'Onb0ard!ngP99x';
    const hashed = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();

    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, NOW(), NOW())`,
      [userId, email, hashed],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, email, 'Onb', 'Owner', 'Onb Owner'],
    );
    return { userId, email, password };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: SeededOwner, orgName: string): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const org = await client.query(`SELECT id FROM organizations WHERE name = $1`, [orgName]);
    const orgId: string | undefined = org.rows[0]?.id;

    if (orgId) {
      await client.query(
        `DELETE FROM invites WHERE organization_id = $1`,
        [orgId],
      );
      await client.query(
        `DELETE FROM facility_documents WHERE facility_id IN (SELECT id FROM facilities WHERE organization_id = $1)`,
        [orgId],
      );
    }
    await client.query(`DELETE FROM profiles WHERE id = $1`, [seeded.userId]);
    await client.query(`UPDATE users SET organization_id = NULL, facility_id = NULL WHERE id = $1`, [
      seeded.userId,
    ]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.userId]);
    if (orgId) {
      await client.query(`DELETE FROM facilities WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
  } finally {
    await client.end();
  }
}

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  // Unique source IP per test so the in-memory login rate-limit bucket doesn't
  // accumulate across runs against a reused dev server.
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  // Generous timeout: against a dev server (Turbopack), the FIRST hit to a
  // given route/server-action across all parallel workers pays an on-demand
  // compile cost that can exceed several seconds under worker contention —
  // this is dev-only overhead (production is pre-compiled), not app latency.
  await page.waitForURL('**/dashboard**', { timeout: 45000 });
}

test.describe('Onboarding wizard — 5-step happy path', () => {
  test('owner completes step1..step5 (manager invite + worker skip) and lands on /onboarding/complete', async ({
    page,
  }) => {
    // 5 sequential page transitions against a dev server, each potentially
    // paying a cold Turbopack compile cost the first time — see the login()
    // helper's comment. Longer than the 60s default to absorb that safely.
    test.setTimeout(120_000);
    const seeded = await seedUnboardedOwner();
    const orgName = `Onb Wizard Co ${crypto.randomBytes(4).toString('hex')}`;
    const managerEmail = `mgr-${crypto.randomBytes(4).toString('hex')}@onb-e2e.invalid`;

    try {
      await login(page, seeded.email, seeded.password);
      await page.goto('/onboarding/step1');
      await page.waitForLoadState('networkidle');

      // ── Step 1 ──────────────────────────────────────────────────────────────
      await page.getByPlaceholder('e.g. Acme Healthcare Ltd').fill(orgName);
      await page.getByPlaceholder('Enter business name (if applicable)').fill('Onb Wizard DBA');
      await page.getByPlaceholder("Enter the full name of the main contact").fill('Jane Founder');
      await page
        .getByPlaceholder('Enter the email address of the main contact')
        .fill(seeded.email);

      // "Number of Staff" is the first combobox on this page (Country defaults
      // to "United States" already selected; State/Country/Staff are the only
      // other Selects and neither needs interaction here).
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: '1-10' }).click();

      // Phone: real <input type="tel">, not label-linked (plain <label>).
      await page.locator('input[type="tel"]').fill('5551234567');

      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step2**', { timeout: 25000 });

      // ── Step 2 ──────────────────────────────────────────────────────────────
      // Only one combobox on this page (HIPAA compliance). Uploads are optional
      // — skipped here to keep the flow deterministic and file-fixture-free.
      await page.getByRole('combobox').click();
      await page.getByRole('option', { name: /^yes$/i }).click();

      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step3**', { timeout: 25000 });

      // ── Step 3 ──────────────────────────────────────────────────────────────
      // Primary Business Type first — once chosen, its trigger no longer shows
      // "Select an option", leaving only the Additional Business Type popover
      // button with that text (avoids an ambiguous match between the two).
      await page.getByRole('combobox').click();
      await page.getByRole('option', { name: 'Clinic' }).click();

      await page.getByRole('button', { name: 'Select an option' }).click();
      await page.getByRole('checkbox', { name: /school-.*campus-based program/i }).click();
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step4**', { timeout: 25000 });

      // ── Step 4 — Invite your managers ────────────────────────────────────────
      // Fill the first (of 3 default empty) rows: email + role.
      await page.getByPlaceholder("Enter manager's email").first().fill(managerEmail);
      await page.getByRole('combobox').first().click();
      // Step-4 options render display name + description in one accessible
      // name ("HR Manage staff, …"), so match on the leading word only.
      await page.getByRole('option', { name: /^hr\b/i }).click();

      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step5**', { timeout: 25000 });

      // ── Step 5 — Skip worker invites ─────────────────────────────────────────
      await page.getByRole('button', { name: /skip for now/i }).click();

      // completeOnboarding runs, then redirects to /onboarding/complete.
      await page.waitForURL('**/onboarding/complete**', { timeout: 30000 });
      await expect(page.getByText(/all set/i)).toBeVisible();
    } finally {
      await cleanup(seeded, orgName);
    }
  });

  test('completed onboarding creates the Organization/Facility/owner-link/manager-invite DB rows', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const seeded = await seedUnboardedOwner();
    const orgName = `Onb DB Assert Co ${crypto.randomBytes(4).toString('hex')}`;
    const managerEmail = `mgr-db-${crypto.randomBytes(4).toString('hex')}@onb-e2e.invalid`;

    try {
      await login(page, seeded.email, seeded.password);
      await page.goto('/onboarding/step1');
      await page.waitForLoadState('networkidle');

      await page.getByPlaceholder('e.g. Acme Healthcare Ltd').fill(orgName);
      await page.getByPlaceholder('Enter business name (if applicable)').fill('DB Assert DBA');
      await page.getByPlaceholder("Enter the full name of the main contact").fill('Jane Founder');
      await page
        .getByPlaceholder('Enter the email address of the main contact')
        .fill(seeded.email);
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: '11-49' }).click();
      await page.locator('input[type="tel"]').fill('5559876543');
      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step2**', { timeout: 25000 });

      await page.getByRole('combobox').click();
      await page.getByRole('option', { name: /^yes$/i }).click();
      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step3**', { timeout: 25000 });

      await page.getByRole('combobox').click();
      await page.getByRole('option', { name: 'Group Practice' }).click();
      await page.getByRole('button', { name: 'Select an option' }).click();
      await page.getByRole('checkbox', { name: /school-.*campus-based program/i }).click();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step4**', { timeout: 25000 });

      await page.getByPlaceholder("Enter manager's email").first().fill(managerEmail);
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: /clinical director/i }).click();
      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step5**', { timeout: 25000 });

      await page.getByRole('button', { name: /skip for now/i }).click();
      await page.waitForURL('**/onboarding/complete**', { timeout: 30000 });

      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const orgRes = await client.query(
          `SELECT id, name FROM organizations WHERE name = $1`,
          [orgName],
        );
        expect(orgRes.rows).toHaveLength(1);
        const orgId = orgRes.rows[0].id as string;

        const facilityRes = await client.query(
          `SELECT id, name FROM facilities WHERE organization_id = $1`,
          [orgId],
        );
        expect(facilityRes.rows).toHaveLength(1);

        const ownerRes = await client.query(
          `SELECT role, organization_id, facility_id FROM users WHERE id = $1`,
          [seeded.userId],
        );
        expect(ownerRes.rows[0]).toMatchObject({
          role: 'owner',
          organization_id: orgId,
          facility_id: facilityRes.rows[0].id,
        });

        const inviteRes = await client.query(
          `SELECT email, role, status FROM invites WHERE organization_id = $1`,
          [orgId],
        );
        expect(inviteRes.rows).toHaveLength(1);
        expect(inviteRes.rows[0]).toMatchObject({
          email: managerEmail,
          role: 'clinical_director',
          status: 'pending',
        });
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded, orgName);
    }
  });
});
