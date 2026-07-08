/**
 * E2E spec: Staff invite — full 2-step submit flow (Phase B rewrite).
 *
 * `InviteStaffModal` was rewritten from a single-step form into a 2-step flow:
 *   1. "Invite New Staffs" — paste/type emails (or CSV import), Continue.
 *   2. "Assign roles" — per-contact Radix `Select` role picker (or the "Set
 *      every role to" bulk selector), Continue submits via `createInvites`.
 *   3. "Invite sent" success screen, then Done closes the modal.
 *
 * This is the one path this project's jsdom component tests cannot exercise
 * (Radix `Select` needs `hasPointerCapture`/`scrollIntoView`, which aren't
 * polyfilled here — see InviteStaffModal.test.tsx) so it is covered live here
 * instead. tests/e2e/rbac-invite-roles.spec.ts covers the per-inviter grant
 * matrix shown in the role dropdown; this spec covers the actual submit →
 * success → pending-row-appears journey.
 *
 * Acceptance criteria:
 *   - Typing a valid email and clicking Continue reaches the Assign-roles step.
 *   - Assigning a role (per-contact Select) and clicking Continue creates the
 *     invite and shows the "Invite sent" success screen.
 *   - After closing the modal, the invited email appears in the staff table
 *     with a "Pending" badge (proves `router.refresh()` + the server list
 *     actually picked up the new invite, not just client-side modal state).
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005.
 *   - DATABASE_URL reachable for seeding.
 */

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

interface Seeded {
  userId: string;
  orgId: string;
  facilityId: string;
  email: string;
  password: string;
}

async function seedOwner(): Promise<Seeded> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const email = `inviter-${crypto.randomBytes(4).toString('hex')}@staff-invite-e2e.invalid`;
    const password = 'Own3r!Flow99';
    const hashed = await bcrypt.hash(password, 10);
    const slug = `staff-invite-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Staff Invite Flow ${slug}`, slug, email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Staff Invite Flow ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, $4, $5, NOW(), NOW())`,
      [userId, email, hashed, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, email, 'Inviter', 'Owner', 'Inviter Owner'],
    );
    return { userId, orgId, facilityId, email, password };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded, inviteeEmail: string): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM invites WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM users WHERE email = $1`, [inviteeEmail]);
    await client.query(`DELETE FROM profiles WHERE id = $1`, [seeded.userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.userId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

async function login(page: import('@playwright/test').Page, email: string, password: string) {
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

test.describe('Staff invite — 2-step modal, submit to success', () => {
  test('paste an email, assign a role, submit, and see the pending row appear', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seeded = await seedOwner();
    const inviteeEmail = `new-nurse-${crypto.randomBytes(4).toString('hex')}@staff-invite-e2e.invalid`;

    try {
      await login(page, seeded.email, seeded.password);
      await page.goto('/dashboard/staff');
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: /add workers?/i }).first().click();
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

      // Step 1 — email entry.
      await expect(page.getByText('Invite New Staffs')).toBeVisible();
      await page.getByPlaceholder(/enter emails separated by/i).fill(inviteeEmail);
      await expect(page.getByRole('button', { name: /^continue$/i })).toBeEnabled();
      await page.getByRole('button', { name: /^continue$/i }).click();

      // Step 2 — assign a role to the single parsed contact.
      await expect(page.getByText('Assign roles')).toBeVisible();
      await expect(page.getByText(inviteeEmail)).toBeVisible();

      // Per-contact role Select is the SECOND combobox on this step (the first
      // is the "Set every role to" bulk selector).
      await page.getByRole('combobox').nth(1).click();
      await page.getByRole('option', { name: /^nurse$/i }).click();

      const continueBtn = page.getByRole('button', { name: /^continue$/i });
      await expect(continueBtn).toBeEnabled();
      await continueBtn.click();

      // Step 3 — success screen.
      await expect(page.getByText('Invite sent')).toBeVisible({ timeout: 10000 });
      await page.getByRole('button', { name: /^done$/i }).click();

      // Modal closes; the staff table (refreshed via router.refresh()) now
      // shows the invitee with a "Pending" badge.
      await page.waitForLoadState('networkidle');
      const row = page.getByRole('row', { name: new RegExp(inviteeEmail) });
      await expect(row).toBeVisible({ timeout: 10000 });
      // Exact match — the row also contains an unrelated "Pending Invite" string
      // in the Date-Invited column, which a substring match would also hit.
      await expect(row.getByText('Pending', { exact: true })).toBeVisible();

      // DB-level confirmation of the created invite's role.
      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const res = await client.query(
          `SELECT role, status FROM invites WHERE email = $1 AND organization_id = $2`,
          [inviteeEmail, seeded.orgId],
        );
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0]).toMatchObject({ role: 'nurse', status: 'pending' });
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded, inviteeEmail);
    }
  });

  test('the "Set every role to" bulk selector assigns the same role to every contact', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seeded = await seedOwner();
    const emailA = `bulk-a-${crypto.randomBytes(4).toString('hex')}@staff-invite-e2e.invalid`;
    const emailB = `bulk-b-${crypto.randomBytes(4).toString('hex')}@staff-invite-e2e.invalid`;

    try {
      await login(page, seeded.email, seeded.password);
      await page.goto('/dashboard/staff');
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: /add workers?/i }).first().click();
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

      await page.getByPlaceholder(/enter emails separated by/i).fill(`${emailA}, ${emailB}`);
      await page.getByRole('button', { name: /^continue$/i }).click();

      // Assert both contacts reached the Assign-roles step structurally (each
      // contact row has a `Remove ${email}` button), rather than via the
      // subtitle copy — "N contacts found. Assign a role to each…" currently
      // renders as "N contactsfound." with NO space, because the JSX text
      // node spans a line break right after the pluralization expression and
      // Babel's per-line whitespace trim eats the leading space of " found.".
      // See src/components/dashboard/staff/InviteStaffModal.tsx line ~433.
      // Reported as a product bug (cosmetic) — not fixed here.
      await expect(page.getByText('Assign roles')).toBeVisible();
      await expect(page.getByRole('button', { name: `Remove ${emailA}` })).toBeVisible();
      await expect(page.getByRole('button', { name: `Remove ${emailB}` })).toBeVisible();

      // Bulk selector is the first combobox on the Assign-roles step.
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: /case manager/i }).click();

      await page.getByRole('button', { name: /^continue$/i }).click();
      await expect(page.getByText('Invite sent')).toBeVisible({ timeout: 10000 });
      await page.getByRole('button', { name: /^done$/i }).click();

      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const res = await client.query(
          `SELECT email, role FROM invites WHERE email = ANY($1) AND organization_id = $2 ORDER BY email`,
          [[emailA, emailB], seeded.orgId],
        );
        expect(res.rows).toHaveLength(2);
        for (const row of res.rows) {
          expect(row.role).toBe('case_manager');
        }
      } finally {
        await client.end();
      }
    } finally {
      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        await client.query(`DELETE FROM invites WHERE organization_id = $1`, [seeded.orgId]);
        await client.query(`DELETE FROM profiles WHERE id = $1`, [seeded.userId]);
        await client.query(`DELETE FROM users WHERE id = $1`, [seeded.userId]);
        await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
        await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
      } finally {
        await client.end();
      }
    }
  });

  test('the "Assign roles" contact-count subtitle renders with correct spacing', async ({
    page,
  }) => {
    // Regression guard: the subtitle's multi-line JSX text node once rendered
    // as "2 contactsfound." (the line break after the pluralization expression
    // swallowed the space). The copy now lives in a single template literal.
    test.setTimeout(90_000);
    const seeded = await seedOwner();
    const email = `known-bug-${crypto.randomBytes(4).toString('hex')}@staff-invite-e2e.invalid`;

    try {
      await login(page, seeded.email, seeded.password);
      await page.goto('/dashboard/staff');
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: /add workers?/i }).first().click();
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
      await page.getByPlaceholder(/enter emails separated by/i).fill(email);
      await page.getByRole('button', { name: /^continue$/i }).click();

      await expect(page.getByText(/1 contact found\./i)).toBeVisible();
    } finally {
      await cleanup(seeded, email);
    }
  });
});
