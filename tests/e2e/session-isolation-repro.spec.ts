/**
 * E2E reproduction: session-isolation bug — two NextAuth v5 instances (admin
 * portal, cookie `admin.session-token`; worker portal, cookie
 * `worker.session-token`) share ONE browser cookie jar per browser context.
 * Because a browser context's cookies are shared across every tab opened in
 * it, a SECOND account logging in anywhere in the same browser context takes
 * over the FIRST account's session — the earlier tab either silently renders
 * the second account's view (view bleed) or is logged out with no action of
 * its own (spontaneous logout).
 *
 * This spec asserts the DESIRED (isolated) behavior and now PASSES: the
 * render-level fix (SessionIdentityGuard, src/components/providers/SessionIdentityGuard.tsx
 * + src/lib/auth/tab-identity.ts) evicts a tab whose per-tab sessionStorage
 * baseline no longer matches the account the server resolves for the shared
 * cookie, instead of silently re-rendering the new account's data. These are
 * now regression locks — do not weaken them to accommodate a future
 * reintroduction of the bleed.
 *
 * Builds on the seeding/login/cookie helpers already proven out in
 * tests/e2e/rbac-dual-cookie-login.spec.ts (same DB-seeding shape, same
 * `loginAs`/`findCookie` helpers, same subscription-row requirement for
 * worker-role fixtures — see that file's header comment). That spec already
 * proves the cookie itself gets cleared cross-portal (QA ISSUE 4, already
 * fixed); this spec proves the RENDER-LEVEL symptom on top of it, which is
 * NOT covered there.
 *
 * Pre-conditions: same as rbac-dual-cookie-login.spec.ts — app on
 * http://localhost:3005, DATABASE_URL reachable, local/dev run so cookies use
 * the plain (non `__Secure-`) names.
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

// ── DB helpers (mirrors rbac-dual-cookie-login.spec.ts's seedActiveUser, but
// parameterized on first/last name so each seeded account has a distinct,
// assertable identity string rendered in the header) ────────────────────────

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

type UserRole = 'owner' | 'finance' | 'nurse';

interface SeededAccount {
  userId: string;
  orgUserId: string;
  orgId: string;
  facilityId: string;
  email: string;
  password: string;
  fullName: string;
  orgName: string;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@session-isolation-e2e.invalid`;
}

async function seedAccount(
  emailPrefix: string,
  role: UserRole,
  firstName: string,
  lastName: string,
): Promise<SeededAccount> {
  const client = await db();
  try {
    const email = uniqueEmail(emailPrefix);
    const password = `${firstName}${lastName}!${Math.floor(1000 + Math.random() * 8999)}`;
    const hashed = await bcrypt.hash(password, 10);
    const orgSlug = `session-iso-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const orgUserId = crypto.randomUUID();
    const fullName = `${firstName} ${lastName}`;
    const orgName = `Session Isolation Test ${orgSlug}`;

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, orgName, orgSlug, email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, orgName],
    );
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
      [userId, email, hashed, firstName, lastName, fullName],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [orgUserId, userId, orgId, role],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), orgUserId, facilityId],
    );
    // A missing subscription row is treated as inactive billing and blocks
    // the worker portal outright (TC-041-B) — irrelevant to this spec, so
    // every fixture (admin or worker role) gets an active one, matching
    // rbac-dual-cookie-login.spec.ts's seedActiveUser.
    const subNow = new Date();
    const subPeriodEnd = new Date(subNow);
    subPeriodEnd.setFullYear(subPeriodEnd.getFullYear() + 1);
    await client.query(
      `INSERT INTO subscriptions (
         id, organization_id, stripe_subscription_id, stripe_price_id, plan,
         billing_cycle, status, current_period_start, current_period_end,
         cancel_at_period_end, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'growth'::"SubscriptionPlan", 'yearly'::"SubscriptionBillingCycle",
         'active'::"SubscriptionStatus", $5, $6, false, NOW(), NOW())`,
      [
        crypto.randomUUID(),
        orgId,
        `sub_e2e_${crypto.randomBytes(6).toString('hex')}`,
        `price_e2e_${crypto.randomBytes(6).toString('hex')}`,
        subNow,
        subPeriodEnd,
      ],
    );

    return { userId, orgUserId, orgId, facilityId, email, password, fullName, orgName };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: SeededAccount): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM organization_user_facilities WHERE organization_user_id = $1`, [
      seeded.orgUserId,
    ]);
    await client.query(`DELETE FROM organization_users WHERE id = $1`, [seeded.orgUserId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.userId]);
    await client.query(`DELETE FROM facilities WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

// ── Browser helpers (same behavior as rbac-dual-cookie-login.spec.ts's
// loginAs/findCookie — duplicated here since spec files in this repo are
// self-contained and don't cross-import from one another) ──────────────────

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
 * Reads the server-rendered identity out of the page header — both
 * DashboardLayoutClient (admin) and WorkerDashboardLayout (worker) receive
 * the resolved session's `fullName` as a prop and render it in `<header>`
 * (see src/app/dashboard/(main)/layout.tsx, src/app/worker/layout.tsx). This
 * reflects whichever session the server actually resolved for the request,
 * not anything cached client-side, so it's a faithful probe of "who does
 * this tab currently think it is."
 */
async function getDisplayedIdentity(page: Page): Promise<string> {
  return (await page.locator('header').first().innerText()).trim();
}

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe('Session isolation bug reproduction (admin.session-token / worker.session-token shared per browser context)', () => {
  test("REPRO A — same-portal view bleed: a second admin login in tab 2 overwrites tab 1's identity on reload", async ({
    context,
  }) => {
    const accountA = await seedAccount('admin-a', 'owner', 'Alice', 'Anderson');
    const accountB = await seedAccount('admin-b', 'finance', 'Bob', 'Baxter');

    console.log(`[REPRO A] Account A (tab 1): ${accountA.email} / "${accountA.fullName}"`);
    console.log(`[REPRO A] Account B (tab 2): ${accountB.email} / "${accountB.fullName}"`);

    try {
      const page1 = await context.newPage();
      await loginAs(page1, accountA.email, accountA.password);
      await page1.waitForURL('**/dashboard', { timeout: 15000 });

      const tab1IdentityBefore = await getDisplayedIdentity(page1);
      console.log(`[REPRO A] tab 1 identity right after A's own login: "${tab1IdentityBefore}"`);
      expect(
        tab1IdentityBefore,
        'sanity check: tab 1 must show A immediately after A logs in',
      ).toContain(accountA.fullName);

      // Second tab, SAME browser context => same cookie jar.
      const page2 = await context.newPage();
      await loginAs(page2, accountB.email, accountB.password);
      await page2.waitForURL('**/dashboard', { timeout: 15000 });

      const tab2Identity = await getDisplayedIdentity(page2);
      console.log(`[REPRO A] tab 2 identity right after B's login: "${tab2Identity}"`);
      expect(tab2Identity, 'sanity check: tab 2 must show B after B logs in').toContain(
        accountB.fullName,
      );

      // Tab 1 never navigated or acted — the shared admin.session-token cookie was
      // overwritten by B's login underneath it. The fixed behavior: tab 1 must show
      // the eviction interstitial and render NONE of B's data (its stale identity —
      // A's own name — may still appear WITHIN that interstitial; that's sourced
      // from tab 1's own per-tab sessionStorage baseline, not a live dashboard view,
      // so it isn't a bleed).
      await page1.reload();

      const evictedScreen = page1.locator('[data-testid="session-evicted"]');
      await expect(
        evictedScreen,
        `SESSION ISOLATION BUG: tab 1 (logged in as A, email ${accountA.email}) reloaded ` +
          `after B (email ${accountB.email}) logged in via tab 2 in the SAME browser context, ` +
          `overwriting the shared admin.session-token cookie. Expected the eviction ` +
          `interstitial [data-testid="session-evicted"] to be visible.`,
      ).toBeVisible({ timeout: 15000 });

      const tab1BodyTextAfter = await page1.locator('body').innerText();
      console.log(
        `[REPRO A] tab 1 rendered body text after reload (B logged in via tab 2 meanwhile): "${tab1BodyTextAfter}"`,
      );

      expect(
        tab1BodyTextAfter,
        `SESSION ISOLATION BUG: tab 1's rendered page must not contain any of account B's data ` +
          `(name "${accountB.fullName}") after eviction. Actual rendered text: "${tab1BodyTextAfter}"`,
      ).not.toContain(accountB.fullName);
      expect(
        tab1BodyTextAfter,
        `SESSION ISOLATION BUG: tab 1's rendered page must not contain account B's organization ` +
          `("${accountB.orgName}") after eviction. Actual rendered text: "${tab1BodyTextAfter}"`,
      ).not.toContain(accountB.orgName);
    } finally {
      await cleanup(accountA);
      await cleanup(accountB);
    }
  });

  test("REPRO B — cross-portal render: worker login in tab 2 evicts tab 1's admin session and tab 1 renders the worker's view when it navigates to /worker", async ({
    context,
  }) => {
    const adminA = await seedAccount('cross-admin', 'owner', 'Carol', 'Crane');
    const workerB = await seedAccount('cross-worker', 'nurse', 'Dave', 'Dalton');

    console.log(`[REPRO B] Admin A (tab 1): ${adminA.email} / "${adminA.fullName}"`);
    console.log(`[REPRO B] Worker B (tab 2): ${workerB.email} / "${workerB.fullName}"`);

    try {
      const page1 = await context.newPage();
      await loginAs(page1, adminA.email, adminA.password);
      await page1.waitForURL('**/dashboard', { timeout: 15000 });

      const tab1IdentityBefore = await getDisplayedIdentity(page1);
      console.log(`[REPRO B] tab 1 identity right after A's own login: "${tab1IdentityBefore}"`);
      expect(tab1IdentityBefore, 'sanity check: tab 1 must show A right after login').toContain(
        adminA.fullName,
      );
      expect(
        await findCookie(context, 'admin.session-token'),
        'sanity check: admin cookie must exist after A logs in',
      ).toBeTruthy();

      const page2 = await context.newPage();
      await loginAs(page2, workerB.email, workerB.password);
      await page2.waitForURL('**/worker', { timeout: 15000 });

      // Already established by rbac-dual-cookie-login.spec.ts (QA ISSUE 4,
      // fixed): worker login clears the sibling admin cookie.
      expect(
        await findCookie(context, 'admin.session-token'),
        'the admin cookie is expected to be cleared by the worker login (already-fixed ISSUE 4 behavior)',
      ).toBeFalsy();
      expect(await findCookie(context, 'worker.session-token')).toBeTruthy();

      // What THIS spec adds: tab 1 never acted, and its OWN session was just
      // evicted out from under it by an unrelated tab. Does it render a
      // "you were signed out" state, or does it silently render B?
      await page1.goto('/worker');
      const tab1RenderedAtWorker = await getDisplayedIdentity(page1).catch((err) => {
        console.log(`[REPRO B] tab 1 could not read a <header> at /worker: ${String(err)}`);
        return '<no header found>';
      });
      console.log(
        `[REPRO B] tab 1 navigated to /worker (its own portal was never worker) and rendered: "${tab1RenderedAtWorker}"`,
      );
      console.log(`[REPRO B] tab 1 URL after navigating to /worker: ${page1.url()}`);

      expect(
        tab1RenderedAtWorker,
        `SESSION ISOLATION BUG: tab 1 was logged in as admin A (email ${adminA.email}) and ` +
          `took no action of its own. After worker B (email ${workerB.email}) logged in via ` +
          `tab 2 — which evicted A's admin.session-token cookie — tab 1 navigated to /worker ` +
          `and silently rendered worker B's view ("${tab1RenderedAtWorker}") instead of some ` +
          `evicted-session state. Desired: tab 1 must not render B's identity here.`,
      ).not.toContain(workerB.fullName);

      // Confirm tab 1's own portal is genuinely unreachable now (matches the
      // already-covered ISSUE 4 cookie-clearing assertion).
      await page1.goto('/dashboard');
      await page1.waitForURL('**/login**', { timeout: 15000 });
      console.log(
        `[REPRO B] tab 1 navigating to /dashboard after eviction redirected to: ${page1.url()}`,
      );
      expect(page1.url()).toContain('/login');
    } finally {
      await cleanup(adminA);
      await cleanup(workerB);
    }
  });
});
