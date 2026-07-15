/**
 * E2E spec: QA ISSUE 2 — a removed ("deleted") staff member could still reach
 * a `/dashboard` shell after being removed from their organization.
 *
 * Fix (see the approved plan, `.claude/agent-memory` history, and
 * src/lib/create-auth-instance.ts / src/app/actions/{auth,staff}.ts):
 *   - `removeStaff()` now nulls `organizationId` AND bumps `sessionVersion` in
 *     the same write, so any LIVE session is invalidated on its next JWT
 *     re-validation (the existing F-059 kill-switch).
 *   - `authenticate()` short-circuits with a specific, actionable error for a
 *     non-owner admin-tier account with no organization (i.e. already removed)
 *     before ever attempting a fresh login.
 *   - `authorize()` and `jwt()` in create-auth-instance.ts independently deny
 *     the same state (defense-in-depth), scoped to the ADMIN instance only —
 *     `owner` is the only legitimate org-less admin-tier state (mid-onboarding),
 *     and org-less WORKER accounts are an unrelated, expected pre-onboarding
 *     state that must keep reaching /onboarding-worker.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - DATABASE_URL reachable for direct DB seeding/mutation.
 */

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

// ── DB helpers ────────────────────────────────────────────────────────────────

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

type UserRole =
  | 'owner'
  | 'supervisor'
  | 'hr'
  | 'clinical_director'
  | 'finance'
  | 'nurse'
  | 'therapist_clinician';

interface Seeded {
  userId: string;
  orgId: string | null;
  facilityId: string | null;
}

/**
 * Seed a single user. `withOrg: false` creates the row with a NULL
 * organization_id even for an admin-tier role — simulating either a removed
 * staff member or the legitimate pre-onboarding owner state, depending on
 * which role is passed.
 */
async function seedUser(opts: {
  email: string;
  password: string;
  role: UserRole;
  withOrg: boolean;
}): Promise<Seeded> {
  const client = await db();
  try {
    const hashed = await bcrypt.hash(opts.password, 10);
    const orgSlug = `rmv-test-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    let resolvedOrgId: string | null = null;
    let resolvedFacilityId: string | null = null;

    if (opts.withOrg) {
      await client.query(
        `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
         VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
        [orgId, `Removed-Staff Test ${orgSlug}`, orgSlug, opts.email],
      );
      await client.query(
        `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
         VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
        [facilityId, orgId, `Removed-Staff Test ${orgSlug}`],
      );
      resolvedOrgId = orgId;
      resolvedFacilityId = facilityId;
    }

    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4::\"UserRole\", true, $5, $6, NOW(), NOW())`,
      [userId, opts.email, hashed, opts.role, resolvedOrgId, resolvedFacilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, opts.email, 'Test', 'User', 'Test User'],
    );

    return { userId, orgId: resolvedOrgId, facilityId: resolvedFacilityId };
  } finally {
    await client.end();
  }
}

/** Seed an org + two users in it (an owner and an active HR staff member). */
async function seedOrgWithOwnerAndHr(
  ownerEmail: string,
  ownerPassword: string,
  hrEmail: string,
  hrPassword: string,
): Promise<{ ownerId: string; hrId: string; orgId: string; facilityId: string }> {
  const client = await db();
  try {
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const hrHashed = await bcrypt.hash(hrPassword, 10);
    const orgSlug = `rmv-ui-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const hrId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Removed-Staff UI Test ${orgSlug}`, orgSlug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Removed-Staff UI Test ${orgSlug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::\"UserRole\", true, $4, $5, NOW(), NOW())`,
      [ownerId, ownerEmail, ownerHashed, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'hr'::\"UserRole\", true, $4, $5, NOW(), NOW())`,
      [hrId, hrEmail, hrHashed, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, 'Owner', 'Test', 'Owner Test', NOW(), NOW())`,
      [ownerId, ownerEmail],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, 'HrStaffer', 'Test', 'HrStaffer Test', NOW(), NOW())`,
      [hrId, hrEmail],
    );

    return { ownerId, hrId, orgId, facilityId };
  } finally {
    await client.end();
  }
}

async function cleanupUser(userId: string, orgId?: string | null): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM profiles WHERE id = $1`, [userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    if (orgId) {
      await client.query(`DELETE FROM facilities WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
  } finally {
    await client.end();
  }
}

async function cleanupOrgAndUsers(userIds: string[], orgId: string): Promise<void> {
  const client = await db();
  try {
    for (const id of userIds) {
      await client.query(`DELETE FROM profiles WHERE id = $1`, [id]);
      await client.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await client.query(`DELETE FROM facilities WHERE organization_id = $1`, [orgId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  } finally {
    await client.end();
  }
}

/** Mirrors the exact write removeStaff() performs (src/app/actions/staff.ts). */
async function simulateRemoveStaff(userId: string): Promise<void> {
  const client = await db();
  try {
    await client.query(
      `UPDATE users SET organization_id = NULL, session_version = session_version + 1 WHERE id = $1`,
      [userId],
    );
  } finally {
    await client.end();
  }
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@removed-e2e.invalid`;
}

async function loginAs(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('QA ISSUE 2 — removed staff member cannot log in or keep a live session', () => {
  test('a removed HR account gets the specific access-removed error, never reaches /dashboard', async ({
    page,
  }) => {
    const email = uniqueEmail('removed-hr');
    const password = 'R3moved!HrPwd9';
    const { userId } = await seedUser({ email, password, role: 'hr', withOrg: false });

    try {
      await loginAs(page, email, password);

      await expect(
        page.getByText(/your access to this organization has been removed/i),
      ).toBeVisible({ timeout: 10000 });
      expect(page.url()).not.toContain('/dashboard');
    } finally {
      await cleanupUser(userId, null);
    }
  });

  test('a live HR session is killed by removeStaff() — the next navigation redirects to /login', async ({
    page,
  }) => {
    const email = uniqueEmail('live-hr');
    const password = 'LiveHr!Pwd992';
    const { userId, orgId } = await seedUser({ email, password, role: 'hr', withOrg: true });

    try {
      await loginAs(page, email, password);
      await page.waitForURL('**/dashboard', { timeout: 15000 });
      expect(page.url()).toContain('/dashboard');

      // Simulate an owner removing this HR staffer via "Remove Staff" while the
      // HR session above is still live in this same browser context.
      await simulateRemoveStaff(userId);

      await page.goto('/dashboard');
      await page.waitForURL('**/login**', { timeout: 15000 });
      expect(page.url()).toContain('/login');
    } finally {
      await cleanupUser(userId, orgId);
    }
  });

  test('org-less OWNER login is NOT blocked — reaches /dashboard and is guided to onboarding via the activation modal', async ({
    page,
  }) => {
    // Owner is the one legitimate org-less admin-tier state (pre-onboarding).
    // Unlike the worker portal, the admin portal does not route org-less users
    // away from /dashboard at the proxy layer — OrganizationActivationModal
    // (src/components/dashboard/OrganizationActivationModal.tsx) instead shows
    // a welcome dialog on /dashboard itself, with an "Activate your account"
    // button that navigates to /onboarding (or an unattended 60s auto-redirect).
    // The regression this guards: ISSUE 2's org-less-admin guard must NOT
    // mistake this legitimate state for a removed account.
    const email = uniqueEmail('preboard-owner');
    const password = 'PreB0ardOwn!9';
    const { userId } = await seedUser({ email, password, role: 'owner', withOrg: false });

    try {
      await loginAs(page, email, password);
      await page.waitForURL('**/dashboard**', { timeout: 15000 });
      expect(
        await page.getByText(/your access to this organization has been removed/i).count(),
      ).toBe(0);

      await expect(
        page.getByText(/welcome to the compliance and training management portal/i),
      ).toBeVisible({ timeout: 10000 });
      await page.getByRole('button', { name: /activate your account/i }).click();
      await page.waitForURL('**/onboarding**', { timeout: 15000 });
      expect(page.url()).toContain('/onboarding');
      expect(page.url()).not.toContain('/onboarding-worker');
    } finally {
      await cleanupUser(userId, null);
    }
  });

  test('org-less WORKER (nurse) login still reaches /onboarding-worker (unrelated, unaffected state)', async ({
    page,
  }) => {
    const email = uniqueEmail('preboard-worker');
    const password = 'PreB0ardWrk!9';
    const { userId } = await seedUser({ email, password, role: 'nurse', withOrg: false });

    try {
      await loginAs(page, email, password);
      // The Server Action's signIn(..., { redirectTo: '/worker' }) drives an
      // initial CLIENT-SIDE (soft) navigation to /worker that does not always
      // re-run edge middleware the same way a hard navigation does. Confirmed
      // directly against the raw HTTP layer (curl with a real org-less worker
      // session cookie): GET /worker → 307 → /onboarding-worker, unconditionally.
      // Force a hard top-level navigation to /worker here so the redirect is
      // exercised the same way; a stray, un-redirected soft landing on /worker
      // is a client-navigation nuance, not the behavior this test guards.
      await page.waitForURL(/\/(worker|onboarding-worker)/, {
        timeout: 20000,
        waitUntil: 'domcontentloaded',
      });
      // domcontentloaded everywhere below: the assertion is the redirect URL,
      // and the default 'load' state can hang on the page's background-image
      // optimization when a redirect aborts the first /_next/image request
      // under `next start` (CI). Confirmed via CI trace: the URL had already
      // reached /onboarding-worker while "Wait for load state" timed out.
      await page.goto('/worker', { waitUntil: 'domcontentloaded' });
      await page.waitForURL('**/onboarding-worker**', {
        timeout: 20000,
        waitUntil: 'domcontentloaded',
      });
      expect(page.url()).toContain('/onboarding-worker');
    } finally {
      await cleanupUser(userId, null);
    }
  });

  test('full UI-driven pass: owner removes an active HR staffer, who then cannot log in', async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const ownerEmail = uniqueEmail('ui-owner');
    const ownerPassword = 'UiOwner!Pwd99';
    const hrEmail = uniqueEmail('ui-hr');
    const hrPassword = 'UiHrStaff!Pwd9';

    const { ownerId, hrId, orgId } = await seedOrgWithOwnerAndHr(
      ownerEmail,
      ownerPassword,
      hrEmail,
      hrPassword,
    );

    try {
      const ownerContext = await browser.newContext();
      const ownerPage = await ownerContext.newPage();
      try {
        await loginAs(ownerPage, ownerEmail, ownerPassword);
        await ownerPage.waitForURL('**/dashboard', { timeout: 15000 });

        await ownerPage.goto('/dashboard/staff');
        await ownerPage.waitForLoadState('networkidle');
        await ownerPage.getByPlaceholder('Search for staff...').fill(hrEmail);

        await ownerPage.getByRole('button', { name: 'Row actions' }).click();
        await ownerPage.getByRole('menuitem', { name: 'Remove Staff' }).click();

        const dialog = ownerPage.getByRole('dialog');
        await expect(dialog.getByText('Remove Staff Member')).toBeVisible();
        await dialog.getByRole('button', { name: 'Remove Staff' }).click();
        await expect(dialog).toBeHidden({ timeout: 10000 });
      } finally {
        await ownerContext.close();
      }

      // A separate browser context — the removed HR staffer tries to log in.
      const hrContext = await browser.newContext();
      const hrPage = await hrContext.newPage();
      try {
        await loginAs(hrPage, hrEmail, hrPassword);
        await expect(
          hrPage.getByText(/your access to this organization has been removed/i),
        ).toBeVisible({ timeout: 10000 });
        expect(hrPage.url()).not.toContain('/dashboard');
      } finally {
        await hrContext.close();
      }
    } finally {
      await cleanupOrgAndUsers([ownerId, hrId], orgId);
    }
  });
});
