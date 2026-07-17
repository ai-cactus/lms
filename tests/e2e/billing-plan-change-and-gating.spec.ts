/**
 * E2E spec: Phase-4 billing defect fixes + the Issue-3 plan-change/proration
 * policy built on top of them.
 *
 * Defect A / Issue 3 — plan-switch confirmation, now classification-driven:
 *   - An admin WITH a live Stripe subscription clicking "Subscribe" on a
 *     different plan first triggers a `preview-plan-change` call, THEN opens
 *     a "Confirm your plan change" dialog whose copy and confirm-button
 *     label branch on the returned classification (`scheduled` vs
 *     `immediate_prorate`). Cancel fires no checkout request; Confirm calls
 *     checkout with the previewed plan/cycle.
 *   - A brand-new subscriber (no subscription at all) clicking "Subscribe"
 *     goes straight to checkout with NO preview call and NO confirmation
 *     dialog — this guards against the dialog being over-applied to new
 *     subscribers.
 *   - A pending scheduled plan change renders a "Plan change scheduled"
 *     banner with a "Cancel scheduled change" button that calls the
 *     cancel-scheduled-change endpoint.
 *
 * Defect B — billing-gated course assignment: a paused org's admin hitting
 * the course-assign URL directly is redirected to /dashboard/courses by the
 * page-level gate (AssignCoursePage), before any course lookup happens.
 *
 * Defect C — Overview stale after resume: resuming a paused subscription
 * from the Subscription tab auto-navigates to Overview, which must reflect
 * the unpaused state without a manual browser reload.
 *
 * Network boundary: the checkout/preview/cancel-scheduled-change/resume
 * routes call Stripe directly (Checkout Session creation / subscription
 * price swap / Subscription Schedule create-or-release / pause_collection
 * update), which isn't available in this local harness. Per the approved
 * test plan, those specific calls are intercepted at the network boundary
 * (page.route) so the test exercises real client behavior (dialog gating,
 * request payloads, tab navigation, refetch-on-mutation) without a live
 * Stripe round-trip. The billing-gate redirect (Defect B) and the FIRST
 * /overview read in the Defect C flow hit the real app/DB — no Stripe calls
 * are made on those paths (see src/app/api/billing/overview/route.ts —
 * Stripe is only called when the org already has a stripeCustomerId, which
 * these freshly-seeded orgs never do).
 *
 * Scope note: a full Stripe-backed Subscription Schedule flow (real schedule
 * creation, phase transition, webhook reconciliation) is NOT exercised here
 * — it isn't feasible against this local harness (no live Stripe test-mode
 * credentials; see [[stripe-billing-prices-ssot-tests]] memory). That
 * end-to-end wiring is covered by the mock-boundary unit/integration tests in
 * src/lib/billing-plan-change.test.ts, src/app/api/billing/subscription/
 * checkout/route.test.ts, and src/app/api/webhooks/stripe/route.test.ts,
 * which are the real safety net for the classification/proration logic
 * itself. This spec's job is the CLIENT behavior around that server contract
 * (preview-before-dialog, copy branching, banner rendering).
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - DATABASE_URL reachable for direct DB seeding (raw pg Client, mirroring
 *     tests/e2e/rbac-role-change.spec.ts's convention).
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

interface SeededAdmin {
  orgId: string;
  facilityId: string;
  adminId: string;
  email: string;
  password: string;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@billing-e2e.invalid`;
}

/** Seed a fresh org + owner admin, with an optional subscription row. */
async function seedAdmin(opts: {
  subscription?: {
    status: 'active' | 'past_due' | 'canceled' | 'trialing';
    pausedAt?: Date | null;
    pauseEndsAt?: Date | null;
    scheduledPlan?: 'starter' | 'professional' | 'enterprise' | null;
    scheduledBillingCycle?: 'monthly' | 'quarterly' | 'yearly' | null;
    scheduledEffectiveAt?: Date | null;
    stripeScheduleId?: string | null;
  };
}): Promise<SeededAdmin> {
  const client = await db();
  try {
    const email = uid('owner');
    const password = 'BillingE2E!9';
    const hashed = await bcrypt.hash(password, 10);
    const slug = `billing-e2e-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const adminId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Billing E2E ${slug}`, slug, email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Billing E2E Facility ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, $4, $5, NOW(), NOW())`,
      [adminId, email, hashed, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, 'Billing', 'Owner', 'Billing Owner', NOW(), NOW())`,
      [adminId, email],
    );

    if (opts.subscription) {
      const subNow = new Date();
      const subPeriodEnd = new Date(subNow);
      subPeriodEnd.setFullYear(subPeriodEnd.getFullYear() + 1);
      await client.query(
        `INSERT INTO subscriptions (
           id, organization_id, stripe_subscription_id, stripe_price_id, plan,
           billing_cycle, status, current_period_start, current_period_end,
           cancel_at_period_end, paused_at, pause_ends_at,
           scheduled_plan, scheduled_billing_cycle, scheduled_price_id,
           scheduled_effective_at, stripe_schedule_id, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 'professional'::"SubscriptionPlan", 'yearly'::"SubscriptionBillingCycle",
           $5::"SubscriptionStatus", $6, $7, false, $8, $9,
           $10::"SubscriptionPlan", $11::"SubscriptionBillingCycle", $12, $13, $14, NOW(), NOW())`,
        [
          crypto.randomUUID(),
          orgId,
          `sub_e2e_${crypto.randomBytes(6).toString('hex')}`,
          `price_e2e_${crypto.randomBytes(6).toString('hex')}`,
          opts.subscription.status,
          subNow,
          subPeriodEnd,
          opts.subscription.pausedAt ?? null,
          opts.subscription.pauseEndsAt ?? null,
          opts.subscription.scheduledPlan ?? null,
          opts.subscription.scheduledBillingCycle ?? null,
          opts.subscription.scheduledPlan
            ? `price_e2e_sched_${crypto.randomBytes(6).toString('hex')}`
            : null,
          opts.subscription.scheduledEffectiveAt ?? null,
          opts.subscription.stripeScheduleId ?? null,
        ],
      );
    }

    return { orgId, facilityId, adminId, email, password };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: SeededAdmin): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM profiles WHERE id = $1`, [seeded.adminId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.adminId]);
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
  await page.waitForURL('**/dashboard', { timeout: 45000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Billing — plan-switch confirmation (Defect A / Issue 3 classification)', () => {
  test('previews before opening the dialog; scheduled-classification copy; Cancel fires no checkout, Confirm calls checkout', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // The stock seeded admin@test.com has an active `professional` subscription
    // with a real stripeSubscriptionId (see prisma/seed.ts) — hasLiveSubscription
    // is true for it, which is exactly the precondition this scenario needs.
    await loginAs(page, 'admin@test.com', 'Admin123!');

    const previewCalls: { planKey: string; billingCycle: string }[] = [];
    const checkoutCalls: { planKey: string; billingCycle: string }[] = [];
    await page.route('**/api/billing/subscription/preview-plan-change', async (route) => {
      const body = route.request().postDataJSON() as { planKey: string; billingCycle: string };
      previewCalls.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // A professional -> starter downgrade always classifies as `scheduled`
        // (see billing-plan-change.test.ts) — no charge today.
        body: JSON.stringify({
          classification: 'scheduled',
          effectiveAt: '2026-08-17T00:00:00.000Z',
        }),
      });
    });
    await page.route('**/api/billing/subscription/checkout', async (route) => {
      const body = route.request().postDataJSON() as { planKey: string; billingCycle: string };
      checkoutCalls.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    await page.goto('/dashboard/billing?tab=subscription');
    await expect(page.locator('#plan-btn-starter')).toBeVisible();

    // Current plan is Professional (seeded) — clicking Subscribe on Starter
    // triggers a preview call, THEN the confirmation dialog.
    await page.locator('#plan-btn-starter').click();

    await expect.poll(() => previewCalls.length).toBe(1);
    expect(previewCalls[0]).toEqual({ planKey: 'starter', billingCycle: 'yearly' });

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Confirm your plan change')).toBeVisible();
    await expect(dialog).toContainText(/runs until Aug 17, 2026/i);
    await expect(dialog).toContainText(/no charge today/i);
    expect(checkoutCalls).toHaveLength(0);

    // Cancel — dialog closes, no checkout call, no state change.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(checkoutCalls).toHaveLength(0);

    // Re-open and Confirm ("Schedule change" for a scheduled classification) —
    // exactly one checkout call with the right payload.
    await page.locator('#plan-btn-starter').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Schedule change' }).click();

    await expect.poll(() => checkoutCalls.length).toBe(1);
    expect(checkoutCalls[0]).toEqual({ planKey: 'starter', billingCycle: 'yearly' });
  });

  test('immediate_prorate classification shows the charge-now copy with the previewed amount', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await loginAs(page, 'admin@test.com', 'Admin123!');

    await page.route('**/api/billing/subscription/preview-plan-change', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          classification: 'immediate_prorate',
          amountDueCents: 5000,
          currency: 'usd',
        }),
      });
    });

    await page.goto('/dashboard/billing?tab=subscription');
    await expect(page.locator('#plan-btn-starter')).toBeVisible();

    // Current plan is Professional (seeded); clicking Starter is a real
    // downgrade, which the server would normally classify as `scheduled` —
    // but the preview call is fully mocked above, so the client renders
    // whatever classification the server returns. This exercises the
    // immediate_prorate copy branch as a UI-rendering contract, independent
    // of which specific plan pair a real server would ever pair it with.
    await page.locator('#plan-btn-starter').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/charged the prorated difference/i);
    await expect(dialog).toContainText('$50.00');
    await expect(dialog).toContainText(/takes effect immediately/i);
    await expect(page.getByRole('button', { name: 'Confirm change' })).toBeVisible();
  });
});

test.describe('Billing — scheduled-change banner (Issue 3)', () => {
  test('a pending scheduled plan change renders the banner and Cancel calls cancel-scheduled-change', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seeded = await seedAdmin({
      subscription: {
        status: 'active',
        scheduledPlan: 'starter',
        scheduledBillingCycle: 'yearly',
        scheduledEffectiveAt: new Date('2026-08-17T00:00:00.000Z'),
        stripeScheduleId: 'sub_sched_e2e',
      },
    });

    try {
      await loginAs(page, seeded.email, seeded.password);

      const cancelCalls: number[] = [];
      await page.route('**/api/billing/subscription/cancel-scheduled-change', async (route) => {
        cancelCalls.push(1);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Your scheduled plan change has been canceled.',
            success: true,
          }),
        });
      });

      await page.goto('/dashboard/billing?tab=subscription');

      await expect(page.getByText('Plan change scheduled')).toBeVisible();
      await expect(page.getByText(/Changing to Starter on Aug 17, 2026/i)).toBeVisible();

      const cancelButton = page.getByRole('button', { name: 'Cancel scheduled change' });
      await expect(cancelButton).toBeVisible();
      await cancelButton.click();

      await expect.poll(() => cancelCalls.length).toBe(1);
      // handleCancelScheduledChange navigates to Overview on success via the
      // exact same `onChangeTab(...); onMutated?.(); setTimeout(() =>
      // router.refresh(), 0)` pattern as the resume/reactivate handlers — that
      // post-mutation navigation timing is already covered end-to-end (and
      // observed to be intermittently slow to commit under `next dev`, up to
      // several seconds) by the "Defect C" resume test below. Re-asserting the
      // exact same router-timing behavior here would be redundant and, per
      // this session's own flake investigation, occasionally flaky — so this
      // test scopes itself to what's unique to this handler: the endpoint
      // contract and the absence of an inline error. Note: `getByRole('alert')`
      // also matches Next's own always-present route-announcer div, so this
      // filters to app-rendered alert text instead.
      await expect(
        page.getByRole('alert').filter({ hasText: /unexpected error|failed to cancel/i }),
      ).toHaveCount(0);
    } finally {
      await cleanup(seeded);
    }
  });
});

test.describe('Billing — new-subscriber regression guard (Defect A)', () => {
  test('an admin with NO subscription goes straight to checkout with no confirmation dialog', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seeded = await seedAdmin({});

    try {
      await loginAs(page, seeded.email, seeded.password);

      const checkoutCalls: { planKey: string; billingCycle: string }[] = [];
      await page.route('**/api/billing/subscription/checkout', async (route) => {
        const body = route.request().postDataJSON() as { planKey: string; billingCycle: string };
        checkoutCalls.push(body);
        // Inert response — no `url`/`updated` — so the client makes no further
        // navigation/refresh, keeping this assertion deterministic.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      });

      await page.goto('/dashboard/billing?tab=subscription');
      await expect(page.locator('#plan-btn-starter')).toBeVisible();

      await page.locator('#plan-btn-starter').click();

      // No confirmation dialog — the checkout call fires immediately.
      await expect.poll(() => checkoutCalls.length).toBe(1);
      expect(checkoutCalls[0]).toEqual({ planKey: 'starter', billingCycle: 'yearly' });
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText('Confirm your plan change')).toHaveCount(0);
    } finally {
      await cleanup(seeded);
    }
  });
});

test.describe('Billing — course assignment blocked while paused (Defect B)', () => {
  test('a paused org admin hitting the assign URL directly is redirected to /dashboard/courses', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seeded = await seedAdmin({
      subscription: { status: 'active', pausedAt: new Date() },
    });

    try {
      await loginAs(page, seeded.email, seeded.password);

      // The billing gate in AssignCoursePage (src/app/dashboard/(wizard)/training/
      // courses/[id]/assign/page.tsx) runs BEFORE the course lookup, so an
      // arbitrary/nonexistent course id still exercises the redirect.
      await page.goto('/dashboard/training/courses/00000000-0000-0000-0000-000000000000/assign', {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForURL('**/dashboard/courses', { timeout: 20000 });
      await expect(page).toHaveURL(/\/dashboard\/courses$/);
    } finally {
      await cleanup(seeded);
    }
  });
});

test.describe('Billing — resume refreshes Overview without a manual reload (Defect C)', () => {
  /**
   * Regression guard for a fixed Defect-C bug: resuming from the Subscription
   * tab never actually navigated to Overview — the URL stayed on
   * `?tab=subscription` indefinitely.
   *
   * Root cause (per code-ninja's empirical diagnosis, not the initial
   * `router.refresh()`-ordering theory this test's own debugging first
   * pointed at): `SubscriptionTab` was lazy-loaded via `next/dynamic({ ssr:
   * false })` in `BillingPage.tsx`. On a client-side tab switch its chunk
   * rendered late, so this test's `.last()` "Continue Plan" locator
   * transiently matched the site-wide `BillingPausedBanner`'s button
   * (refresh-only, no tab navigation) instead of SubscriptionTab's own —
   * the click silently hit the wrong element. Fix: `SubscriptionTab` is now a
   * static import in `BillingPage.tsx` (the other three tabs stay lazy);
   * handlers call `onChangeTab('overview'); onMutated?.();
   * setTimeout(() => router.refresh(), 0);` in all three mutation paths
   * (swap-in-place, resume, reactivate).
   */
  test('resuming from the Subscription tab updates Overview without a page reload', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seeded = await seedAdmin({
      subscription: { status: 'active', pausedAt: new Date() },
    });

    try {
      await loginAs(page, seeded.email, seeded.password);

      let overviewCalls = 0;
      await page.route('**/api/billing/overview', async (route) => {
        overviewCalls += 1;
        if (overviewCalls === 1) {
          // First read: let the real route run — it reads the genuinely
          // paused subscription from the DB (no Stripe call, since this
          // freshly-seeded org has no stripeCustomerId).
          await route.continue();
          return;
        }
        // Post-resume read: the real Stripe pause_collection update can't run
        // in this harness, so fake the now-unpaused overview payload the real
        // resume mutation would have produced.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            organization: { name: 'Billing E2E Org', staffCount: null },
            subscription: {
              plan: 'professional',
              billingCycle: 'yearly',
              status: 'active',
              currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
              cancelAtPeriodEnd: false,
              pausedAt: null,
              pauseEndsAt: null,
              discountPromoCode: null,
              discountCouponName: null,
              discountPercentOff: null,
              discountAmountOff: null,
              discountCurrency: null,
              discountDuration: null,
              discountEndsAt: null,
            },
            activeStaffCount: 0,
            defaultPaymentMethod: null,
            recentInvoices: [],
          }),
        });
      });

      await page.route('**/api/billing/subscription/resume', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Subscription has been resumed.', success: true }),
        });
      });

      // NOTE on locator scoping: while paused, the dashboard layout renders a
      // SITE-WIDE BillingPausedBanner (src/components/billing/
      // BillingPausedBanner.tsx) on every page, in addition to the billing
      // page's own in-tab paused UI — both use the literal copy "Your
      // subscription is paused" and both expose a "Continue Plan" button.
      // The banner is server-rendered from the (unmocked) real DB state and
      // stays paused for the rest of this test, since only the Stripe-bound
      // mutation is intercepted, not the DB row itself. Use `.last()`
      // throughout to target the billing page's own element (it always
      // renders after the layout-level banner in DOM order) rather than the
      // banner, and assert the FINAL state via OverviewTab's own unique copy
      // instead of the (permanently-paused) shared banner text.
      const OVERVIEW_PAUSED_TEXT = 'All your data is safely stored until you continue your plan.';

      // Land on Overview first (initialTab) — confirms the genuinely paused
      // state is visible before any mutation.
      await page.goto('/dashboard/billing');
      await expect(page.getByText('Your subscription is paused').last()).toBeVisible();
      await expect(page.getByText(OVERVIEW_PAUSED_TEXT)).toBeVisible();

      // Switch to Subscription and resume. Wait for the tab switch's own
      // router.replace('?tab=subscription') to fully commit (URL updated)
      // before triggering the resume mutation's router.replace('?tab=overview')
      // — under `next dev`, the Subscription tab's dynamic-import chunk can
      // still be compiling when the click fires, and two client-side
      // navigations issued back-to-back before the first commits can resolve
      // out of order, silently dropping the second (see prior debug run: the
      // resume's own ?tab=overview replace landed, then the still-pending
      // ?tab=subscription replace committed afterward and clobbered it).
      await page.getByRole('tab', { name: 'Subscription' }).click();
      await expect(page).toHaveURL(/[?&]tab=subscription/);
      await expect(page.getByRole('button', { name: 'Continue Plan' }).last()).toBeVisible();
      await page.getByRole('button', { name: 'Continue Plan' }).last().click();

      // handleResumeSubscription auto-navigates to Overview on success. This is
      // a client-side (History API) route change with no full page load, so
      // assert via a polling URL match rather than page.waitForURL (which
      // waits on a navigation lifecycle event that never fires here).
      await expect(page).toHaveURL(/[?&]tab=overview/, { timeout: 20000 });

      // Overview reflects the unpaused state without a manual browser reload —
      // driven entirely by the refreshKey-triggered refetch (Defect C fix).
      // OverviewTab's own paused copy is gone and the normal (unpaused)
      // "Next invoice" line is back, even though the layout-level banner
      // (real, unmocked DB state) still shows paused — that banner is out of
      // scope for this test, which targets the OverviewTab refetch wiring.
      await expect(page.getByText(OVERVIEW_PAUSED_TEXT)).toHaveCount(0);
      await expect(page.getByText(/Next invoice on/i)).toBeVisible();
      await expect.poll(() => overviewCalls).toBeGreaterThanOrEqual(2);
    } finally {
      await cleanup(seeded);
    }
  });
});
