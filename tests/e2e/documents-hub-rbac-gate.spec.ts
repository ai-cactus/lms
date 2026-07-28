import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

/**
 * E2E spec: Documents Hub RBAC gate (fix 867cda0).
 *
 * The Document Hub server component now gates on the permission registry
 * (`can(dbRoleToRoleKey(role), 'document.read')`) instead of the coarse
 * `isAdminRole()` — a role without `document.read` (Finance, every worker
 * role) must see the in-page access-denied state, never the org's document
 * list or the Upload button.
 *
 * Acceptance criteria covered:
 *   - An owner (full document.* grants) sees the hub with the Upload button
 *     and the seeded document list (see documents.spec.ts for the shared
 *     admin@test.com fixture).
 *   - A role with no `document.read` grant (Finance — spec-local seed, since
 *     no manager-tier role without document access is seeded by default and
 *     every worker-category role is blocked at the /login form itself before
 *     it could ever reach /dashboard/documents, see rbac-facility-tab.spec.ts's
 *     equivalent note) gets the access-denied card, not a redirect.
 *
 * Live document UPLOAD is out of scope (see documents.spec.ts) — this spec
 * only asserts Hub visibility/gating, reusing the seeded fixture documents.
 */

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

interface SeededFinance {
  userId: string;
  orgId: string;
  facilityId: string;
  subscriptionId: string;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@docs-e2e.invalid`;
}

async function seedFinanceUser(email: string, password: string): Promise<SeededFinance> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const hashed = await bcrypt.hash(password, 10);
    const slug = `docs-test-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const subscriptionId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `DocsTest ${slug}`, slug, email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `DocsTest ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'finance'::"UserRole", true, $4, $5, NOW(), NOW())`,
      [userId, email, hashed, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, email, 'Finance', 'Test', 'Finance Test'],
    );
    // Every future e2e spec that raw-seeds a fresh org must give it an active
    // subscription row — several admin-dashboard flows (billing-paused banner,
    // seat/plan checks) treat a missing row as an inactive org.
    const periodStart = new Date();
    const periodEnd = new Date(periodStart);
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    await client.query(
      `INSERT INTO subscriptions (
         id, organization_id, stripe_subscription_id, stripe_price_id, plan,
         billing_cycle, status, current_period_start, current_period_end,
         cancel_at_period_end, paused_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'growth'::"SubscriptionPlan", 'yearly'::"SubscriptionBillingCycle",
         'active'::"SubscriptionStatus", $5, $6, false, NULL, NOW(), NOW())`,
      [
        subscriptionId,
        orgId,
        `sub_e2e_${crypto.randomBytes(6).toString('hex')}`,
        `price_e2e_${crypto.randomBytes(6).toString('hex')}`,
        periodStart,
        periodEnd,
      ],
    );

    return { userId, orgId, facilityId, subscriptionId };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: SeededFinance): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM subscriptions WHERE id = $1`, [seeded.subscriptionId]);
    await client.query(`DELETE FROM profiles WHERE id = $1`, [seeded.userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.userId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

async function login(page: Page, email: string, password: string): Promise<void> {
  // Unique source IP per login so the in-memory rate-limit bucket doesn't
  // accumulate across specs sharing a reused dev server.
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 15000 });
}

test.describe('Documents Hub — document.read RBAC gate', () => {
  test('an owner (full document.* grants) sees the hub with Upload and the org document list', async ({
    page,
  }) => {
    await login(page, 'admin@test.com', 'Admin123!');
    await page.goto('/dashboard/documents');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: /upload new/i })).toBeVisible();
    await expect(page.getByRole('row', { name: /e2e-compliance-policy\.pdf/i })).toBeVisible();
    await expect(page.getByText(/don.t have access to documents/i)).toHaveCount(0);
  });

  test('a Finance user (no document.* grants) sees the access-denied card, not the document list', async ({
    page,
  }) => {
    const email = uid('finance');
    const password = 'F1nance!Pass99x';
    const seeded = await seedFinanceUser(email, password);

    try {
      await login(page, email, password);
      await page.goto('/dashboard/documents');
      await page.waitForLoadState('networkidle');

      await expect(page.getByText(/don.t have access to documents/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /upload new/i })).toHaveCount(0);
      await expect(page.getByRole('table')).toHaveCount(0);

      await page.getByRole('link', { name: /back to dashboard/i }).click();
      await page.waitForURL('**/dashboard');
    } finally {
      await cleanup(seeded);
    }
  });
});
