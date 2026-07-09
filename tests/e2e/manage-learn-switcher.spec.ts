/**
 * E2E spec: sidebar redesign + Manage/Learn session-bridge.
 *
 * Acceptance criteria:
 *   - Seeded admin (owner) sees the Manage|Learn switcher, the relocated
 *     Status Tracker link (now under MAIN MENU) and the Help Center link on
 *     /dashboard; clicking Learn bridges into /worker (worker sidebar also
 *     shows the switcher, in "learn" mode); clicking Manage returns to
 *     /dashboard; both /dashboard/help and /worker/help load successfully.
 *   - Seeded worker (front_desk_admin) sees NO switcher on /worker, but the
 *     HELP section (Help Center link) is still present.
 *   - Security: a direct POST to the worker credentials callback with the
 *     admin's real password must NOT establish a worker session — the
 *     `sessionAllowedRoles: ALL_ROLES` widening only re-validates an
 *     EXISTING bridged session; it must never widen who can log in.
 *
 * Pre-conditions:
 *   - App running against the Playwright webServer (localhost:3005).
 *   - prisma/seed.ts loaded: admin@test.com / Admin123! (role owner) and
 *     worker@test.com / TestPassword123! (role front_desk_admin).
 */

import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, email: string, password: string, waitPattern: string) {
  // Random per-login IP so parallel/sequential runs don't share the
  // credential-layer rate-limit bucket (see staff-invite-flow.spec.ts).
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(waitPattern, { timeout: 45000 });
}

test.describe('Manage/Learn session-bridge switcher', () => {
  test('admin: switcher + relocated Status Tracker + Help Center, Learn bridges to /worker, Manage returns, both Help Centers load', async ({
    page,
  }) => {
    await login(page, 'admin@test.com', 'Admin123!', '**/dashboard**');

    await expect(page.getByRole('group', { name: 'View mode' })).toBeVisible();
    // Exact match: the dashboard home page also has an "Open status tracker"
    // widget CTA pointing at the same URL — only the nav item is named exactly
    // "Status Tracker".
    await expect(page.getByRole('link', { name: 'Status Tracker', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /help center/i })).toHaveAttribute(
      'href',
      '/dashboard/help',
    );

    await page.getByRole('button', { name: 'Learn' }).click();
    await page.waitForURL('**/worker');

    // First-visit-to-learn-mode "How to get started" tour modal — it mounts
    // asynchronously (WorkerWelcomeModal), so give it a moment to appear and
    // dismiss it if it does, so it doesn't intercept the click on the Manage
    // segment below.
    const welcomeModalClose = page.getByRole('button', { name: 'Close' });
    await welcomeModalClose.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    if (await welcomeModalClose.isVisible()) {
      await welcomeModalClose.click();
    }

    await expect(page.getByRole('group', { name: 'View mode' })).toBeVisible();
    await expect(page.getByRole('link', { name: /help center/i })).toHaveAttribute(
      'href',
      '/worker/help',
    );

    await page.getByRole('link', { name: 'Manage' }).click();
    await page.waitForURL('**/dashboard');
    await expect(page.getByRole('group', { name: 'View mode' })).toBeVisible();

    await page.goto('/dashboard/help');
    await expect(page.getByRole('heading', { name: 'Help Center', level: 1 })).toBeVisible();

    // The worker cookie minted earlier by bridging is still valid, so the
    // worker-side Help Center is reachable directly without re-bridging.
    await page.goto('/worker/help');
    await expect(page.getByRole('heading', { name: 'Help Center', level: 1 })).toBeVisible();
  });

  test('worker: no Manage/Learn switcher, but the HELP section is present', async ({ page }) => {
    await login(page, 'worker@test.com', 'TestPassword123!', '**/worker');

    await expect(page.getByRole('group', { name: 'View mode' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /help center/i })).toHaveAttribute(
      'href',
      '/worker/help',
    );
  });

  test('security: a direct POST to the worker credentials callback with the admin password does not establish a worker session', async ({
    page,
    context,
  }) => {
    const csrfRes = await page.request.get('/api/auth-worker/csrf');
    expect(csrfRes.ok()).toBe(true);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

    await page.request.post('/api/auth-worker/callback/credentials', {
      form: { email: 'admin@test.com', password: 'Admin123!', csrfToken },
    });

    const cookies = await context.cookies();
    const workerSessionCookie = cookies.find((c) => c.name.endsWith('worker.session-token'));
    expect(workerSessionCookie).toBeUndefined();

    // No bridged session exists either, so a direct /worker visit still
    // bounces to /login.
    await page.goto('/worker');
    await page.waitForURL('**/login**');
  });
});
