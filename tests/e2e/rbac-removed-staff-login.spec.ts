/**
 * E2E spec: QA ISSUE 2 — a removed ("deleted") staff member could still reach
 * a `/dashboard` shell after being removed from their organization.
 *
 * Fix (see the approved plan, `.claude/agent-memory` history, and
 * src/lib/create-auth-instance.ts / src/app/actions/{auth,staff}.ts):
 *   - `removeStaff()` now nulls `organizationId` AND bumps `sessionVersion` in
 *     the same write, so any LIVE session is invalidated on its next JWT
 *     re-validation (the existing F-059 kill-switch).
 *   - `authenticate()` short-circuits with a specific, actionable error for a
 *     non-owner admin-tier account with no organization (i.e. already removed)
 *     before ever attempting a fresh login.
 *   - `authorize()` and `jwt()` in create-auth-instance.ts independently deny
 *     the same state (defense-in-depth), scoped to the ADMIN instance only —
 *     `owner` is the only legitimate org-less admin-tier state (mid-onboarding),
 *     and org-less WORKER accounts are an unrelated, expected pre-onboarding
 *     state that must keep reaching /onboarding-worker.
 *
 * Tier 3 5.1 update (commits 56a3eab / 66aa961): a short-TTL Redis cache
 * (`src/lib/auth/session-revalidation-cache.ts`, default 30s,
 * `AUTH_REVALIDATE_TTL_SECONDS`) now sits in front of the `jwt()` callback's
 * DB re-validation. That alone would have masked a removal for up to the TTL.
 * `removeStaff()` (and every other `sessionVersion`-bumping action) now also
 * calls `invalidateRevalidationCache(userId)` immediately after its write, so
 * the "killed on next navigation" guarantee below holds at the DEFAULT TTL via
 * the real production path — see the "real removeStaff() action" test. A
 * write that bypasses every server action (e.g. raw SQL) still has no active
 * bust and is genuinely bounded by the TTL only — see the "out-of-band" test
 * immediately after it, and the fast, deterministic proof that it eventually
 * self-heals in `src/lib/create-auth-instance.cache-integration.test.ts`
 * ("TTL backstop vs. active invalidation for a sessionVersion bump").
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - DATABASE_URL reachable for direct DB seeding/mutation.
 */

import { test, expect } from '@playwright/test';
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

type UserRole =
  | 'owner'
  | 'supervisor'
  | 'hr'
  | 'clinical_director'
  | 'finance'
  | 'nurse'
  | 'therapist_clinician';

interface Seeded {
  userId: string;
  orgUserId: string | null;
  orgId: string | null;
  facilityId: string | null;
}

/**
 * Seed a single user (global identity).
 *
 * `membership` controls what OrganizationUser state — if any — is attached:
 *   - 'none'    — no organization_users row at all. resolveActiveMembership()
 *                 returns { kind: 'none' } — the legitimate pre-onboarding
 *                 state (a founder who never created an org, or a self-serve
 *                 worker who never joined one).
 *   - 'active'  — a normal, active membership.
 *   - 'revoked' — an org + facility + an organization_users row that IS
 *                 deactivated (active=false, deactivated_at set) — this is
 *                 what "removed staff" actually looks like under the
 *                 multi-org schema: resolveActiveMembership() returns
 *                 { kind: 'revoked' }, not 'none'. See src/lib/auth/membership.ts.
 */
async function seedUser(opts: {
  email: string;
  password: string;
  role: UserRole;
  membership: 'none' | 'active' | 'revoked';
}): Promise<Seeded> {
  const client = await db();
  try {
    const hashed = await bcrypt.hash(opts.password, 10);
    const orgSlug = `rmv-test-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const orgUserId = crypto.randomUUID();

    let resolvedOrgId: string | null = null;
    let resolvedFacilityId: string | null = null;
    let resolvedOrgUserId: string | null = null;

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Test', 'User', 'Test User', NOW(), NOW())`,
      [userId, opts.email, hashed],
    );

    if (opts.membership !== 'none') {
      await client.query(
        `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
         VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
        [orgId, `Removed-Staff Test ${orgSlug}`, orgSlug, opts.email],
      );
      await client.query(
        `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
         VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
        [facilityId, orgId, `Removed-Staff Test ${orgSlug}`],
      );

      const active = opts.membership === 'active';
      await client.query(
        `INSERT INTO organization_users (id, user_id, organization_id, role, active, deactivated_at, joined_at, role_assigned_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4::\"UserRole\", $5, $6, NOW(), NOW(), NOW(), NOW())`,
        [orgUserId, userId, orgId, opts.role, active, active ? null : new Date()],
      );
      await client.query(
        `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
         VALUES ($1, $2, $3, true, NOW())`,
        [crypto.randomUUID(), orgUserId, facilityId],
      );

      resolvedOrgId = orgId;
      resolvedFacilityId = facilityId;
      resolvedOrgUserId = orgUserId;
    }

    return {
      userId,
      orgUserId: resolvedOrgUserId,
      orgId: resolvedOrgId,
      facilityId: resolvedFacilityId,
    };
  } finally {
    await client.end();
  }
}

/** Seed an org + two users in it (an owner and an active HR staff member). */
async function seedOrgWithOwnerAndHr(
  ownerEmail: string,
  ownerPassword: string,
  hrEmail: string,
  hrPassword: string,
): Promise<{
  ownerId: string;
  ownerOrgUserId: string;
  hrId: string;
  hrOrgUserId: string;
  orgId: string;
  facilityId: string;
}> {
  const client = await db();
  try {
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const hrHashed = await bcrypt.hash(hrPassword, 10);
    const orgSlug = `rmv-ui-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const hrId = crypto.randomUUID();
    const ownerOrgUserId = crypto.randomUUID();
    const hrOrgUserId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Removed-Staff UI Test ${orgSlug}`, orgSlug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Removed-Staff UI Test ${orgSlug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Owner', 'Test', 'Owner Test', NOW(), NOW())`,
      [ownerId, ownerEmail, ownerHashed],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::\"UserRole\", true, NOW(), NOW(), NOW(), NOW())`,
      [ownerOrgUserId, ownerId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), ownerOrgUserId, facilityId],
    );
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'HrStaffer', 'Test', 'HrStaffer Test', NOW(), NOW())`,
      [hrId, hrEmail, hrHashed],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'hr'::\"UserRole\", true, NOW(), NOW(), NOW(), NOW())`,
      [hrOrgUserId, hrId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), hrOrgUserId, facilityId],
    );

    return { ownerId, ownerOrgUserId, hrId, hrOrgUserId, orgId, facilityId };
  } finally {
    await client.end();
  }
}

async function cleanupUser(
  userId: string,
  orgId?: string | null,
  orgUserId?: string | null,
): Promise<void> {
  const client = await db();
  try {
    if (orgUserId) {
      await client.query(
        `DELETE FROM organization_user_facilities WHERE organization_user_id = $1`,
        [orgUserId],
      );
      await client.query(`DELETE FROM organization_users WHERE id = $1`, [orgUserId]);
    }
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    if (orgId) {
      await client.query(`DELETE FROM facilities WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
  } finally {
    await client.end();
  }
}

async function cleanupOrgAndUsers(
  userIds: string[],
  orgId: string,
  orgUserIds: string[],
): Promise<void> {
  const client = await db();
  try {
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [orgUserIds],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [orgUserIds]);
    for (const id of userIds) {
      await client.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await client.query(`DELETE FROM facilities WHERE organization_id = $1`, [orgId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  } finally {
    await client.end();
  }
}

/**
 * Mirrors ONLY the raw DB writes removeStaff() performs (src/app/actions/staff.ts):
 * deactivate the membership (active=false, deactivated_at set) and bump the
 * identity's sessionVersion. Scoped by user_id since each test using this only
 * has one org. Deliberately an OUT-OF-BAND mutation: it does NOT call
 * `invalidateRevalidationCache()` the way the real server action does.
 *
 * This does NOT land in the TTL-backstop path, because the JWT callback's
 * membership re-check is unconditional — see the "MEMBERSHIP IS NEVER CACHED"
 * comment in `create-auth-instance.ts`. Only the *identity* snapshot
 * (sessionVersion, mfaEnabled, etc.) goes through the short-TTL cache; role
 * and membership always come from a live DB read, keyed by org, on every
 * decode. So flipping `active=false` here is caught on the very next
 * navigation regardless of the cache or of `invalidateRevalidationCache()`
 * ever being called — see the test below. A pure identity-only out-of-band
 * bump (no membership write) genuinely is masked until the TTL elapses; that
 * case is covered deterministically, without a real sleep, in
 * `src/lib/create-auth-instance.cache-integration.test.ts` ("TTL backstop vs.
 * active invalidation for a sessionVersion bump").
 */
async function simulateRemoveStaff(userId: string): Promise<void> {
  const client = await db();
  try {
    await client.query(
      `UPDATE organization_users SET active = false, deactivated_at = NOW(), updated_at = NOW() WHERE user_id = $1`,
      [userId],
    );
    await client.query(`UPDATE users SET session_version = session_version + 1 WHERE id = $1`, [
      userId,
    ]);
  } finally {
    await client.end();
  }
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@removed-e2e.invalid`;
}

async function loginAs(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('QA ISSUE 2 — removed staff member cannot log in or keep a live session', () => {
  test('a removed HR account gets the specific access-removed error, never reaches /dashboard', async ({
    page,
  }) => {
    const email = uniqueEmail('removed-hr');
    const password = 'R3moved!HrPwd9';
    // "Removed" = a deactivated organization_users row, which resolves to
    // { kind: 'revoked' } — not the no-membership-at-all 'none' state.
    const { userId, orgId, orgUserId } = await seedUser({
      email,
      password,
      role: 'hr',
      membership: 'revoked',
    });

    try {
      await loginAs(page, email, password);

      await expect(
        page.getByText(/your access to this organization has been removed/i),
      ).toBeVisible({ timeout: 10000 });
      expect(page.url()).not.toContain('/dashboard');
    } finally {
      await cleanupUser(userId, orgId, orgUserId);
    }
  });

  test('a live HR session is killed by the real removeStaff() action — the next navigation redirects to /login, at the DEFAULT cache TTL', async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    // Runs against whatever AUTH_REVALIDATE_TTL_SECONDS the webServer booted
    // with (unset in .env/.env.example → the 30s default). This is the whole
    // point of this test: it must pass WITHOUT relying on that TTL, because
    // the real removeStaff() action (commit 66aa961) actively busts the
    // target's cached snapshot immediately after its write — see
    // src/app/actions/staff.ts. If this ever starts failing at the default
    // TTL again, the active-invalidation call was lost, not just slow.
    const ownerEmail = uniqueEmail('live-owner');
    const ownerPassword = 'LiveOwner!Pwd9';
    const hrEmail = uniqueEmail('live-hr');
    const hrPassword = 'LiveHr!Pwd992';

    const { ownerId, ownerOrgUserId, hrId, hrOrgUserId, orgId } = await seedOrgWithOwnerAndHr(
      ownerEmail,
      ownerPassword,
      hrEmail,
      hrPassword,
    );

    const hrContext = await browser.newContext();
    const hrPage = await hrContext.newPage();
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();

    try {
      // The HR staffer logs in first and keeps this session live throughout.
      await loginAs(hrPage, hrEmail, hrPassword);
      await hrPage.waitForURL('**/dashboard', { timeout: 15000 });
      expect(hrPage.url()).toContain('/dashboard');

      // A separate owner session removes them via the real "Remove Staff" UI
      // flow — the exact same production path as the full UI-driven test
      // below, but this time with the target's session still live so the
      // kill-on-next-navigation guarantee can be observed directly.
      await loginAs(ownerPage, ownerEmail, ownerPassword);
      await ownerPage.waitForURL('**/dashboard', { timeout: 15000 });
      await ownerPage.goto('/dashboard/staff');
      await ownerPage.waitForLoadState('networkidle');
      await ownerPage.getByPlaceholder('Search for staff...').fill(hrEmail);
      await ownerPage.getByRole('button', { name: 'Row actions' }).click();
      await ownerPage.getByRole('menuitem', { name: 'Remove Staff' }).click();
      const dialog = ownerPage.getByRole('dialog');
      await expect(dialog.getByText('Remove Staff Member')).toBeVisible();
      await dialog.getByRole('button', { name: 'Remove Staff' }).click();
      await expect(dialog).toBeHidden({ timeout: 10000 });

      // Back on the still-live HR session: the next navigation must redirect
      // to /login well within the default TTL.
      await hrPage.goto('/dashboard');
      await hrPage.waitForURL('**/login**', { timeout: 15000 });
      expect(hrPage.url()).toContain('/login');
    } finally {
      await ownerContext.close();
      await hrContext.close();
      await cleanupOrgAndUsers([ownerId, hrId], orgId, [ownerOrgUserId, hrOrgUserId]);
    }
  });

  test('an out-of-band membership deactivation (bypassing invalidateRevalidationCache) is STILL caught on the very next navigation — membership is always live-read, never cached', async ({
    page,
  }) => {
    // Contrast with the test above: a raw DB write that skips removeStaff()
    // entirely (e.g. a manual data fix, a script, a different code path that
    // forgets to call invalidateRevalidationCache()) never busts the identity
    // cache. That used to leave a TTL-bounded window where the session stayed
    // alive. It no longer does: the JWT callback's membership re-check is
    // unconditional (see "MEMBERSHIP IS NEVER CACHED" in
    // create-auth-instance.ts), so an `active=false` write is effective on the
    // very next decode no matter how it got there. The TTL cache only ever
    // covered identity fields (sessionVersion, mfaEnabled, ...); the
    // deterministic, fast proof that a PURE identity-only bump (no membership
    // write) is what's actually masked until the TTL elapses lives in
    // src/lib/create-auth-instance.cache-integration.test.ts ("TTL backstop vs.
    // active invalidation for a sessionVersion bump").
    const email = uniqueEmail('oob-hr');
    const password = 'OobHr!Pwd9921';
    const { userId, orgId, orgUserId } = await seedUser({
      email,
      password,
      role: 'hr',
      membership: 'active',
    });

    try {
      await loginAs(page, email, password);
      await page.waitForURL('**/dashboard', { timeout: 15000 });
      expect(page.url()).toContain('/dashboard');

      await simulateRemoveStaff(userId);

      await page.goto('/dashboard');
      // No active bust fired for this write, but membership is read live on
      // every decode regardless of the cache — the deactivation still takes
      // effect immediately.
      await page.waitForURL('**/login**', { timeout: 15000 });
      expect(page.url()).toContain('/login');
    } finally {
      await cleanupUser(userId, orgId, orgUserId);
    }
  });

  test('org-less OWNER login is NOT blocked — reaches /dashboard and is guided to onboarding via the activation modal', async ({
    page,
  }) => {
    // Owner is the one legitimate org-less admin-tier state (pre-onboarding).
    // Unlike the worker portal, the admin portal does not route org-less users
    // away from /dashboard at the proxy layer — OrganizationActivationModal
    // (src/components/dashboard/OrganizationActivationModal.tsx) instead shows
    // a welcome dialog on /dashboard itself, with an "Activate your account"
    // button that navigates to /onboarding (or an unattended 60s auto-redirect).
    // The regression this guards: ISSUE 2's org-less-admin guard must NOT
    // mistake this legitimate state for a removed account.
    const email = uniqueEmail('preboard-owner');
    const password = 'PreB0ardOwn!9';
    // No organization_users row at all — resolveActiveMembership() returns
    // { kind: 'none' }, the legitimate pre-onboarding state (distinct from
    // 'revoked', which is what an actually-removed account looks like).
    const { userId } = await seedUser({ email, password, role: 'owner', membership: 'none' });

    try {
      await loginAs(page, email, password);
      await page.waitForURL('**/dashboard**', { timeout: 15000 });
      expect(
        await page.getByText(/your access to this organization has been removed/i).count(),
      ).toBe(0);

      await expect(
        page.getByText(/welcome to the compliance and training management portal/i),
      ).toBeVisible({ timeout: 10000 });
      await page.getByRole('button', { name: /activate your account/i }).click();
      await page.waitForURL('**/onboarding**', { timeout: 15000 });
      expect(page.url()).toContain('/onboarding');
      expect(page.url()).not.toContain('/onboarding-worker');
    } finally {
      await cleanupUser(userId, null, null);
    }
  });

  // RBAC-schema-driven behavior change (not a fixture-only fix): under the old
  // model a "self-serve, org-less worker" was a real, reachable state — role
  // lived directly on `users` even with organization_id NULL, so authenticate()
  // could resolve `role: 'nurse'` and route to the worker portal. Under the
  // multi-org schema, role only exists on an OrganizationUser row; a worker
  // account is now created ONLY via invite/join (which attaches a membership
  // in the same step — see src/app/actions/auth.ts#signup and
  // src/app/api/auth/verify/route.ts's comment: "the role is assumed on an
  // OrganizationUser membership once the account joins/founds an organisation,
  // never persisted on the global User identity created here"). A truly
  // memberless identity (resolveActiveMembership() -> {kind:'none'}) therefore
  // has no signal anywhere that it was ever "meant" to be a worker: `authenticate()`
  // (src/app/actions/auth.ts) only routes to the worker portal when an ACTIVE
  // membership resolves to a worker role, which a `none` resolution never does
  // — every memberless identity, "nurse"-seeded or not, resolves through the
  // admin portal and lands on /dashboard's founder-activation modal, exactly
  // like the org-less OWNER case above. Confirmed empirically: this identity
  // reaches /dashboard, never /worker or /onboarding-worker.
  test('a genuinely memberless identity is NOT blocked either — it resolves through the admin portal like the org-less owner, not /worker (self-serve worker pre-onboarding no longer exists)', async ({
    page,
  }) => {
    const email = uniqueEmail('preboard-worker');
    const password = 'PreB0ardWrk!9';
    const { userId } = await seedUser({ email, password, role: 'nurse', membership: 'none' });

    try {
      await loginAs(page, email, password);
      await page.waitForURL('**/dashboard**', { timeout: 15000 });
      expect(page.url()).toContain('/dashboard');
      expect(page.url()).not.toContain('/worker');

      // Same ISSUE-2 guard as the owner case: a `none` resolution must never be
      // mistaken for a removed ('revoked') account.
      expect(
        await page.getByText(/your access to this organization has been removed/i).count(),
      ).toBe(0);
    } finally {
      await cleanupUser(userId, null, null);
    }
  });

  test('full UI-driven pass: owner removes an active HR staffer, who then cannot log in', async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const ownerEmail = uniqueEmail('ui-owner');
    const ownerPassword = 'UiOwner!Pwd99';
    const hrEmail = uniqueEmail('ui-hr');
    const hrPassword = 'UiHrStaff!Pwd9';

    const { ownerId, ownerOrgUserId, hrId, hrOrgUserId, orgId } = await seedOrgWithOwnerAndHr(
      ownerEmail,
      ownerPassword,
      hrEmail,
      hrPassword,
    );

    try {
      const ownerContext = await browser.newContext();
      const ownerPage = await ownerContext.newPage();
      try {
        await loginAs(ownerPage, ownerEmail, ownerPassword);
        await ownerPage.waitForURL('**/dashboard', { timeout: 15000 });

        await ownerPage.goto('/dashboard/staff');
        await ownerPage.waitForLoadState('networkidle');
        await ownerPage.getByPlaceholder('Search for staff...').fill(hrEmail);

        await ownerPage.getByRole('button', { name: 'Row actions' }).click();
        await ownerPage.getByRole('menuitem', { name: 'Remove Staff' }).click();

        const dialog = ownerPage.getByRole('dialog');
        await expect(dialog.getByText('Remove Staff Member')).toBeVisible();
        await dialog.getByRole('button', { name: 'Remove Staff' }).click();
        await expect(dialog).toBeHidden({ timeout: 10000 });
      } finally {
        await ownerContext.close();
      }

      // A separate browser context — the removed HR staffer tries to log in.
      const hrContext = await browser.newContext();
      const hrPage = await hrContext.newPage();
      try {
        await loginAs(hrPage, hrEmail, hrPassword);
        await expect(
          hrPage.getByText(/your access to this organization has been removed/i),
        ).toBeVisible({ timeout: 10000 });
        expect(hrPage.url()).not.toContain('/dashboard');
      } finally {
        await hrContext.close();
      }
    } finally {
      await cleanupOrgAndUsers([ownerId, hrId], orgId, [ownerOrgUserId, hrOrgUserId]);
    }
  });
});
