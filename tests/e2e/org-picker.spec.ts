/**
 * E2E spec: multi-org login resolution and the org picker (/select-organization).
 *
 * Login resolves which OrganizationUser membership becomes the active session
 * per src/lib/auth/membership.ts `resolveActiveMembership`:
 *   - 0 active memberships  -> onboarding (not covered here — see onboarding-wizard.spec.ts)
 *   - 1 active membership   -> auto-selected silently, NO picker (hard zero-regression
 *                              requirement — every single-org account in this codebase
 *                              today must keep working exactly as before)
 *   - 2+ active memberships -> lands on /select-organization, unless
 *                              User.lastActiveOrganizationId still names one of them
 *
 * Fixtures (prisma/seed.ts):
 *   - admin@test.com / Admin123!      — single membership (owner, e2e-test-org) — zero-regression control.
 *   - multi.org@test.com / MultiOrg123! — TWO active memberships: hr in e2e-test-org,
 *     owner in e2e-second-org.
 *
 * Every test in the 2+-membership describe block resets multi.org@test.com's
 * lastActiveOrganizationId to null immediately beforehand (rather than relying
 * on the one-time `prisma db seed` state), so each test is deterministic
 * regardless of execution order or what a PRIOR test's login may have stamped
 * — see the KNOWN PRODUCT BUG note below for why that stamping matters.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005.
 *   - `npx prisma db seed` has been run against the same DATABASE_URL (creates
 *     the two fixture accounts/orgs; this file's own beforeEach only resets the
 *     mutable lastActiveOrganizationId column, not the fixture rows themselves).
 */
import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';
const MULTI_ORG_USER_ID = '22222222-2222-4222-8222-222222222231';

async function resetLastActiveOrg(): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(`UPDATE users SET last_active_organization_id = NULL WHERE id = $1`, [
      MULTI_ORG_USER_ID,
    ]);
  } finally {
    await client.end();
  }
}

async function login(page: Page, email: string, password: string) {
  // Random per-login IP so parallel/sequential runs don't share the
  // credential-layer rate-limit bucket (see staff-invite-flow.spec.ts).
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

/**
 * Dismiss the "How to get started" first-visit tour modal if it's showing
 * (mounts asynchronously on a dashboard's first-ever visit for a session —
 * same pattern as WorkerWelcomeModal, see manage-learn-switcher.spec.ts).
 * Never throws if it isn't present.
 */
async function dismissGetStartedTour(page: Page): Promise<void> {
  // DashboardEmptyState's close icon has no accessible name (a bare lucide
  // <X>, no aria-label) — target the modal overlay directly and click its
  // first (only) button, the top-right close icon.
  const overlay = page.locator('div.fixed.inset-0.z-50');
  await overlay.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await overlay.isVisible().catch(() => false)) {
    await overlay.locator('button').first().click();
    await overlay.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  }
}

async function logout(page: Page, displayName: string) {
  await dismissGetStartedTour(page);
  // Two-step confirm: dropdown "Logout" opens a dialog whose footer holds the
  // real Logout button — see auth.spec.ts.
  await page.locator('header').getByText(displayName).first().click();
  await page.getByRole('button', { name: 'Logout' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await Promise.all([
    page.waitForURL('**/login**'),
    dialog.getByRole('button', { name: 'Logout' }).click(),
  ]);
}

test.describe('Login membership resolution — zero regression for single-membership accounts', () => {
  test('a single-membership account (admin@test.com) lands directly on /dashboard, never on the org picker', async ({
    page,
  }) => {
    await login(page, 'admin@test.com', 'Admin123!');

    await page.waitForURL('**/dashboard**', { timeout: 45000 });
    expect(page.url()).not.toContain('/select-organization');

    // Confirm this landed on the real dashboard, not an error/loading shell.
    await expect(page.getByRole('link', { name: /^settings$/i })).toBeVisible();
  });

  test('navigating a single-membership session directly to /select-organization redirects straight to /dashboard', async ({
    page,
  }) => {
    await login(page, 'admin@test.com', 'Admin123!');
    await page.waitForURL('**/dashboard**', { timeout: 45000 });

    await page.goto('/select-organization');

    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    expect(page.url()).not.toContain('/select-organization');
  });
});

test.describe('Login membership resolution — 2+ active memberships', () => {
  // These tests share the single seeded 'multi.org@test.com' account and
  // several of them WRITE its persistent lastActiveOrganizationId — running
  // them concurrently across workers races on that shared DB state. Force
  // serial execution within this describe block.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    await resetLastActiveOrg();
  });

  test('a multi-membership account lands on the org picker with both organizations listed', async ({
    page,
  }) => {
    await login(page, 'multi.org@test.com', 'MultiOrg123!');

    await page.waitForURL('**/select-organization**', { timeout: 45000 });
    await expect(page.getByRole('heading', { name: /choose an organization/i })).toBeVisible();

    await expect(page.getByText('E2E Test Organization')).toBeVisible();
    await expect(page.getByText('E2E Second Organization')).toBeVisible();
    // Role labels are shown per-card so the caller knows what they're picking.
    await expect(page.getByText('HR')).toBeVisible();
    await expect(page.getByText('Owner (Organisation Admin)')).toBeVisible();
  });

  test('selecting an organization from the picker activates that membership’s role for the session', async ({
    page,
  }) => {
    await login(page, 'multi.org@test.com', 'MultiOrg123!');
    await page.waitForURL('**/select-organization**', { timeout: 45000 });

    // Pick "E2E Test Organization" — the hr membership. hr does NOT get the
    // Settings nav entry (owner/admin only per the RBAC ruling).
    await page.getByText('E2E Test Organization').click();
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await expect(page.getByRole('link', { name: /^settings$/i })).not.toBeVisible();
  });

  test('selecting the OTHER organization activates the owner membership there, which DOES see Settings', async ({
    page,
  }) => {
    await login(page, 'multi.org@test.com', 'MultiOrg123!');
    await page.waitForURL('**/select-organization**', { timeout: 45000 });

    // Pick "E2E Second Organization" — the owner membership.
    await page.getByText('E2E Second Organization').click();
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await expect(page.getByRole('link', { name: /^settings$/i })).toBeVisible();
  });

  test('after EXPLICITLY selecting an organization once, a fresh login skips the picker (lastActiveOrganizationId remembered)', async ({
    page,
  }) => {
    // First login: pick "E2E Test Organization" — the fully-provisioned
    // primary seed org (subscription, facility docs, etc. already set up),
    // so landing there doesn't trigger the org-activation welcome modal that
    // a bare freshly-created org (E2E Second Organization) would show,
    // which would otherwise block the header click below. This test only
    // cares about the remember mechanic, not which specific org.
    await login(page, 'multi.org@test.com', 'MultiOrg123!');
    await page.waitForURL('**/select-organization**', { timeout: 45000 });
    await page.getByText('E2E Test Organization').click();
    await page.waitForURL('**/dashboard**', { timeout: 15000 });

    await logout(page, 'Morgan Multi');
    await login(page, 'multi.org@test.com', 'MultiOrg123!');

    await page.waitForURL('**/dashboard**', { timeout: 45000 });
    expect(page.url()).not.toContain('/select-organization');
    // Still the remembered (hr, first org) membership — hr has no Settings nav.
    await expect(page.getByRole('link', { name: /^settings$/i })).not.toBeVisible();
  });

  /**
   * KNOWN PRODUCT BUG (do not weaken this assertion to force a pass — see
   * bug-hunter's final report for full detail):
   *
   * src/lib/create-auth-instance.ts's credentials `authorize()` (line ~316)
   * and the Microsoft OAuth `signIn` callback (line ~509) both call
   * `recordMembershipLogin(user.id, membership)` unconditionally whenever
   * `membership` is non-null — including the `'choice'` resolution case,
   * where `activeMembershipOf()` (line ~92) provisionally defaults
   * `membership` to `resolution.memberships[0]` (the first-joined org) purely
   * so THIS session's JWT has somewhere to point, per that function's own
   * comment: "the session must always be scoped to a real membership... the
   * first (oldest-joined) one is provisionally activated."
   *
   * `recordMembershipLogin` writes that provisional default to
   * `User.lastActiveOrganizationId`, and `resolveActiveMembership` treats any
   * non-null `lastActiveOrganizationId` matching an active membership as a
   * genuine remembered pick (kind: 'resolved', skip the picker). The result:
   * the org picker only ever appears on a multi-org account's VERY FIRST
   * login. Every subsequent login — even if the user never once visited
   * /select-organization or clicked anything — silently and durably commits
   * to the first-joined org. This defeats the picker for every login after
   * the first.
   *
   * Expected fix (not implemented here — this is a bug report, not a fix):
   * `recordMembershipLogin` should only be called for `resolution.kind ===
   * 'resolved'` (a true single-membership account, or an already-remembered
   * pick), not for a fresh `'choice'` resolution's provisional default.
   */
  test('logging in twice without ever picking an organization shows the picker BOTH times (no accidental remembering)', async ({
    page,
  }) => {
    await login(page, 'multi.org@test.com', 'MultiOrg123!');
    await page.waitForURL('**/select-organization**', { timeout: 45000 });

    // The picker page itself has no header/logout affordance (it's a bare
    // pre-dashboard shell) — end this session by clearing cookies directly
    // rather than through the UI, then start a genuinely fresh login.
    await page.context().clearCookies();
    await login(page, 'multi.org@test.com', 'MultiOrg123!');

    await page.waitForURL('**/select-organization**', { timeout: 45000 });
    expect(page.url()).toContain('/select-organization');
  });
});
