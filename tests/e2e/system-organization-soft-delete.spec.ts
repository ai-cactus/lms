/**
 * E2E spec: organization soft delete and restore from the /system console.
 *
 * Deleting an organization removes everyone's ACCESS to it and keeps every
 * record; restoring brings back exactly the members who were active at the
 * moment of the delete. Mocked unit tests cannot see the cross-cutting promise
 * — that the login, the public invite page and the join code all treat the
 * organization as gone, and that the very same database rows come back —
 * so this drives the live app against a real Postgres.
 *
 * Covers, against the LIVE app:
 *  - /system/organizations lists the organization; the Delete modal gates its
 *    button on BOTH the exact organization name and the word DELETE.
 *  - After the delete: `organizations.deleted_at` is set, every active
 *    membership is deactivated at that SAME instant, a member who an admin had
 *    removed earlier is untouched, and the pending invite stays pending.
 *  - The member's sign-in is refused with the organization-inactive copy
 *    (not the "access removed" copy, not a generic bad-credentials error).
 *  - The pending invite link is a 404.
 *  - The organization disappears from the default list and appears, badged,
 *    under the Deleted filter.
 *  - Restore: `deleted_at` clears, the same memberships come back (the
 *    previously removed member stays removed), the member signs in again, and
 *    the invite link works again.
 *
 * Not driven here: the join-code step. Its page (/onboarding-worker) is only
 * reachable with an org-less WORKER session, which no credentials login
 * produces (a membership-less identity signs in on the admin portal), so a
 * deleted organization's code is covered by the unit suite
 * (organization-code.verify/join tests) instead.
 *
 * ── System-admin precondition (this spec's OWN gate, same as
 *    system-user-delete-retains-records.spec.ts) ──
 *
 * Every route under /system/** 404s unless SYSTEM_ADMIN_PASSWORD is set on the
 * running server. `.env.e2e` deliberately does not set it. Run with it
 * exported for that run only:
 *
 *   SYSTEM_ADMIN_PASSWORD=e2e-system-admin npm run e2e:local -- system-organization-soft-delete.spec.ts
 *
 * Without it this whole file self-skips with a clear reason, never a silent
 * pass.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const SYSTEM_ADMIN_PASSWORD = process.env.SYSTEM_ADMIN_PASSWORD;

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5442/lms_e2e?schema=public';

const PASSWORD = 'OrgDelete-E2E-Pass1!';
const INACTIVE_COPY = 'This organization is no longer active. Contact support.';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

interface Fixture {
  slug: string;
  orgName: string;
  orgId: string;
  facilityId: string;
  ownerId: string;
  ownerOrgUserId: string;
  workerId: string;
  workerEmail: string;
  workerOrgUserId: string;
  removedId: string;
  removedOrgUserId: string;
  inviteId: string;
  inviteToken: string;
}

async function seedFixture(): Promise<Fixture> {
  const client = await db();
  try {
    const slug = uid('osd');
    const f: Fixture = {
      slug,
      orgName: `Org Delete E2E ${slug}`,
      orgId: crypto.randomUUID(),
      facilityId: crypto.randomUUID(),
      ownerId: crypto.randomUUID(),
      ownerOrgUserId: crypto.randomUUID(),
      workerId: crypto.randomUUID(),
      workerEmail: `${slug}-worker@org-delete-e2e.invalid`,
      workerOrgUserId: crypto.randomUUID(),
      removedId: crypto.randomUUID(),
      removedOrgUserId: crypto.randomUUID(),
      inviteId: crypto.randomUUID(),
      inviteToken: crypto.randomBytes(16).toString('hex'),
    };
    const ownerEmail = `${slug}-owner@org-delete-e2e.invalid`;
    const removedEmail = `${slug}-removed@org-delete-e2e.invalid`;
    const hash = await bcrypt.hash(PASSWORD, 10);

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [f.orgId, f.orgName, slug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [f.facilityId, f.orgId, `Org Delete Facility ${slug}`],
    );

    const members: Array<[string, string, string, string, string, boolean, string | null]> = [
      [f.ownerId, f.ownerOrgUserId, ownerEmail, 'Olive', 'owner', true, null],
      [f.workerId, f.workerOrgUserId, f.workerEmail, 'Wendy', 'nurse', true, null],
      // Removed by an administrator long before the org is deleted.
      [f.removedId, f.removedOrgUserId, removedEmail, 'Ronnie', 'nurse', false, '2026-03-01'],
    ];
    for (const [userId, orgUserId, email, first, role, active, deactivatedAt] of members) {
      await client.query(
        `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
         VALUES ($1, $2, $3, true, 'credentials', $4, 'Delete', $5, NOW(), NOW())`,
        [userId, email, hash, first, `${first} Delete`],
      );
      await client.query(
        `INSERT INTO organization_users (id, user_id, organization_id, role, active, deactivated_at, joined_at, role_assigned_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4::"UserRole", $5, $6, NOW(), NOW(), NOW(), NOW())`,
        [orgUserId, userId, f.orgId, role, active, deactivatedAt],
      );
      await client.query(
        `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
         VALUES ($1, $2, $3, true, NOW())`,
        [crypto.randomUUID(), orgUserId, f.facilityId],
      );
    }

    await client.query(
      `INSERT INTO invites (id, email, token, organization_id, facility_id, role, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 'nurse'::"UserRole", 'pending', NOW() + INTERVAL '7 days', NOW())`,
      [f.inviteId, `${slug}-invitee@org-delete-e2e.invalid`, f.inviteToken, f.orgId, f.facilityId],
    );

    return f;
  } finally {
    await client.end();
  }
}

async function cleanupFixture(f: Fixture): Promise<void> {
  const client = await db();
  const orgUserIds = [f.ownerOrgUserId, f.workerOrgUserId, f.removedOrgUserId];
  try {
    await client.query(`DELETE FROM invites WHERE organization_id = $1`, [f.orgId]);
    await client.query(`DELETE FROM notifications WHERE organization_user_id = ANY($1)`, [
      orgUserIds,
    ]);
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [orgUserIds],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [orgUserIds]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [
      [f.ownerId, f.workerId, f.removedId],
    ]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [f.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [f.orgId]);
  } finally {
    await client.end();
  }
}

async function loginAsSystemAdmin(page: Page): Promise<void> {
  await page.goto('/system');
  await page.getByPlaceholder('Enter system admin password').fill(SYSTEM_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Access Dashboard' }).click();
  await expect(page.getByRole('link', { name: 'Organizations' })).toBeVisible({ timeout: 15000 });
}

async function openOrganizationsList(page: Page, f: Fixture, status: 'active' | 'deleted') {
  await page.goto('/system/organizations');
  await page.getByLabel('Organization status').selectOption(status);
  await page.getByPlaceholder('Search by name or slug...').fill(f.slug);
}

interface MembershipRow {
  id: string;
  active: boolean;
  deactivated_at: Date | null;
}

async function readState(f: Fixture) {
  const client = await db();
  try {
    const { rows: orgRows } = await client.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM organizations WHERE id = $1`,
      [f.orgId],
    );
    const { rows: memberships } = await client.query<MembershipRow>(
      `SELECT id, active, deactivated_at FROM organization_users WHERE organization_id = $1`,
      [f.orgId],
    );
    const { rows: invites } = await client.query<{ status: string }>(
      `SELECT status FROM invites WHERE id = $1`,
      [f.inviteId],
    );
    return {
      deletedAt: orgRows[0].deleted_at,
      membership: (id: string) => memberships.find((m) => m.id === id)!,
      inviteStatus: invites[0].status,
    };
  } finally {
    await client.end();
  }
}

async function workerSignsIn(page: Page, f: Fixture) {
  await page.goto('/login');
  await page.fill('input[type="email"]', f.workerEmail);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
}

test.describe('System organization soft delete and restore', () => {
  test.skip(
    !SYSTEM_ADMIN_PASSWORD,
    "Skipped: SYSTEM_ADMIN_PASSWORD not set on the server — see this file's header comment. " +
      'The entire /system/** namespace 404s without it; there is no cookie workaround.',
  );

  let fixture: Fixture | undefined;

  test.beforeAll(async () => {
    fixture = await seedFixture();
  });

  test.afterAll(async () => {
    if (fixture) await cleanupFixture(fixture);
  });

  test('delete cuts off every entry point, restore brings back the same members', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const f = fixture!;

    // ── Sanity: before the delete the worker can sign in and the invite works ─
    const before = await browser.newContext();
    try {
      const beforePage = await before.newPage();
      const inviteResponse = await beforePage.goto(`/join/${f.inviteToken}`);
      expect(inviteResponse?.status()).toBe(200);
      await workerSignsIn(beforePage, f);
      await expect(beforePage).toHaveURL(/\/worker/, { timeout: 30000 });
    } finally {
      await before.close();
    }

    // ── Delete from the console, with both typed confirmations ───────────────
    await loginAsSystemAdmin(page);
    await openOrganizationsList(page, f, 'active');
    await expect(page.getByText(f.orgName)).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Delete organization' })).toBeVisible({
      timeout: 15000,
    });
    await expect(
      dialog.getByText(
        `This removes everyone's access to ${f.orgName}. Courses, documents, enrollments, certificates and billing records are retained and can be restored.`,
      ),
    ).toBeVisible();
    await expect(dialog.getByRole('row', { name: /Active members/ })).toContainText('2');
    await expect(dialog.getByRole('row', { name: /Pending invites/ })).toContainText('1');

    const confirmButton = dialog.getByRole('button', { name: 'Delete organization' });
    await expect(confirmButton).toBeDisabled();
    await dialog.getByLabel('Type the organization name to confirm:').fill(f.orgName);
    await expect(confirmButton).toBeDisabled();
    await dialog.getByLabel('Type DELETE to confirm:').fill('delete');
    await expect(confirmButton).toBeDisabled();
    await dialog.getByLabel('Type DELETE to confirm:').fill('DELETE');
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(dialog.getByText('deleted. Members can no longer sign in.')).toBeVisible({
      timeout: 15000,
    });

    // ── Database: access removed at ONE instant, nothing else touched ────────
    const afterDelete = await readState(f);
    expect(afterDelete.deletedAt).not.toBeNull();
    for (const id of [f.ownerOrgUserId, f.workerOrgUserId]) {
      const membership = afterDelete.membership(id);
      expect(membership.active).toBe(false);
      expect(membership.deactivated_at?.getTime()).toBe(afterDelete.deletedAt!.getTime());
    }
    // An earlier removal is not rewritten to the delete's instant.
    const removed = afterDelete.membership(f.removedOrgUserId);
    expect(removed.active).toBe(false);
    expect(removed.deactivated_at?.getTime()).not.toBe(afterDelete.deletedAt!.getTime());
    expect(afterDelete.inviteStatus).toBe('pending');

    // ── Console: hidden by default, listed and badged under Deleted ──────────
    await openOrganizationsList(page, f, 'active');
    await expect(page.getByText('No organizations found')).toBeVisible({ timeout: 15000 });
    await openOrganizationsList(page, f, 'deleted');
    await expect(page.getByText(f.orgName)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Deleted', { exact: true })).toBeVisible();

    // ── The member's sign-in shows the organization-inactive copy ────────────
    const learnerContext = await browser.newContext();
    try {
      const learner = await learnerContext.newPage();
      await workerSignsIn(learner, f);
      await expect(learner.getByText(INACTIVE_COPY)).toBeVisible({ timeout: 15000 });
      await expect(learner.getByText(/access to this organization has been removed/i)).toHaveCount(
        0,
      );
      await expect(learner).toHaveURL(/\/login/);
    } finally {
      await learnerContext.close();
    }

    // ── The pending invite link is a 404 ─────────────────────────────────────
    const inviteContext = await browser.newContext();
    try {
      const invitee = await inviteContext.newPage();
      const response = await invitee.goto(`/join/${f.inviteToken}`);
      expect(response?.status()).toBe(404);
      await expect(invitee.getByText(f.orgName)).toHaveCount(0);
    } finally {
      await inviteContext.close();
    }

    // ── Restore ──────────────────────────────────────────────────────────────
    await openOrganizationsList(page, f, 'deleted');
    await expect(page.getByText(f.orgName)).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menuitem', { name: 'Restore' }).click();

    const restoreDialog = page.getByRole('dialog');
    await expect(restoreDialog.getByRole('heading', { name: 'Restore organization' })).toBeVisible({
      timeout: 15000,
    });
    await expect(
      restoreDialog.getByText(
        'Restoring brings back the 2 members who were active when this organization was deleted.',
      ),
    ).toBeVisible();
    await restoreDialog.getByRole('button', { name: 'Restore organization' }).click();
    await expect(restoreDialog.getByText('restored.')).toBeVisible({ timeout: 15000 });

    const afterRestore = await readState(f);
    expect(afterRestore.deletedAt).toBeNull();
    for (const id of [f.ownerOrgUserId, f.workerOrgUserId]) {
      expect(afterRestore.membership(id)).toMatchObject({ active: true, deactivated_at: null });
    }
    // The member an admin had removed earlier stays removed.
    expect(afterRestore.membership(f.removedOrgUserId).active).toBe(false);
    expect(afterRestore.inviteStatus).toBe('pending');

    // ── The same worker signs in again, and the invite works again ───────────
    const restoredContext = await browser.newContext();
    try {
      const restored = await restoredContext.newPage();
      await workerSignsIn(restored, f);
      await expect(restored).toHaveURL(/\/worker/, { timeout: 30000 });
      await expect(restored.getByText(INACTIVE_COPY)).toHaveCount(0);

      const inviteResponse = await restored.goto(`/join/${f.inviteToken}`);
      expect(inviteResponse?.status()).toBe(200);
    } finally {
      await restoredContext.close();
    }
  });
});
