/**
 * E2E regression spec: "Stripe as single source of truth for billing prices".
 *
 * Before this change, `SubscriptionTab` rendered a hardcoded `$99`/mo Starter
 * price and static `(-10%)`/`(-25%)` cycle-toggle labels. Prices now come
 * from `getPlanPrices()` (src/lib/billing-prices.ts), which calls
 * `stripe.prices.retrieve` server-side for each configured plan/cycle price
 * id and derives an effective monthly figure — see
 * src/lib/billing-price-format.ts.
 *
 * Network boundary: `getPlanPrices()` runs in the Next.js server component
 * (Node), not the browser, so `page.route()` cannot intercept the Stripe
 * call the way client-side fetches are intercepted elsewhere in this suite
 * (see billing-plan-change-and-gating.spec.ts). Per the approved test plan,
 * this spec instead reads the SAME `STRIPE_SECRET_KEY` / `STRIPE_STARTER_*_PRICE_ID`
 * env vars the running app server uses, independently calls the real
 * Stripe test-mode API to learn the ground-truth price, and asserts the
 * rendered card against that derived value — never a hardcoded dollar amount.
 *
 * Coverage gap (environment-gated): this local sandbox's `.env` ships EMPTY
 * `STRIPE_STARTER_*_PRICE_ID` values and `.env.local`'s `STRIPE_SECRET_KEY`
 * is a short placeholder (not a real `sk_test_...` key), so
 * `fetchPlanPricesUncached` can never produce a real Starter price here —
 * the card deterministically renders "Price unavailable". The price-value
 * assertion below therefore self-skips via `test.skip(...)` with a
 * descriptive reason whenever Stripe test-mode isn't configured, and the
 * deterministic core of this behavior is covered instead by
 * src/lib/billing-prices.test.ts (fetchPlanPricesUncached) and
 * src/components/billing/SubscriptionTab.test.tsx (price rendering,
 * "Price unavailable" degradation) — see bug-hunter's report for details.
 * The static-label regression test below has no such dependency and always
 * runs.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - Uses the stock seeded `admin@test.com` (role: owner, has `billing.read`)
 *     from prisma/seed.ts — read-only spec, no DB writes, no cleanup needed.
 */

import { test, expect, type Page } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import Stripe from 'stripe';

// Mirror Next.js's own env precedence for this out-of-band Stripe lookup:
// .env.local wins over .env. dotenv.config() never overwrites a key already
// present in process.env, so loading .env.local first and .env second gives
// .env.local priority without an explicit `override` flag.
loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env' });

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 45000 });
}

/** A real Stripe test/live secret key, not a placeholder like `.env.local`'s dummy value. */
function isRealStripeSecretKey(key: string | undefined): key is string {
  return !!key && /^sk_(test|live)_[A-Za-z0-9]{20,}$/.test(key);
}

function isRealPriceId(id: string | undefined): id is string {
  return !!id && /^price_[A-Za-z0-9]+$/.test(id);
}

/** Mirrors the effectiveMonthlyCents derivation in src/lib/billing-prices.ts. */
function effectiveMonthlyDollars(price: Stripe.Price): number | null {
  if (price.unit_amount == null || !price.recurring) return null;
  const { interval, interval_count: intervalCount } = price.recurring;
  if (interval !== 'month' && interval !== 'year') return null;
  const months = interval === 'year' ? 12 * intervalCount : intervalCount;
  const effectiveMonthlyCents = Math.round(price.unit_amount / months);
  return Math.round(effectiveMonthlyCents / 100);
}

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STARTER_PRICE_IDS = {
  monthly: process.env.STRIPE_STARTER_PRICE_ID,
  quarterly: process.env.STRIPE_STARTER_QUARTERLY_PRICE_ID,
  yearly: process.env.STRIPE_STARTER_YEARLY_PRICE_ID,
};

const STRIPE_TEST_MODE_CONFIGURED =
  isRealStripeSecretKey(STRIPE_SECRET_KEY) &&
  isRealPriceId(STARTER_PRICE_IDS.monthly) &&
  isRealPriceId(STARTER_PRICE_IDS.quarterly) &&
  isRealPriceId(STARTER_PRICE_IDS.yearly);

const CYCLE_LABELS: Record<'monthly' | 'quarterly' | 'yearly', RegExp> = {
  monthly: /^monthly$/i,
  quarterly: /^quarterly$/i,
  yearly: /^yearly$/i,
};

test.describe('Billing — Stripe-sourced plan prices (no static hardcoded pricing)', () => {
  test('the billing-cycle toggle never shows a static hardcoded discount like (-10%) or (-25%)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await loginAs(page, 'admin@test.com', 'Admin123!');

    await page.goto('/dashboard/billing?tab=subscription');
    const toggle = page.getByRole('group', { name: /billing cycle/i });
    await expect(toggle).toBeVisible();

    for (const cycle of ['monthly', 'quarterly', 'yearly'] as const) {
      await toggle.getByRole('button', { name: CYCLE_LABELS[cycle] }).click();
      await expect(toggle).not.toContainText('-10%');
      await expect(toggle).not.toContainText('-25%');
      await expect(toggle).not.toContainText('(-');
    }
  });

  test('the Starter card renders a $X/mo derived from the real Stripe test-mode price, per cycle', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    test.skip(
      !STRIPE_TEST_MODE_CONFIGURED,
      'No real Stripe test-mode STRIPE_SECRET_KEY / STRIPE_STARTER_*_PRICE_ID configured in ' +
        'this environment (.env ships empty price ids; .env.local carries only a placeholder ' +
        'secret key) — the Starter card deterministically renders "Price unavailable" here, so ' +
        'this dollar-amount assertion is not meaningful locally. The deterministic core is ' +
        'covered by src/lib/billing-prices.test.ts and SubscriptionTab.test.tsx instead.',
    );

    const stripe = new Stripe(STRIPE_SECRET_KEY!, {
      apiVersion: '2026-02-25.clover',
      typescript: true,
    });

    const [monthly, quarterly, yearly] = await Promise.all([
      stripe.prices.retrieve(STARTER_PRICE_IDS.monthly!),
      stripe.prices.retrieve(STARTER_PRICE_IDS.quarterly!),
      stripe.prices.retrieve(STARTER_PRICE_IDS.yearly!),
    ]);

    const expected: Record<'monthly' | 'quarterly' | 'yearly', number | null> = {
      monthly: effectiveMonthlyDollars(monthly),
      quarterly: effectiveMonthlyDollars(quarterly),
      yearly: effectiveMonthlyDollars(yearly),
    };

    await loginAs(page, 'admin@test.com', 'Admin123!');
    await page.goto('/dashboard/billing?tab=subscription');

    const starterCard = page
      .locator('div.relative')
      .filter({ has: page.locator('#plan-btn-starter') });
    const toggle = page.getByRole('group', { name: /billing cycle/i });

    for (const cycle of ['monthly', 'quarterly', 'yearly'] as const) {
      await toggle.getByRole('button', { name: CYCLE_LABELS[cycle] }).click();
      const expectedDollars = expected[cycle];
      expect(
        expectedDollars,
        `Stripe test-mode ${cycle} price must be a valid recurring price`,
      ).not.toBeNull();
      await expect(starterCard).toContainText(`$${expectedDollars}`);
      await expect(starterCard).not.toContainText('Price unavailable');
      // Regression guard: the pre-fix UI hardcoded $99 for every cycle.
      if (expectedDollars !== 99) {
        await expect(starterCard).not.toContainText('$99/mo');
      }
    }
  });
});
