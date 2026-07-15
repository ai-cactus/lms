/**
 * E2E spec: QA ISSUE 4 — logging in as a different-category account did not
 * clear a pre-existing session of the OTHER category (admin vs. worker),
 * leaving two different users' sessions concurrently live in one browser.
 *
 * Fix (src/lib/create-auth-instance.ts, `callbacks.signIn`): a successful
 * login on either NextAuth instance now deletes the sibling instance's session
 * cookie (both the `__Secure-` and plain variants — see
 * src/lib/auth/session-cookies.ts's `siblingCookieNames()`).
 *
 * FIRST-PRIORITY TEST: "admin login clears a pre-existing worker cookie" below
 * is the runtime verification of a statically-unverifiable design choice —
 * deleting a cookie via `next/headers` `cookies()` from INSIDE the NextAuth
 * `signIn` callback (as opposed to a plain Server Action, where this is a
 * well-established pattern). If that assertion fails, the documented fallback
 * (wrapping the NextAuth route handlers to append delete-cookie headers
 * directly) needs to be applied — do not expand coverage further until this
 * is confirmed working.
 *
 * Regressions guarded here:
 *   - Learn Mode (`enterLearnMode()`) still allows BOTH cookies to coexist for
 *     the SAME (bridged) user — unaffected by the ISSUE 4 fix, since it mints
 *     the worker cookie directly via `encode()`, bypassing `signIn`.
 *   - Logout's sibling-cookie clearing (`clearSiblingSessionCookie`, used by
 *     both the admin and worker Header "Logout" flows) still works after the
 *     `session-cookies.ts` extraction/refactor.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - DATABASE_URL reachable for direct DB seeding.
 *   - Local/dev run (NODE_ENV !== 'production'): session-token cookies use the
 *     plain names (`admin.session-token`, `worker.session-token`), not the
 *     `__Secure-` prefixed ones.
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
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

type UserRole = 'owner' | 'finance' | 'nurse';

interface Seeded {
  userId: string;
  orgId: string;
  facilityId: string;
}

async function seedActiveUser(email: string, password: string, role: UserRole): Promise<Seeded> {
  const client = await db();
  try {
    const hashed = await bcrypt.hash(password, 10);
    const orgSlug = `dual-cookie-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Dual-Cookie Test ${orgSlug}`, orgSlug, email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Dual-Cookie Test ${orgSlug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4::\"UserRole\", true, $5, $6, NOW(), NOW())`,
      [userId, email, hashed, role, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, 'Dual', 'Cookie', 'Dual Cookie', NOW(), NOW())`,
      [userId, email],
    );

    return { userId, orgId, facilityId };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM profiles WHERE id = $1`, [seeded.userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.userId]);
    await client.query(`DELETE FROM facilities WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@dual-cookie-e2e.invalid`;
}

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

async function findCookie(context: BrowserContext, suffix: string) {
  const cookies = await context.cookies();
  return cookies.find((c) => c.name.endsWith(suffix));
}

/**
 * A brand-new seeded org has zero courses, which auto-opens
 * DashboardEmptyState (src/components/dashboard/DashboardEmptyState.tsx) — a
 * fixed, full-screen z-50 "getting started" overlay that intercepts every
 * click on /dashboard, including the sidebar. It is unrelated to this spec
 * (courses/onboarding UX, not auth), so dismiss it via its icon-only close
 * button (no accessible name) before interacting with the sidebar.
 */
async function dismissDashboardEmptyStateIfPresent(page: Page): Promise<void> {
  const closeButton = page.locator('div.fixed.inset-0.z-50 button').first();
  await closeButton.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('QA ISSUE 4 — a login on one instance clears the sibling session cookie', () => {
  test('FIRST PRIORITY: admin login then worker login clears the admin cookie; /dashboard redirects to /login', async ({
    page,
    context,
  }) => {
    const adminEmail = uniqueEmail('finance');
    const adminPassword = 'F1nanceAdmin!9';
    const workerEmail = uniqueEmail('nurse');
    const workerPassword = 'NurseWorker!92';

    const adminSeed = await seedActiveUser(adminEmail, adminPassword, 'finance');
    const workerSeed = await seedActiveUser(workerEmail, workerPassword, 'nurse');

    try {
      await loginAs(page, adminEmail, adminPassword);
      await page.waitForURL('**/dashboard', { timeout: 15000 });

      const adminCookieBefore = await findCookie(context, 'admin.session-token');
      expect(adminCookieBefore, 'admin cookie should be set after admin login').toBeTruthy();

      await loginAs(page, workerEmail, workerPassword);
      await page.waitForURL('**/worker', { timeout: 15000 });

      const workerCookieAfter = await findCookie(context, 'worker.session-token');
      expect(workerCookieAfter, 'worker cookie should be set after worker login').toBeTruthy();

      const adminCookieAfter = await findCookie(context, 'admin.session-token');
      expect(
        adminCookieAfter,
        'admin cookie must be cleared by the worker login (ISSUE 4 fix) — if this fails, ' +
          'the cookies() mutation inside the signIn callback is not attaching to the response; ' +
          'apply the documented fallback (wrap the NextAuth route handlers).',
      ).toBeFalsy();

      // The route guard itself was already correct (per the QA report) — the
      // defect was specifically that the stale admin cookie survived. Confirm
      // /dashboard is now genuinely unreachable.
      await page.goto('/dashboard');
      await page.waitForURL('**/login**', { timeout: 15000 });
      expect(page.url()).toContain('/login');
    } finally {
      await cleanup(adminSeed);
      await cleanup(workerSeed);
    }
  });

  test('reverse order: worker login then admin login clears the worker cookie; /worker redirects to /login', async ({
    page,
    context,
  }) => {
    const adminEmail = uniqueEmail('finance-rev');
    const adminPassword = 'F1nanceAdmin!8';
    const workerEmail = uniqueEmail('nurse-rev');
    const workerPassword = 'NurseWorker!81';

    const adminSeed = await seedActiveUser(adminEmail, adminPassword, 'finance');
    const workerSeed = await seedActiveUser(workerEmail, workerPassword, 'nurse');

    try {
      await loginAs(page, workerEmail, workerPassword);
      await page.waitForURL('**/worker', { timeout: 15000 });
      expect(await findCookie(context, 'worker.session-token')).toBeTruthy();

      await loginAs(page, adminEmail, adminPassword);
      await page.waitForURL('**/dashboard', { timeout: 15000 });

      expect(await findCookie(context, 'admin.session-token')).toBeTruthy();
      expect(
        await findCookie(context, 'worker.session-token'),
        'worker cookie must be cleared by the admin login',
      ).toBeFalsy();

      await page.goto('/worker');
      await page.waitForURL('**/login**', { timeout: 15000 });
      expect(page.url()).toContain('/login');
    } finally {
      await cleanup(adminSeed);
      await cleanup(workerSeed);
    }
  });
});

test.describe('Regression: Learn Mode still allows both cookies for the SAME user', () => {
  test('bridging into Learn mode mints a worker cookie WITHOUT clearing the admin cookie', async ({
    page,
    context,
  }) => {
    const ownerEmail = uniqueEmail('learn-owner');
    const ownerPassword = 'LearnOwner!93';
    const ownerSeed = await seedActiveUser(ownerEmail, ownerPassword, 'owner');

    try {
      await loginAs(page, ownerEmail, ownerPassword);
      await page.waitForURL('**/dashboard', { timeout: 15000 });
      await dismissDashboardEmptyStateIfPresent(page);
      expect(await findCookie(context, 'admin.session-token')).toBeTruthy();

      await page.getByRole('button', { name: 'Learn' }).click();
      await page.waitForURL('**/worker', { timeout: 15000 });

      // enterLearnMode() mints the worker cookie directly (bypasses signIn),
      // so it must NOT trigger the ISSUE 4 sibling-clear logic against itself.
      expect(
        await findCookie(context, 'admin.session-token'),
        'the admin cookie must survive bridging into Learn mode for the same user',
      ).toBeTruthy();
      expect(await findCookie(context, 'worker.session-token')).toBeTruthy();

      // Both portals are concurrently reachable for this one bridged user.
      await page.goto('/dashboard');
      expect(page.url()).toContain('/dashboard');
    } finally {
      await cleanup(ownerSeed);
    }
  });
});

test.describe('Regression: logout still clears the sibling cookie after the session-cookies.ts refactor', () => {
  test('logging out from a bridged Learn-mode (worker) session also clears the admin cookie', async ({
    page,
    context,
  }) => {
    const ownerEmail = uniqueEmail('logout-owner');
    const ownerPassword = 'LogoutOwner!94';
    const ownerSeed = await seedActiveUser(ownerEmail, ownerPassword, 'owner');

    try {
      await loginAs(page, ownerEmail, ownerPassword);
      await page.waitForURL('**/dashboard', { timeout: 15000 });
      await dismissDashboardEmptyStateIfPresent(page);

      await page.getByRole('button', { name: 'Learn' }).click();
      await page.waitForURL('**/worker', { timeout: 15000 });

      // Dismiss the first-visit "How to get started" tour modal if it appears —
      // it can intercept the header-dropdown click below.
      const welcomeModalClose = page.getByRole('button', { name: 'Close' });
      await welcomeModalClose.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      if (await welcomeModalClose.isVisible()) {
        await welcomeModalClose.click();
      }

      expect(await findCookie(context, 'admin.session-token')).toBeTruthy();
      expect(await findCookie(context, 'worker.session-token')).toBeTruthy();

      await page.locator('header').getByText('Dual Cookie').first().click();
      await page.getByRole('button', { name: 'Logout' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await Promise.all([
        page.waitForURL('**/login**', { timeout: 15000 }),
        dialog.getByRole('button', { name: 'Logout' }).click(),
      ]);

      expect(
        await findCookie(context, 'worker.session-token'),
        'the primary (worker) session cookie must be cleared by signOut()',
      ).toBeFalsy();
      expect(
        await findCookie(context, 'admin.session-token'),
        'the bridged admin session cookie must be cleared by clearSiblingSessionCookie("worker")',
      ).toBeFalsy();
    } finally {
      await cleanup(ownerSeed);
    }
  });

  test('logging out from a plain admin session clears any (absent) worker cookie without erroring', async ({
    page,
    context,
  }) => {
    const ownerEmail = uniqueEmail('logout-admin-only');
    const ownerPassword = 'LogoutAdmOnly!95';
    const ownerSeed = await seedActiveUser(ownerEmail, ownerPassword, 'owner');

    try {
      await loginAs(page, ownerEmail, ownerPassword);
      await page.waitForURL('**/dashboard', { timeout: 15000 });
      await dismissDashboardEmptyStateIfPresent(page);

      await page.locator('header').getByText('Dual Cookie').first().click();
      await page.getByRole('button', { name: 'Logout' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await Promise.all([
        page.waitForURL('**/login**', { timeout: 15000 }),
        dialog.getByRole('button', { name: 'Logout' }).click(),
      ]);

      expect(await findCookie(context, 'admin.session-token')).toBeFalsy();
      expect(page.url()).toContain('/login');
    } finally {
      await cleanup(ownerSeed);
    }
  });
});
