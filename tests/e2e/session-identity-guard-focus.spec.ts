/**
 * E2E: does the SAME-portal session-eviction guard detect a takeover on tab
 * refocus, WITHOUT the evicted tab performing a manual reload or navigation?
 *
 * `SessionIdentityGuard` (src/components/providers/SessionIdentityGuard.tsx)
 * registers its own `focus` / `visibilitychange` listeners specifically to
 * "re-check when a backgrounded tab is brought back to the foreground: the
 * eviction may have happened while this tab was hidden" (see that file's own
 * comment). This spec exercises exactly that path: log in as A in tab 1, log
 * in as B in tab 2 (same browser context — same shared admin.session-token
 * cookie jar as session-isolation-repro.spec.ts) WITHOUT ever reloading or
 * navigating tab 1, then fire focus/visibilitychange on tab 1 directly and
 * check whether the eviction interstitial appears from that alone.
 *
 * Builds on the same DB-seeding/login/cookie-reading conventions as
 * session-isolation-repro.spec.ts (self-contained per this repo's spec-file
 * convention — no cross-file imports).
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
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

type UserRole = 'owner' | 'finance';

interface SeededAccount {
  userId: string;
  orgUserId: string;
  orgId: string;
  facilityId: string;
  email: string;
  password: string;
  fullName: string;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@session-identity-focus-e2e.invalid`;
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
    const orgSlug = `session-focus-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const orgUserId = crypto.randomUUID();
    const fullName = `${firstName} ${lastName}`;

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Session Focus Test ${orgSlug}`, orgSlug, email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Session Focus Test ${orgSlug}`],
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

    return { userId, orgUserId, orgId, facilityId, email, password, fullName };
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

/** Fires the same events the guard's own refocus listeners are wired to
 * (`window.addEventListener('focus', ...)`, `document.addEventListener('visibilitychange', ...)`)
 * without any navigation or reload — the exact trigger a real tab-refocus produces. */
async function simulateRefocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test.describe('Session-identity guard — refocus detection without a manual reload', () => {
  test('a second admin login in tab 2 is detected by tab 1 on refocus alone, with no reload/navigation of tab 1', async ({
    context,
  }) => {
    const accountA = await seedAccount('focus-a', 'owner', 'Fiona', 'Focuston');
    const accountB = await seedAccount('focus-b', 'finance', 'Grant', 'Glance');

    console.log(`[FOCUS] Account A (tab 1): ${accountA.email} / "${accountA.fullName}"`);
    console.log(`[FOCUS] Account B (tab 2): ${accountB.email} / "${accountB.fullName}"`);

    try {
      const page1 = await context.newPage();
      await loginAs(page1, accountA.email, accountA.password);
      await page1.waitForURL('**/dashboard', { timeout: 15000 });

      const tab1TextBefore = await page1.locator('body').innerText();
      expect(
        tab1TextBefore,
        'sanity check: tab 1 must show A immediately after A logs in',
      ).toContain(accountA.fullName);

      // Second tab, SAME browser context => same cookie jar.
      const page2 = await context.newPage();
      await loginAs(page2, accountB.email, accountB.password);
      await page2.waitForURL('**/dashboard', { timeout: 15000 });
      expect(
        await findCookie(context, 'admin.session-token'),
        "sanity check: B's login must have overwritten the shared admin cookie",
      ).toBeTruthy();

      // Tab 1 NEVER reloads or navigates from here on — only refocus events fire.
      await simulateRefocus(page1);

      const evictedScreen = page1.locator('[data-testid="session-evicted"]');
      const becameVisible = await evictedScreen
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      const tab1TextAfterFocus = await page1.locator('body').innerText();
      console.log(
        `[FOCUS] tab 1 body text after refocus (no reload/navigation): "${tab1TextAfterFocus}"`,
      );
      console.log(`[FOCUS] eviction screen became visible from refocus alone: ${becameVisible}`);

      expect(
        becameVisible,
        `SESSION ISOLATION: tab 1 (logged in as A, email ${accountA.email}) never reloaded or ` +
          `navigated after B (email ${accountB.email}) logged in via tab 2 and overwrote the ` +
          `shared admin.session-token cookie. Firing 'focus'/'visibilitychange' on tab 1 alone ` +
          `— the exact trigger SessionIdentityGuard's own refocus listeners are wired to — was ` +
          `expected to reveal the [data-testid="session-evicted"] interstitial. It did not ` +
          `become visible within 5s, meaning the guard's on-refocus re-check did not detect the ` +
          `takeover without a fresh server round trip (reload/navigation).`,
      ).toBe(true);

      expect(
        tab1TextAfterFocus,
        `tab 1's rendered page must not contain any of account B's data ("${accountB.fullName}") ` +
          `after the refocus-triggered eviction check.`,
      ).not.toContain(accountB.fullName);
    } finally {
      await cleanup(accountA);
      await cleanup(accountB);
    }
  });
});
