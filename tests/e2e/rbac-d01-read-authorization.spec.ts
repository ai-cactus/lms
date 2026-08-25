import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

/**
 * E2E spec: D-01 — read authorization and facility scoping.
 *
 * D-01 was a Critical defect with TWO different root causes wearing one symptom:
 *
 *   Finance / Clinical Director — hold no `user.read` at all, yet reached the
 *     full staff directory and org-wide audit exports. An ENFORCEMENT gap: read
 *     paths authenticated the session and never consulted the registry.
 *   Facility Supervisor — legitimately holds `user.read` org-wide by grant, but
 *     saw every facility. A SCOPE gap: no facility filter was applied.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RULE FOR THIS FILE — NO ASSERTION MAY BE SATISFIED BY A SIDEBAR LINK BEING
 * ABSENT. Every case navigates by `page.goto()` to a literal URL, or issues
 * `page.request.*`. Navigation-level hiding is what D-01 mistook for
 * authorization; nav visibility is covered by DashboardLayoutClient.test.tsx and
 * is not evidence of anything here.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Acceptance criteria covered:
 *   1. Finance is denied /dashboard/staff, /dashboard/audit-reports and every
 *      auditor export endpoint, and no seeded email appears in any response body.
 *   2. Clinical Director is denied the roster by direct URL (nav was already
 *      hidden — that was never the point).
 *   3. Supervisor(A) sees only facility-A staff, and gets a 404 (NOT 403) on a
 *      facility-B profile — a 403 would confirm the person exists.
 *   4. HR still sees BOTH facilities. This is the anti-over-fix case: HR is
 *      org-wide by design (ORG_WIDE_FACILITY_ROLES) and TC-HR-001 passed. If
 *      this goes red the fix over-reached, which is its own defect.
 */

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

const PASSWORD = 'D01Test123!';

interface Seeded {
  orgId: string;
  facilityAId: string;
  facilityBId: string;
  subscriptionId: string;
  userIds: string[];
  orgUserIds: string[];
  /** email -> orgUserId, for direct-URL probes */
  byEmail: Record<string, { userId: string; orgUserId: string; email: string }>;
}

const uid = (prefix: string) =>
  `${prefix}-${crypto.randomBytes(4).toString('hex')}@d01-e2e.invalid`;

async function seed(): Promise<Seeded> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const hashed = await bcrypt.hash(PASSWORD, 10);
    const slug = `d01-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityAId = crypto.randomUUID();
    const facilityBId = crypto.randomUUID();
    const subscriptionId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `D01 ${slug}`, slug, uid('org')],
    );
    for (const [id, name] of [
      [facilityAId, 'Facility A'],
      [facilityBId, 'Facility B'],
    ] as const) {
      await client.query(
        `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
         VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
        [id, orgId, `${name} ${slug}`],
      );
    }

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
        `sub_d01_${crypto.randomBytes(6).toString('hex')}`,
        `price_d01_${crypto.randomBytes(6).toString('hex')}`,
        periodStart,
        periodEnd,
      ],
    );

    const userIds: string[] = [];
    const orgUserIds: string[] = [];
    const byEmail: Seeded['byEmail'] = {};

    async function member(key: string, role: string, facilityId: string, name: string) {
      const email = uid(key);
      const userId = crypto.randomUUID();
      const orgUserId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
         VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
        [userId, email, hashed, name, 'D01', `${name} D01`],
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
      userIds.push(userId);
      orgUserIds.push(orgUserId);
      byEmail[key] = { userId, orgUserId, email };
      return { userId, orgUserId, email };
    }

    // Managers. Owner is org-wide; supervisor is bound to facility A only.
    await member('owner', 'owner', facilityAId, 'Owner');
    await member('hr', 'hr', facilityAId, 'Hr');
    await member('finance', 'finance', facilityAId, 'Finance');
    await member('cd', 'clinical_director', facilityAId, 'Clinical');
    await member('supA', 'supervisor', facilityAId, 'SupervisorA');

    // Two workers per facility — the data that must or must not be visible.
    await member('workerA1', 'nurse', facilityAId, 'WorkerA1');
    await member('workerA2', 'nurse', facilityAId, 'WorkerA2');
    await member('workerB1', 'nurse', facilityBId, 'WorkerB1');
    await member('workerB2', 'nurse', facilityBId, 'WorkerB2');

    return { orgId, facilityAId, facilityBId, subscriptionId, userIds, orgUserIds, byEmail };
  } finally {
    await client.end();
  }
}

/**
 * Teardown. Deleting the organization cascades organization_users,
 * organization_user_facilities, invites, subscriptions and facilities (every
 * one of those relations is `onDelete: Cascade` onto Organization), so the org
 * goes first and `users` — which is NOT org-scoped — goes after.
 *
 * Best-effort by design. A teardown hiccup must never mark a passing security
 * assertion as failed; on the first CI run it did exactly that, reporting the
 * HR anti-over-fix test as red when every assertion in it had in fact passed.
 * The e2e database is disposable and reseeded per run, so a residual row is
 * cheaper than a false red on a security guard.
 */
async function cleanup(s: Seeded): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  try {
    await client.connect();
    await client.query(`DELETE FROM organizations WHERE id = $1`, [s.orgId]);
    await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [s.userIds]);
  } catch (error) {
    console.warn('[d01] cleanup did not complete:', (error as Error).message);
  } finally {
    await client.end().catch(() => {});
  }
}

async function login(page: Page, email: string): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 20000 });
}

let seeded: Seeded;

test.beforeAll(async () => {
  seeded = await seed();
});

test.afterAll(async () => {
  if (seeded) await cleanup(seeded);
});

test.describe('D-01 — Finance is denied every roster and audit surface', () => {
  test('cannot read the staff roster by direct URL, and no staff email leaks', async ({ page }) => {
    await login(page, seeded.byEmail.finance.email);

    await page.goto('/dashboard/staff');
    await page.waitForLoadState('networkidle');

    // The load-bearing assertion: not "the link is hidden", but "the bytes are
    // not in the response".
    const body = await page.content();
    expect(body).not.toContain(seeded.byEmail.workerA1.email);
    expect(body).not.toContain(seeded.byEmail.workerB1.email);
  });

  test('cannot reach /dashboard/audit-reports by direct URL', async ({ page }) => {
    await login(page, seeded.byEmail.finance.email);

    await page.goto('/dashboard/audit-reports');
    await page.waitForLoadState('networkidle');

    expect(page.url()).not.toContain('/audit-reports');
  });

  test('GET /api/auditor/export returns 403 and no email in the body', async ({ page }) => {
    await login(page, seeded.byEmail.finance.email);

    const res = await page.request.get('/api/auditor/export');
    expect(res.status()).toBe(403);
    expect(await res.text()).not.toContain(seeded.byEmail.workerA1.email);
  });

  test('POST /api/auditor/export/start returns 403', async ({ page }) => {
    await login(page, seeded.byEmail.finance.email);

    const res = await page.request.post('/api/auditor/export/start', {
      data: { scope: 'org' },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('D-01 — Clinical Director is denied the roster by direct URL', () => {
  test('the nav was already hidden; the URL is what mattered', async ({ page }) => {
    await login(page, seeded.byEmail.cd.email);

    await page.goto('/dashboard/staff');
    await page.waitForLoadState('networkidle');

    const body = await page.content();
    expect(body).not.toContain(seeded.byEmail.workerA1.email);
  });

  test('a staff profile addressed by id does not render', async ({ page }) => {
    await login(page, seeded.byEmail.cd.email);

    await page.goto(`/dashboard/staff/${seeded.byEmail.workerA1.orgUserId}`);
    await page.waitForLoadState('networkidle');

    expect(await page.content()).not.toContain(seeded.byEmail.workerA1.email);
  });
});

test.describe('D-01 — Supervisor is scoped to their own facility', () => {
  test('sees facility-A staff but not facility-B staff', async ({ page }) => {
    await login(page, seeded.byEmail.supA.email);

    await page.goto('/dashboard/staff');
    await page.waitForLoadState('networkidle');

    const body = await page.content();
    expect(body).toContain(seeded.byEmail.workerA1.email);
    expect(body).not.toContain(seeded.byEmail.workerB1.email);
    expect(body).not.toContain(seeded.byEmail.workerB2.email);
  });

  test('a facility-B profile 404s rather than 403s — existence must not be confirmed', async ({
    page,
  }) => {
    await login(page, seeded.byEmail.supA.email);

    const res = await page.goto(`/dashboard/staff/${seeded.byEmail.workerB1.orgUserId}`);

    expect(res?.status()).toBe(404);
    expect(await page.content()).not.toContain(seeded.byEmail.workerB1.email);
  });

  test('the status tracker does not widen to org-wide without a ?facility= param', async ({
    page,
  }) => {
    await login(page, seeded.byEmail.supA.email);

    await page.goto('/dashboard/status-tracker');
    await page.waitForLoadState('networkidle');

    // The unreported fourth surface: scope.mode 'all' used to become "no filter".
    expect(await page.content()).not.toContain(seeded.byEmail.workerB1.email);
  });
});

test.describe('D-01 — HR must NOT be narrowed (TC-HR-001 anti-over-fix)', () => {
  test('HR still sees BOTH facilities — if this fails, the fix over-reached', async ({ page }) => {
    await login(page, seeded.byEmail.hr.email);

    await page.goto('/dashboard/staff');
    await page.waitForLoadState('networkidle');

    const body = await page.content();
    expect(body).toContain(seeded.byEmail.workerA1.email);
    expect(body).toContain(seeded.byEmail.workerB1.email);
  });
});
