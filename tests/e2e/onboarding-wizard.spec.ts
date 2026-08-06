/**
 * E2E spec: the 5-step onboarding wizard (Phase A rewrite).
 *
 * Acceptance criteria:
 *   - A freshly-authenticated owner with no organization can walk step1..step5
 *     and land on /onboarding/complete.
 *   - Step1: legal name, staff count, contact fields, phone, and country (US,
 *     defaulted) are required; street/zip/city/state are optional and left
 *     blank here.
 *   - Step3 (Figma redesign): a primary business type (shadcn Select, 9 options)
 *     + at least one additional business type (inline 2-col checkbox grid, 8
 *     options incl. an "Other (specify)" toggle-button row) are required.
 *     Program Services is the same inline-grid shape but optional. Choosing
 *     "Other" on any of the three sections reveals a required text input.
 *   - Step4 "Invite your managers": renders exactly ONE empty row on load. A
 *     single manager row (email + role) is filled in; submitting creates a
 *     pending `Invite` row with that role.
 *   - Step5 "Invite your Workers/Staffs": renders exactly ONE empty row on
 *     load, using the same per-row email + role interface as step4 (the eight
 *     WORKER_ROLES). A row with an email but no role blocks submit with a
 *     'Select a role' error and does not advance. Filling email + role and
 *     submitting creates a pending `Invite` row with that worker role.
 *     "Skip for now" still calls completeOnboarding with no worker invites,
 *     completing the organization/facility creation regardless.
 *   - After completion: an Organization + Facility row exist for the legal
 *     name entered, the founding user is linked as 'owner' with a facilityId,
 *     and the expected pending Invite row(s) exist.
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
 * Real Playwright `.click()` on a Select trigger/option commits reliably —
 * confirmed throughout this file (staff-count, HIPAA, role selects). This
 * differs from a qa-mafia run that could only commit via keyboard through a
 * separate (non-Playwright) browser-automation channel; see
 * qa-reports/auth-rbac-staging.md:119 for that reclassified "not a bug" note.
 * Step 3's Primary Business Type is the ONLY combobox on that page — the old
 * Additional Business Type popover-Select is gone, replaced by an inline
 * checkbox grid, so `getByRole('combobox')` is unambiguous there now.
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
      await client.query(`DELETE FROM invites WHERE organization_id = $1`, [orgId]);
      await client.query(
        `DELETE FROM facility_documents WHERE facility_id IN (SELECT id FROM facilities WHERE organization_id = $1)`,
        [orgId],
      );
    }
    await client.query(`DELETE FROM profiles WHERE id = $1`, [seeded.userId]);
    await client.query(
      `UPDATE users SET organization_id = NULL, facility_id = NULL WHERE id = $1`,
      [seeded.userId],
    );
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
  test('owner completes step1..step5 (manager invite + worker invite) and lands on /onboarding/complete', async ({
    page,
  }) => {
    // 5 sequential page transitions against a dev server, each potentially
    // paying a cold Turbopack compile cost the first time — see the login()
    // helper's comment. Longer than the 60s default to absorb that safely.
    test.setTimeout(120_000);
    const seeded = await seedUnboardedOwner();
    const orgName = `Onb Wizard Co ${crypto.randomBytes(4).toString('hex')}`;
    const managerEmail = `mgr-${crypto.randomBytes(4).toString('hex')}@onb-e2e.invalid`;
    const workerEmail = `worker-${crypto.randomBytes(4).toString('hex')}@onb-e2e.invalid`;

    try {
      await login(page, seeded.email, seeded.password);
      await page.goto('/onboarding/step1');
      await page.waitForLoadState('networkidle');

      // ── Step 1 ──────────────────────────────────────────────────────────────
      await page.getByPlaceholder('e.g. Acme Healthcare Ltd').fill(orgName);
      await page.getByPlaceholder('Enter business name (if applicable)').fill('Onb Wizard DBA');
      await page.getByPlaceholder('Enter the full name of the main contact').fill('Jane Founder');
      await page.getByPlaceholder('Enter the email address of the main contact').fill(seeded.email);

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
      // Primary Business Type — the only combobox on this page since the
      // redesign replaced the Additional Business Type popover-Select with an
      // inline checkbox grid.
      await page.getByRole('combobox').click();
      await page.getByRole('option', { name: /private practice/i }).click();

      await page.getByRole('checkbox', { name: 'Outpatient Services' }).click();

      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step4**', { timeout: 25000 });

      // ── Step 4 — Invite your managers ────────────────────────────────────────
      // Renders exactly one empty row on load (was three rows pre-redesign).
      await expect(page.getByPlaceholder("Enter manager's email")).toHaveCount(1);

      await page.getByPlaceholder("Enter manager's email").first().fill(managerEmail);
      await page.getByRole('combobox').first().click();
      // Step-4 options render display name + description in one accessible
      // name ("HR Manage staff, …"), so match on the leading word only.
      await page.getByRole('option', { name: /^hr\b/i }).click();

      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step5**', { timeout: 25000 });

      // ── Step 5 — Invite your Workers/Staffs ──────────────────────────────────
      // Rebuilt from the old TagInput UI onto the same per-row email + role
      // interface as step4; renders exactly one empty row on load.
      await expect(page.getByPlaceholder("Enter worker's email")).toHaveCount(1);

      await page.getByPlaceholder("Enter worker's email").first().fill(workerEmail);
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: /^nurse$/i }).click();

      await page.getByRole('button', { name: /^next$/i }).click();

      // completeOnboarding runs, then redirects to /onboarding/complete.
      await page.waitForURL('**/onboarding/complete**', { timeout: 30000 });
      await expect(page.getByText(/all set/i)).toBeVisible();
    } finally {
      await cleanup(seeded, orgName);
    }
  });

  test('completed onboarding creates the Organization/Facility/owner-link/invite DB rows with the selected roles', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const seeded = await seedUnboardedOwner();
    const orgName = `Onb DB Assert Co ${crypto.randomBytes(4).toString('hex')}`;
    const managerEmail = `mgr-db-${crypto.randomBytes(4).toString('hex')}@onb-e2e.invalid`;
    const workerEmail = `worker-db-${crypto.randomBytes(4).toString('hex')}@onb-e2e.invalid`;

    try {
      await login(page, seeded.email, seeded.password);
      await page.goto('/onboarding/step1');
      await page.waitForLoadState('networkidle');

      await page.getByPlaceholder('e.g. Acme Healthcare Ltd').fill(orgName);
      await page.getByPlaceholder('Enter business name (if applicable)').fill('DB Assert DBA');
      await page.getByPlaceholder('Enter the full name of the main contact').fill('Jane Founder');
      await page.getByPlaceholder('Enter the email address of the main contact').fill(seeded.email);
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
      await page.getByRole('option', { name: /private practice/i }).click();
      await page.getByRole('checkbox', { name: 'Outpatient Services' }).click();
      await page.getByRole('checkbox', { name: 'Crisis Stabilization Unit' }).click();
      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step4**', { timeout: 25000 });

      await page.getByPlaceholder("Enter manager's email").first().fill(managerEmail);
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: /clinical director/i }).click();
      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step5**', { timeout: 25000 });

      await page.getByPlaceholder("Enter worker's email").first().fill(workerEmail);
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: /^nurse$/i }).click();
      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/complete**', { timeout: 30000 });

      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const orgRes = await client.query(
          `SELECT id, name, primary_business_type, additional_business_types FROM organizations WHERE name = $1`,
          [orgName],
        );
        expect(orgRes.rows).toHaveLength(1);
        const orgId = orgRes.rows[0].id as string;
        // Step 3 now persists canonical ids (was labels) — confirms the
        // stored-format change reaches the DB via completeOnboarding.
        expect(orgRes.rows[0].primary_business_type).toBe('private_group_practice');
        expect(orgRes.rows[0].additional_business_types).toEqual(
          expect.arrayContaining(['outpatient_services', 'crisis_stabilization']),
        );

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
          `SELECT email, role, status FROM invites WHERE organization_id = $1 ORDER BY email`,
          [orgId],
        );
        expect(inviteRes.rows).toHaveLength(2);
        expect(inviteRes.rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              email: managerEmail,
              role: 'clinical_director',
              status: 'pending',
            }),
            expect.objectContaining({
              email: workerEmail,
              role: 'nurse',
              status: 'pending',
            }),
          ]),
        );
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded, orgName);
    }
  });

  test('step3 "Other (Specify)" free text on primary and additional business type lands in the DB', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const seeded = await seedUnboardedOwner();
    const orgName = `Onb Other Specify Co ${crypto.randomBytes(4).toString('hex')}`;
    const primaryOtherText = `Custom Provider Org ${crypto.randomBytes(3).toString('hex')}`;
    const additionalOtherText = `Custom Additional Type ${crypto.randomBytes(3).toString('hex')}`;

    try {
      await login(page, seeded.email, seeded.password);
      await page.goto('/onboarding/step1');
      await page.waitForLoadState('networkidle');

      await page.getByPlaceholder('e.g. Acme Healthcare Ltd').fill(orgName);
      await page.getByPlaceholder('Enter business name (if applicable)').fill('Other Specify DBA');
      await page.getByPlaceholder('Enter the full name of the main contact').fill('Jane Founder');
      await page.getByPlaceholder('Enter the email address of the main contact').fill(seeded.email);
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: '1-10' }).click();
      await page.locator('input[type="tel"]').fill('5552223333');
      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step2**', { timeout: 25000 });

      await page.getByRole('combobox').click();
      await page.getByRole('option', { name: /^yes$/i }).click();
      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step3**', { timeout: 25000 });

      // Primary Business Type: "Other (Specify)" reveals a required text input.
      await page.getByRole('combobox').click();
      await page.getByRole('option', { name: /^other \(specify\)/i }).click();
      await page.getByPlaceholder('Please specify').fill(primaryOtherText);

      // Additional Business Type: the "Other (specify)" row is a toggle
      // button (not a checkbox) that reveals its own required text input.
      // Program Services renders an identical "Other (specify)" button below
      // it (unclicked here), so `.first()` disambiguates by DOM/section order.
      await page
        .getByRole('button', { name: /^other \(specify\)/i })
        .first()
        .click();
      // Two "Please specify" inputs are now visible (primary's, already
      // filled, then additional's) — DOM order matches section order.
      await page.getByPlaceholder('Please specify').nth(1).fill(additionalOtherText);

      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step4**', { timeout: 25000 });

      await page.getByRole('button', { name: /skip for now/i }).click();
      await page.waitForURL('**/onboarding/step5**', { timeout: 25000 });
      await page.getByRole('button', { name: /skip for now/i }).click();
      await page.waitForURL('**/onboarding/complete**', { timeout: 30000 });

      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const orgRes = await client.query(
          `SELECT primary_business_type, additional_business_types FROM organizations WHERE name = $1`,
          [orgName],
        );
        expect(orgRes.rows).toHaveLength(1);
        expect(orgRes.rows[0].primary_business_type).toBe(primaryOtherText);
        expect(orgRes.rows[0].additional_business_types).toEqual([additionalOtherText]);
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded, orgName);
    }
  });

  test('step3 Back-navigation from step4 rehydrates prior selections and "Other" text', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const seeded = await seedUnboardedOwner();
    const additionalOtherText = `Custom Rehab Type ${crypto.randomBytes(3).toString('hex')}`;

    try {
      await login(page, seeded.email, seeded.password);
      await page.goto('/onboarding/step1');
      await page.waitForLoadState('networkidle');

      await page.getByPlaceholder('e.g. Acme Healthcare Ltd').fill('Rehydration Regression Co');
      await page.getByPlaceholder('Enter business name (if applicable)').fill('Rehydration DBA');
      await page.getByPlaceholder('Enter the full name of the main contact').fill('Jane Founder');
      await page.getByPlaceholder('Enter the email address of the main contact').fill(seeded.email);
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: '1-10' }).click();
      await page.locator('input[type="tel"]').fill('5554445555');
      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step2**', { timeout: 25000 });

      await page.getByRole('combobox').click();
      await page.getByRole('option', { name: /^yes$/i }).click();
      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step3**', { timeout: 25000 });

      // Fill step 3: a known primary type, a known + an "other" additional
      // business type, and one program service.
      await page.getByRole('combobox').click();
      await page.getByRole('option', { name: /telehealth-only/i }).click();

      await page.getByRole('checkbox', { name: 'Detoxification / Withdrawal Management' }).click();
      // Program Services renders an identical "Other (specify)" button below
      // it (unclicked here), so `.first()` disambiguates by section order.
      await page
        .getByRole('button', { name: /^other \(specify\)/i })
        .first()
        .click();
      await page.getByPlaceholder('Please specify').fill(additionalOtherText);

      await page.getByRole('checkbox', { name: 'Vision Rehabilitation Services' }).click();

      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step4**', { timeout: 25000 });

      // Navigate back — step 3 must rehydrate from the localStorage draft
      // rather than resetting to its blank defaultValues.
      await page.getByRole('button', { name: /^back$/i }).click();
      await page.waitForURL('**/onboarding/step3**', { timeout: 25000 });

      await expect(page.getByRole('combobox')).toHaveText(/telehealth-only/i);
      await expect(
        page.getByRole('checkbox', { name: 'Detoxification / Withdrawal Management' }),
      ).toBeChecked();
      await expect(page.getByPlaceholder('Please specify')).toHaveValue(additionalOtherText);
      await expect(
        page.getByRole('checkbox', { name: 'Vision Rehabilitation Services' }),
      ).toBeChecked();
      // A checkbox that was never selected stays unchecked after rehydration.
      await expect(page.getByRole('checkbox', { name: 'Outpatient Services' })).not.toBeChecked();
    } finally {
      // The wizard is never completed in this test, but pass the typed org
      // name defensively — cleanup() no-ops if no matching row exists.
      await cleanup(seeded, 'Rehydration Regression Co');
    }
  });

  test('step5 skip-for-now still completes onboarding without creating any worker invite', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const seeded = await seedUnboardedOwner();
    const orgName = `Onb Skip Worker Co ${crypto.randomBytes(4).toString('hex')}`;

    try {
      await login(page, seeded.email, seeded.password);
      await page.goto('/onboarding/step1');
      await page.waitForLoadState('networkidle');

      await page.getByPlaceholder('e.g. Acme Healthcare Ltd').fill(orgName);
      await page.getByPlaceholder('Enter business name (if applicable)').fill('Skip Worker DBA');
      await page.getByPlaceholder('Enter the full name of the main contact').fill('Jane Founder');
      await page.getByPlaceholder('Enter the email address of the main contact').fill(seeded.email);
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: '1-10' }).click();
      await page.locator('input[type="tel"]').fill('5551110000');
      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step2**', { timeout: 25000 });

      await page.getByRole('combobox').click();
      await page.getByRole('option', { name: /^yes$/i }).click();
      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step3**', { timeout: 25000 });

      await page.getByRole('combobox').click();
      await page.getByRole('option', { name: /private practice/i }).click();
      await page.getByRole('checkbox', { name: 'Outpatient Services' }).click();
      await page.getByRole('button', { name: /^next$/i }).click();
      await page.waitForURL('**/onboarding/step4**', { timeout: 25000 });

      // Skip step4 too — this test only cares about the step5 skip path.
      await page.getByRole('button', { name: /skip for now/i }).click();
      await page.waitForURL('**/onboarding/step5**', { timeout: 25000 });

      await page.getByRole('button', { name: /skip for now/i }).click();
      await page.waitForURL('**/onboarding/complete**', { timeout: 30000 });

      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const orgRes = await client.query(`SELECT id FROM organizations WHERE name = $1`, [
          orgName,
        ]);
        expect(orgRes.rows).toHaveLength(1);
        const orgId = orgRes.rows[0].id as string;

        const inviteRes = await client.query(`SELECT id FROM invites WHERE organization_id = $1`, [
          orgId,
        ]);
        expect(inviteRes.rows).toHaveLength(0);
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded, orgName);
    }
  });

  test('step5 blocks submission when a row has an email but no role selected', async ({ page }) => {
    test.setTimeout(60_000);
    const seeded = await seedUnboardedOwner();

    try {
      await login(page, seeded.email, seeded.password);
      // step5's mount guard (THER-017) redirects to step1 unless localStorage
      // already carries step1 data — seed it here so this test can still
      // exercise step5's own role-required validation in isolation, without
      // walking the full step1..4 wizard.
      await page.goto('/dashboard');
      await page.evaluate(() => {
        localStorage.setItem(
          'onboarding_data',
          JSON.stringify({ step1: { legalName: 'No Role Validation Co' } }),
        );
      });
      await page.goto('/onboarding/step5');
      await page.waitForLoadState('networkidle');
      // The mount guard must NOT fire when step1 data is present.
      await expect(page).toHaveURL(/\/onboarding\/step5/);

      await page
        .getByPlaceholder("Enter worker's email")
        .first()
        .fill(`no-role-${crypto.randomBytes(4).toString('hex')}@onb-e2e.invalid`);

      await page.getByRole('button', { name: /^next$/i }).click();

      await expect(page.getByText(/select a role/i)).toBeVisible();
      // Blocked — never navigates away from step5.
      await expect(page).toHaveURL(/\/onboarding\/step5/);
    } finally {
      await cleanup(seeded, `__no-org-created-by-${seeded.email}__`);
    }
  });

  // ── THER-017: onboarding silent dead-end ────────────────────────────────────

  test('THER-017 regression: visiting step5 directly with no step1 data redirects to step1 instead of dead-ending', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const seeded = await seedUnboardedOwner();

    try {
      await login(page, seeded.email, seeded.password);
      // Establish the app origin, then explicitly clear localStorage — mirrors
      // a user who lost their in-progress step1..4 state (new tab, cleared
      // storage, etc.) and jumps/returns straight to the final step.
      await page.goto('/dashboard');
      await page.evaluate(() => localStorage.clear());

      await page.goto('/onboarding/step5');

      await page.waitForURL('**/onboarding/step1**', { timeout: 15000 });
      // Never silently stuck on step5, and no organization was created from
      // the incomplete/absent step1 data.
      await expect(page).not.toHaveURL(/\/onboarding\/step5/);

      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const res = await client.query(`SELECT organization_id FROM users WHERE id = $1`, [
          seeded.userId,
        ]);
        expect(res.rows[0]?.organization_id).toBeNull();
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded, `__no-org-created-by-${seeded.email}__`);
    }
  });
});
