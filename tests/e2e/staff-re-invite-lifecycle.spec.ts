/**
 * E2E spec: removed-user re-invite lifecycle (Phase 3 re-invite lifecycle gap).
 *
 * Previously, once a staff member was removed (`organizationId` nulled),
 * their account could never be invited again — `createInvites` treated any
 * existing user row as "already has an account" regardless of org, and the
 * accept route rejected every existing account outright. The approved fix:
 * an org-less account (removed user) is now re-invited like a fresh address
 * and relinked on accept — the emailed token proves control of the address,
 * the same trust model as a password-reset link.
 *
 * This spec drives the full lifecycle live:
 *   1. Owner removes an active HR staffer via the Staff page UI (mirrors
 *      tests/e2e/rbac-removed-staff-login.spec.ts's removal flow).
 *   2. Owner re-invites the SAME email address, this time as `supervisor`
 *      (proves the role can change on rejoin, not just re-use the old one).
 *   3. The invite token is fetched directly from the DB (this repo has no
 *      MailHog-based email-retrieval helper for e2e — see the email-fetch
 *      gap noted below) and used to drive the real /join/[token] page.
 *   4. The former staffer logs in with their NEW password and lands back in
 *      the SAME org with the NEW role.
 *
 * Gap note: fetching the invite link via a real inbox (MailHog HTTP API) was
 * considered, but every other invite-flow spec in this repo (staff-invite-
 * flow.spec.ts) already asserts the DB-persisted invite row directly rather
 * than parsing the email body — the email SEND itself is covered by
 * src/app/actions/invite.test.ts's sendInviteEmail assertions. Reading the
 * token straight from `invites.token` drives the identical `/join/[token]`
 * page a real inbox link would, without adding a redundant email-parsing
 * dependency to this journey.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - DATABASE_URL reachable for direct DB seeding/mutation.
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
  facilityId: string;
  ownerId: string;
  ownerEmail: string;
  ownerPassword: string;
  staffId: string;
  staffEmail: string;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@re-invite-e2e.invalid`;
}

async function seedOrgWithOwnerAndHrStaffer(): Promise<Seeded> {
  const client = await db();
  try {
    const ownerEmail = uid('owner');
    const ownerPassword = 'ReInvOwner!9';
    const staffEmail = uid('hr-staffer');
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const staffHashed = await bcrypt.hash('OriginalPass!9', 10);
    const slug = `re-invite-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const staffId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Re-Invite E2E ${slug}`, slug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Re-Invite E2E Facility ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, $4, $5, NOW(), NOW())`,
      [ownerId, ownerEmail, ownerHashed, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'hr'::"UserRole", true, $4, $5, NOW(), NOW())`,
      [staffId, staffEmail, staffHashed, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, 'Owner', 'ReInvite', 'Owner ReInvite', NOW(), NOW())`,
      [ownerId, ownerEmail],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, 'Original', 'Staffer', 'Original Staffer', NOW(), NOW())`,
      [staffId, staffEmail],
    );

    return { orgId, facilityId, ownerId, ownerEmail, ownerPassword, staffId, staffEmail };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM invites WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM profiles WHERE id IN ($1, $2)`, [
      seeded.ownerId,
      seeded.staffId,
    ]);
    await client.query(`DELETE FROM users WHERE id IN ($1, $2)`, [seeded.ownerId, seeded.staffId]);
    await client.query(`DELETE FROM users WHERE email = $1`, [seeded.staffEmail]);
    await client.query(`DELETE FROM facilities WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

test.describe('Removed-user re-invite lifecycle', () => {
  test('remove a staffer, re-invite the same email with a new role, and they rejoin via the join link', async ({
    page,
  }) => {
    // Generous timeout: this journey chains two logins, a staff removal, a
    // full 2-step invite modal, a /join/[token] accept, and a third login —
    // each the first hit of its route/server-action against the dev server
    // pays an on-demand compile cost (see staff-invite-flow.spec.ts's note).
    test.setTimeout(180_000);
    const seeded = await seedOrgWithOwnerAndHrStaffer();
    const newPassword = 'BrandNewPass!99';

    try {
      // ── Step 1: owner removes the HR staffer via the Staff page UI ──────────
      await loginAs(page, seeded.ownerEmail, seeded.ownerPassword);
      await page.waitForURL('**/dashboard', { timeout: 45000 });

      await page.goto('/dashboard/staff');
      await page.waitForLoadState('networkidle');
      await page.getByPlaceholder('Search for staff...').fill(seeded.staffEmail);

      await page.getByRole('button', { name: 'Row actions' }).click();
      await page.getByRole('menuitem', { name: 'Remove Staff' }).click();
      const removeDialog = page.getByRole('dialog');
      await expect(removeDialog.getByText('Remove Staff Member')).toBeVisible();
      await removeDialog.getByRole('button', { name: 'Remove Staff' }).click();
      await expect(removeDialog).toBeHidden({ timeout: 10000 });

      // DB-level confirmation: the account is now org-less (removed), not deleted.
      const dbAfterRemoval = await db();
      try {
        const res = await dbAfterRemoval.query(
          `SELECT organization_id FROM users WHERE id = $1`,
          [seeded.staffId],
        );
        expect(res.rows[0].organization_id).toBeNull();
      } finally {
        await dbAfterRemoval.end();
      }

      // ── Step 2: owner re-invites the SAME email, now as supervisor ──────────
      await page.goto('/dashboard/staff');
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: /add workers?/i }).first().click();
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
      await expect(page.getByText('Invite New Staffs')).toBeVisible();
      await page.getByPlaceholder(/enter emails separated by/i).fill(seeded.staffEmail);
      await page.getByRole('button', { name: /^continue$/i }).click();

      await expect(page.getByText('Assign roles')).toBeVisible();
      await expect(page.getByText(seeded.staffEmail)).toBeVisible();
      await page.getByRole('combobox').nth(1).click();
      // Role options render the full RBAC displayName ("Supervisor (Facility
      // Admin)"), not the bare role key — match on the leading word only.
      await page.getByRole('option', { name: /^supervisor\b/i }).click();
      await page.getByRole('button', { name: /^continue$/i }).click();

      await expect(page.getByText('Invite sent')).toBeVisible({ timeout: 10000 });
      await page.getByRole('button', { name: /^done$/i }).click();

      // Confirm this re-invite created a fresh, pending invite for this org and
      // role — the regression this guards is that createInvites used to skip
      // this email entirely as "already has an account".
      const dbClient = await db();
      let token: string;
      try {
        const res = await dbClient.query(
          `SELECT token, role, status FROM invites WHERE email = $1 AND organization_id = $2 ORDER BY created_at DESC LIMIT 1`,
          [seeded.staffEmail, seeded.orgId],
        );
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0]).toMatchObject({ role: 'supervisor', status: 'pending' });
        token = res.rows[0].token;
      } finally {
        await dbClient.end();
      }

      // ── Step 3 + 4: accept the invite via the real /join/[token] page ───────
      const joinContext = await page.context().browser()!.newContext();
      const joinPage = await joinContext.newPage();
      try {
        await joinPage.goto(`/join/${token}`);
        await expect(joinPage.getByText(/you've been invited to join/i)).toBeVisible({
          timeout: 15000,
        });
        // The invite banner shows the NEW role, not the old HR role.
        await expect(joinPage.getByText(/supervisor/i).first()).toBeVisible();

        await joinPage.getByPlaceholder('Enter your first name').fill('Rejoined');
        await joinPage.getByPlaceholder('Enter your last name').fill('Staffer');
        // Placeholder is "Password (at least N characters)" (capital P) — the
        // regex must be case-insensitive or the locator matches nothing and
        // .fill() hangs waiting for an element that will never appear.
        await joinPage.getByPlaceholder(/^password \(at least/i).first().fill(newPassword);
        await joinPage
          .getByPlaceholder(/^password \(at least/i)
          .nth(1)
          .fill(newPassword);
        await joinPage.getByRole('checkbox').check();
        await joinPage.getByRole('button', { name: /create account|join|sign up/i }).click();

        await joinPage.waitForURL('**/login**', { timeout: 20000 });
      } finally {
        await joinContext.close();
      }

      // DB-level confirmation of the relink: SAME user id, back in the SAME
      // org, with the NEW role and a working new password.
      const dbAfterAccept = await db();
      try {
        const res = await dbAfterAccept.query(
          `SELECT id, organization_id, role, email_verified FROM users WHERE email = $1`,
          [seeded.staffEmail],
        );
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0].id).toBe(seeded.staffId);
        expect(res.rows[0].organization_id).toBe(seeded.orgId);
        expect(res.rows[0].role).toBe('supervisor');
        expect(res.rows[0].email_verified).toBe(true);
      } finally {
        await dbAfterAccept.end();
      }

      // Live confirmation: the rejoined account can log in with the NEW
      // password and lands in the org's dashboard (not blocked as a stranger).
      const rejoinedContext = await page.context().browser()!.newContext();
      const rejoinedPage = await rejoinedContext.newPage();
      try {
        await loginAs(rejoinedPage, seeded.staffEmail, newPassword);
        await rejoinedPage.waitForURL('**/dashboard**', { timeout: 45000 });
        expect(rejoinedPage.url()).toContain('/dashboard');
      } finally {
        await rejoinedContext.close();
      }
    } finally {
      await cleanup(seeded);
    }
  });
});
