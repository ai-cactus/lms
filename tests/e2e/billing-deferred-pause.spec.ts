/**
 * E2E spec: deferred subscription pauses (BUG-13).
 *
 * A pause takes effect only at the end of the period the org already paid for
 * (product decision 2026-08-27): the pause route stores `pause_starts_at =
 * current_period_end` and leaves `paused_at` empty until the sweep applies it.
 * During that pending window billing is fully active, and the UI offers to
 * cancel the scheduled pause.
 *
 * Acceptance criteria:
 *   - With a future `pause_starts_at`, a billing admin sees the scheduled pause
 *     everywhere it is surfaced — the site-wide banner on /dashboard, the
 *     Overview notice, and the Subscription tab's "Pause scheduled" card — and
 *     nothing presents the subscription as paused or access as limited.
 *   - The Subscription tab's plan menu offers "Cancel pause" and "Cancel", not
 *     "Pause" or "Restart"; the cancel page hides its own pause control.
 *   - "Cancel pause" (from the banner, or from the Subscription tab) clears
 *     `pause_starts_at` / `pause_ends_at` and the scheduled-pause UI goes away.
 *
 * Network boundary: cancelling a PENDING pause is local-only — the resume route
 * returns before any Stripe call (src/app/api/billing/subscription/resume/
 * route.ts), because nothing was ever applied on Stripe. So this spec drives
 * the real endpoint with no page.route stub; the e2e env's dummy
 * STRIPE_SECRET_KEY would make any Stripe call fail loudly. The billing reads
 * never reach Stripe either: /api/billing/overview only calls it for an org
 * with a stripeCustomerId, which these freshly-seeded orgs lack.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - DATABASE_URL reachable for direct DB seeding.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

const PASSWORD = 'DeferredPause!9';
const DAY_MS = 24 * 60 * 60 * 1000;

// Dates render with toLocaleDateString in the browser's zone; pin it so the
// expected strings computed below match.
test.use({ timezoneId: 'UTC' });

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

interface Seeded {
  orgId: string;
  userId: string;
  orgUserId: string;
  email: string;
  pauseStartsAt: Date;
  pauseEndsAt: Date;
}

/** An owner whose active subscription has a pause scheduled for its period end. */
async function seedPendingPause(): Promise<Seeded> {
  const client = await db();
  try {
    const email = `owner-${crypto.randomBytes(4).toString('hex')}@deferred-pause-e2e.invalid`;
    const slug = `deferred-pause-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const orgUserId = crypto.randomUUID();

    const periodStart = new Date(Date.now() - 335 * DAY_MS);
    // Noon UTC keeps the rendered calendar date stable.
    const periodEnd = new Date(Date.now() + 30 * DAY_MS);
    periodEnd.setUTCHours(12, 0, 0, 0);
    const pauseStartsAt = periodEnd;
    const pauseEndsAt = new Date(periodEnd);
    pauseEndsAt.setUTCMonth(pauseEndsAt.getUTCMonth() + 3);

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Deferred Pause E2E ${slug}`, slug, email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Deferred Pause Facility ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Pause', 'Owner', 'Pause Owner', NOW(), NOW())`,
      [userId, email, await bcrypt.hash(PASSWORD, 10)],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [orgUserId, userId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), orgUserId, facilityId],
    );
    await client.query(
      `INSERT INTO subscriptions (
         id, organization_id, stripe_subscription_id, stripe_price_id, plan,
         billing_cycle, status, current_period_start, current_period_end,
         cancel_at_period_end, paused_at, pause_starts_at, pause_ends_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'growth'::"SubscriptionPlan", 'yearly'::"SubscriptionBillingCycle",
         'active'::"SubscriptionStatus", $5, $6, false, NULL, $7, $8, NOW(), NOW())`,
      [
        crypto.randomUUID(),
        orgId,
        `sub_e2e_${crypto.randomBytes(6).toString('hex')}`,
        `price_e2e_${crypto.randomBytes(6).toString('hex')}`,
        // ISO strings, not Dates: these columns are timestamp WITHOUT time zone,
        // and pg would serialise a Date in the Node process's local zone.
        periodStart.toISOString(),
        periodEnd.toISOString(),
        pauseStartsAt.toISOString(),
        pauseEndsAt.toISOString(),
      ],
    );

    return { orgId, userId, orgUserId, email, pauseStartsAt, pauseEndsAt };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
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

async function pauseColumns(
  orgId: string,
): Promise<{ pausedAt: Date | null; pauseStartsAt: Date | null; pauseEndsAt: Date | null }> {
  const client = await db();
  try {
    const res = await client.query(
      `SELECT paused_at, pause_starts_at, pause_ends_at FROM subscriptions WHERE organization_id = $1`,
      [orgId],
    );
    const row = res.rows[0];
    return {
      pausedAt: row.paused_at,
      pauseStartsAt: row.pause_starts_at,
      pauseEndsAt: row.pause_ends_at,
    };
  } finally {
    await client.end();
  }
}

async function login(page: Page, email: string): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.addInitScript(() => {
    window.localStorage.setItem('modal_dismissed_dashboardEmptyState', 'forever');
  });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 45000 });
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function longDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function openPlanMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Update Plan' }).click();
}

test.describe('Billing — a deferred (scheduled) pause', () => {
  test('is shown as scheduled on the banner, Overview and Subscription tab, never as paused', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seeded = await seedPendingPause();
    try {
      await login(page, seeded.email);

      // Site-wide banner (layout-level, DB-driven).
      await expect(
        page.getByText(`Your subscription will pause on ${shortDate(seeded.pauseStartsAt)}`),
      ).toBeVisible();
      await expect(
        page.getByText(
          'Nothing changes until then — you keep full access for the period you have already paid for.',
        ),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel pause' })).toBeVisible();
      await expect(page.getByText('Your subscription is paused')).toHaveCount(0);
      await expect(page.getByText(/Access is limited/)).toHaveCount(0);

      // Overview tab.
      await page.goto('/dashboard/billing?tab=overview');
      await expect(page.getByText(`Pauses on ${shortDate(seeded.pauseStartsAt)}`)).toBeVisible();
      await expect(
        page.getByText('You keep full access until then. Manage this from the Subscription tab.'),
      ).toBeVisible();
      await expect(page.getByText('Your subscription is paused')).toHaveCount(0);

      // Subscription tab: the scheduled-pause card and its plan menu.
      await page.goto('/dashboard/billing?tab=subscription');
      await expect(page.getByRole('heading', { name: 'Pause scheduled' })).toBeVisible();
      await expect(
        page.getByText(`Your subscription will pause on ${longDate(seeded.pauseStartsAt)}`),
      ).toBeVisible();
      await expect(
        page.getByText(`Your pause would run until ${longDate(seeded.pauseEndsAt)}.`, {
          exact: false,
        }),
      ).toBeVisible();

      await openPlanMenu(page);
      await expect(page.getByRole('menuitem', { name: 'Cancel pause', exact: true })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Cancel', exact: true })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Pause', exact: true })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: 'Restart', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');

      // The cancel page does not offer a second pause on top of the scheduled one.
      await page.goto('/dashboard/billing/cancel');
      await expect(page.getByRole('checkbox')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Pause Instead' })).toHaveCount(0);

      // Nothing above wrote anything.
      const columns = await pauseColumns(seeded.orgId);
      expect(columns.pausedAt).toBeNull();
      expect(columns.pauseStartsAt).not.toBeNull();
    } finally {
      await cleanup(seeded);
    }
  });

  test('"Cancel pause" on the dashboard banner clears the scheduled pause', async ({ page }) => {
    test.setTimeout(90_000);
    const seeded = await seedPendingPause();
    try {
      await login(page, seeded.email);

      const resumed = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/billing/subscription/resume') &&
          response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Cancel pause' }).click();
      expect((await resumed).status()).toBe(200);

      await expect(page.getByText(/Your subscription will pause on/)).toHaveCount(0);
      const columns = await pauseColumns(seeded.orgId);
      expect(columns).toEqual({ pausedAt: null, pauseStartsAt: null, pauseEndsAt: null });

      // The Subscription tab is back to its unscheduled state.
      await page.goto('/dashboard/billing?tab=subscription');
      await expect(page.getByRole('heading', { name: /renews automatically/ })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Pause scheduled' })).toHaveCount(0);
      await openPlanMenu(page);
      await expect(page.getByRole('menuitem', { name: 'Pause', exact: true })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Cancel pause', exact: true })).toHaveCount(
        0,
      );
    } finally {
      await cleanup(seeded);
    }
  });

  test('"Cancel pause" from the Subscription tab clears the scheduled pause and lands on Overview', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seeded = await seedPendingPause();
    try {
      await login(page, seeded.email);
      await page.goto('/dashboard/billing?tab=subscription');
      await expect(page.getByRole('heading', { name: 'Pause scheduled' })).toBeVisible();

      const resumed = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/billing/subscription/resume') &&
          response.request().method() === 'POST',
      );
      await openPlanMenu(page);
      await page.getByRole('menuitem', { name: 'Cancel pause', exact: true }).click();
      expect((await resumed).status()).toBe(200);

      await expect(page).toHaveURL(/[?&]tab=overview/, { timeout: 20000 });
      // Real, unmocked overview re-read after the mutation.
      await expect(page.getByText(/Pauses on /)).toHaveCount(0);
      await expect(page.getByText(/Next invoice on/i)).toBeVisible();

      const columns = await pauseColumns(seeded.orgId);
      expect(columns).toEqual({ pausedAt: null, pauseStartsAt: null, pauseEndsAt: null });
    } finally {
      await cleanup(seeded);
    }
  });
});
