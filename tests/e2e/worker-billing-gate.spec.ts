/**
 * E2E spec: worker portal billing gate (TC-041-B).
 *
 * Product decision: workers must NOT access the training portal while their
 * organization's billing is paused or otherwise inactive. `WorkerLayout`
 * (src/app/worker/layout.tsx) now fetches the org's subscription and renders
 * `WorkerBillingBlockedScreen` IN PLACE (never a redirect, to avoid looping
 * with the login guard) whenever `hasActiveBilling()` is false.
 *
 * This spec drives the real DB-level state transition (pause → resume) and
 * confirms the worker-facing UI reacts to it — it is the one piece of this
 * regression the unit suite (src/app/worker/layout.test.tsx) cannot cover,
 * since that test calls the Server Component function directly rather than
 * a live login + navigation.
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
  workerId: string;
  email: string;
  password: string;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@worker-billing-gate-e2e.invalid`;
}

/** Seed a fresh org + a worker (nurse) in it, with a subscription row. */
async function seedWorker(opts: {
  status: 'active' | 'past_due' | 'canceled' | 'trialing';
  pausedAt?: Date | null;
}): Promise<Seeded> {
  const client = await db();
  try {
    const email = uid('worker');
    const password = 'WorkerGate!E2E9';
    const hashed = await bcrypt.hash(password, 10);
    const slug = `worker-gate-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const workerId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Worker Billing Gate ${slug}`, slug, email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Worker Billing Gate Facility ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", true, $4, $5, NOW(), NOW())`,
      [workerId, email, hashed, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, 'Gate', 'Worker', 'Gate Worker', NOW(), NOW())`,
      [workerId, email],
    );

    const subNow = new Date();
    const subPeriodEnd = new Date(subNow);
    subPeriodEnd.setFullYear(subPeriodEnd.getFullYear() + 1);
    await client.query(
      `INSERT INTO subscriptions (
         id, organization_id, stripe_subscription_id, stripe_price_id, plan,
         billing_cycle, status, current_period_start, current_period_end,
         cancel_at_period_end, paused_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'professional'::"SubscriptionPlan", 'yearly'::"SubscriptionBillingCycle",
         $5::"SubscriptionStatus", $6, $7, false, $8, NOW(), NOW())`,
      [
        crypto.randomUUID(),
        orgId,
        `sub_e2e_${crypto.randomBytes(6).toString('hex')}`,
        `price_e2e_${crypto.randomBytes(6).toString('hex')}`,
        opts.status,
        subNow,
        subPeriodEnd,
        opts.pausedAt ?? null,
      ],
    );

    return { orgId, facilityId, workerId, email, password };
  } finally {
    await client.end();
  }
}

async function setPaused(orgId: string, pausedAt: Date | null): Promise<void> {
  const client = await db();
  try {
    await client.query(`UPDATE subscriptions SET paused_at = $1 WHERE organization_id = $2`, [
      pausedAt,
      orgId,
    ]);
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM profiles WHERE id = $1`, [seeded.workerId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.workerId]);
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

test.describe('Worker portal billing gate (TC-041-B)', () => {
  test('a paused org shows the blocking screen instead of the dashboard; resuming restores access', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seeded = await seedWorker({ status: 'active', pausedAt: new Date() });

    try {
      await loginAs(page, seeded.email, seeded.password);
      await page.waitForURL('**/worker**', { timeout: 45000 });

      await expect(page.getByText(/training temporarily unavailable/i)).toBeVisible({
        timeout: 15000,
      });
      await expect(
        page.getByText(/organization.s access is paused.*contact your administrator/i),
      ).toBeVisible();
      // The real worker dashboard chrome must not render alongside the block.
      await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();

      // Resume billing at the DB level (mirrors the admin clicking "Resume" on
      // the Subscription tab) and confirm the SAME session regains access on
      // its next navigation — no re-login required.
      await setPaused(seeded.orgId, null);
      await page.goto('/worker');

      await expect(page.getByText(/training temporarily unavailable/i)).toHaveCount(0, {
        timeout: 15000,
      });
    } finally {
      await cleanup(seeded);
    }
  });

  test('an org with no subscription row at all is also blocked (missing row = inactive)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    // Seed active/unpaused first (so seedWorker's INSERT succeeds), then delete
    // the subscription row entirely to exercise the "no subscription" branch.
    const seeded = await seedWorker({ status: 'active', pausedAt: null });
    const client = await db();
    try {
      await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [seeded.orgId]);
    } finally {
      await client.end();
    }

    try {
      await loginAs(page, seeded.email, seeded.password);
      await page.waitForURL('**/worker**', { timeout: 45000 });

      await expect(page.getByText(/training temporarily unavailable/i)).toBeVisible({
        timeout: 15000,
      });
    } finally {
      await cleanup(seeded);
    }
  });

  test('an active, unpaused org reaches the real worker dashboard', async ({ page }) => {
    test.setTimeout(90_000);
    const seeded = await seedWorker({ status: 'active', pausedAt: null });

    try {
      await loginAs(page, seeded.email, seeded.password);
      await page.waitForURL('**/worker**', { timeout: 45000 });

      await expect(page.getByText(/training temporarily unavailable/i)).toHaveCount(0);
    } finally {
      await cleanup(seeded);
    }
  });
});
