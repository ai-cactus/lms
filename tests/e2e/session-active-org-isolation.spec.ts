/**
 * E2E regression lock: a session's active organization must be derived from
 * ITS OWN JWT, never re-derived from the global `User.lastActiveOrganizationId`
 * column.
 *
 * Fix under test: `src/lib/auth/membership.ts`'s `resolveMembershipForActiveSession`
 * — once a session's JWT carries an `organizationId`, that org is authoritative
 * for THIS session and is resolved with a POINT lookup (`getActiveMembership`).
 * Only a genuinely org-less token falls back to the global resolver
 * (`resolveActiveMembership`, which DOES consult `lastActiveOrganizationId`).
 * Both `src/app/dashboard/(main)/layout.tsx` and `src/app/worker/layout.tsx`
 * call `resolveMembershipForActiveSession(session.user.id, session.user.organizationId)`
 * rather than the global resolver directly.
 *
 * Before the fix, every dashboard render re-derived the active org via the
 * global resolver, so ANY device/session for a multi-org user switching its
 * active org would silently bleed into every OTHER device/session for that
 * same user on its next reload — even though each session's own JWT still
 * named the org it was minted for.
 *
 * This spec uses TWO SEPARATE BROWSER CONTEXTS (two independent cookie jars —
 * i.e. two devices), not two tabs of one context. That distinguishes it from
 * `session-isolation-repro.spec.ts`, which covers the SAME-cookie-jar
 * (multiple tabs) case.
 *
 * Also guards against a false-positive eviction on device 1: device 1 and
 * device 2 are the SAME identity (Morgan Multi) in two independent sessions,
 * so `SessionIdentityGuard`'s live-session check (`checkLiveTabIdentity`)
 * must resolve device 1's own authenticated identity as a match against its
 * own baseline and never evict it just because device 2 (a different
 * session, same account) switched orgs — see session-identity-guard-focus.spec.ts
 * for the dedicated spec on that live-check mechanism.
 *
 * Fixture: `multi.org@test.com` / `MultiOrg123!` (prisma/seed.ts) — a single
 * identity with TWO ACTIVE memberships, both admin-tier so both land on
 * /dashboard (never /worker):
 *   - hr    in "E2E Test Organization"   (org X, the primary seed org)
 *   - owner in "E2E Second Organization" (org Y)
 *
 * Pre-conditions: same as the other session-isolation specs — app on
 * http://localhost:3005, DATABASE_URL reachable, local/dev run.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

const MULTI_ORG_USER_ID = '22222222-2222-4222-8222-222222222231';
const MULTI_ORG_EMAIL = 'multi.org@test.com';
const MULTI_ORG_PASSWORD = 'MultiOrg123!';
const ORG_X_NAME = 'E2E Test Organization';
const ORG_Y_NAME = 'E2E Second Organization';

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

/**
 * Self-contained login helper (spec files in this repo don't cross-import —
 * see session-isolation-repro.spec.ts's header comment). Random per-login IP
 * so two logins in the same test run don't share the credential-layer
 * rate-limit bucket (see staff-invite-flow.spec.ts / org-picker.spec.ts).
 */
async function login(page: Page, email: string, password: string): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

async function getHeaderText(page: Page): Promise<string> {
  return (await page.locator('header').first().innerText()).trim();
}

test.describe('Active-organization isolation across separate sessions (two browser contexts / devices)', () => {
  test.beforeEach(async () => {
    // Deterministic starting point regardless of prior test/spec runs against
    // the same DB — see org-picker.spec.ts's identical beforeEach rationale.
    await resetLastActiveOrg();
  });

  test('switching the active organization in one session does not bleed into a second, already-active session for the same user', async ({
    browser,
  }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    try {
      // ── Device 1: first-ever login for this (reset) user, choice
      // resolution -> org picker -> explicitly pick org X.
      const page1 = await context1.newPage();
      await login(page1, MULTI_ORG_EMAIL, MULTI_ORG_PASSWORD);
      await page1.waitForURL('**/select-organization**', { timeout: 45000 });
      await page1.getByText(ORG_X_NAME).click();
      await page1.waitForURL('**/dashboard**', { timeout: 15000 });

      const device1InitialHeader = await getHeaderText(page1);
      expect(
        device1InitialHeader,
        'sanity check: device 1 must show org X immediately after explicitly picking it',
      ).toContain(ORG_X_NAME);

      // ── Device 2: a SEPARATE session (fresh cookie jar). Org X was just
      // explicitly remembered by device 1's pick (switchOrganization stamps
      // `lastActiveOrganizationId`), so this fresh login silently resolves to
      // org X too — no picker. Both devices now independently show org X.
      const page2 = await context2.newPage();
      await login(page2, MULTI_ORG_EMAIL, MULTI_ORG_PASSWORD);
      await page2.waitForURL('**/dashboard**', { timeout: 45000 });
      expect(
        page2.url(),
        'device 2 should resolve straight to org X (remembered pick) with no picker',
      ).not.toContain('/select-organization');

      const device2InitialHeader = await getHeaderText(page2);
      expect(
        device2InitialHeader,
        'sanity check: device 2 must also land on org X (its own remembered pick)',
      ).toContain(ORG_X_NAME);

      // ── Device 2 explicitly switches to org Y. This mints a NEW JWT for
      // device 2's OWN cookie only, and also stamps the GLOBAL
      // `lastActiveOrganizationId` column to org Y (switchOrganization's
      // recordMembershipLogin call — the mechanism that used to leak).
      await page2.goto('/select-organization');
      await page2.getByText(ORG_Y_NAME).click();
      await page2.waitForURL('**/dashboard**', { timeout: 15000 });

      const device2AfterSwitchHeader = await getHeaderText(page2);
      expect(device2AfterSwitchHeader, 'sanity check: device 2 must now show org Y').toContain(
        ORG_Y_NAME,
      );

      // ── Device 1 never acted. Its own JWT still names org X. Reloading its
      // NEXT /dashboard request must be resolved from device 1's OWN session
      // (a point lookup on its `organizationId` claim), not re-derived from
      // the global `lastActiveOrganizationId` that device 2 just moved to
      // org Y — otherwise device 1 would silently bleed into org Y despite
      // taking no action of its own. It must also not be falsely evicted:
      // device 1 and device 2 are the SAME identity, so SessionIdentityGuard's
      // live-session check must resolve device 1 as a match against itself.
      await page1.reload();

      // `locator.isVisible()` is a point-in-time check that does NOT wait —
      // the eviction screen (if it appears at all) is driven by an async
      // `useSession()` refetch that settles after the initial reload
      // response, so a bare `isVisible()` right after `reload()` would almost
      // always read `false` regardless of what happens moments later and
      // silently no-op this assertion. `waitFor` actually polls.
      const evicted = await page1
        .locator('[data-testid="session-evicted"]')
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      expect(
        evicted,
        'device 1 must not show the session-evicted screen — it is the SAME identity as ' +
          'device 2, just scoped to a different org, so SessionIdentityGuard must not treat ' +
          "this as a different account taking over device 1's session",
      ).toBe(false);

      const device1AfterReloadHeader = await getHeaderText(page1);
      expect(
        device1AfterReloadHeader,
        `ACTIVE-ORG ISOLATION BUG: device 1 (own JWT scoped to org X) reloaded /dashboard ` +
          `after device 2 (a SEPARATE session/cookie jar for the SAME user) switched its own ` +
          `active org to Y. Expected device 1 to still show org X ("${ORG_X_NAME}") because it ` +
          `took no action of its own and its own session JWT was never re-minted. Actual ` +
          `rendered header: "${device1AfterReloadHeader}". If this contains org Y, the layout ` +
          `is re-deriving the active org from the global lastActiveOrganizationId column ` +
          `instead of trusting this session's own organizationId claim.`,
      ).toContain(ORG_X_NAME);
      expect(
        device1AfterReloadHeader,
        `ACTIVE-ORG ISOLATION BUG: device 1's rendered header must not contain org Y's name ` +
          `("${ORG_Y_NAME}") after device 2 switched to it independently.`,
      ).not.toContain(ORG_Y_NAME);
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
