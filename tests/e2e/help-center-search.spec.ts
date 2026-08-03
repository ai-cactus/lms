/**
 * E2E spec: Help Center search (TC-064).
 *
 * `HelpCenterContent` (src/components/help/HelpCenterContent.tsx) was static
 * — it now has a client-side search that filters the article list by question +
 * answer text, with an empty-state message for a query matching nothing.
 * Shared by both the admin dashboard (/dashboard/help) and the worker portal
 * (/worker/help) — this spec drives both real routes with the stock seeded
 * accounts (no DB seeding/mutation needed; the page is read-only). Each portal
 * only renders the articles for its own audience, so the assertions below use
 * admin-facing copy on /dashboard/help and worker-facing copy on /worker/help.
 */

import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

test.describe('Help Center search (TC-064)', () => {
  test('a query filters the article list on the admin dashboard Help Center', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, 'admin@test.com', 'Admin123!');
    await page.waitForURL('**/dashboard', { timeout: 45000 });

    await page.goto('/dashboard/help');
    await expect(page.getByText('How do I onboard workers?')).toBeVisible();
    await expect(page.getByText('How do I create a course?')).toBeVisible();

    await page.getByPlaceholder(/search help articles/i).fill('onboard');

    await expect(page.getByText('How do I onboard workers?')).toBeVisible();
    await expect(page.getByText('How do I create a course?')).toHaveCount(0);
  });

  test('a nonsense query shows the empty state, then clearing it restores the full list', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await login(page, 'admin@test.com', 'Admin123!');
    await page.waitForURL('**/dashboard', { timeout: 45000 });

    await page.goto('/dashboard/help');
    const searchInput = page.getByPlaceholder(/search help articles/i);
    await searchInput.fill('zzzznotarealquestionzzzz');

    await expect(page.getByText('No results found')).toBeVisible();
    await expect(page.getByText(/zzzznotarealquestionzzzz/)).toBeVisible();

    await searchInput.clear();

    await expect(page.getByText('No results found')).toHaveCount(0);
    await expect(page.getByText('How do I onboard workers?')).toBeVisible();
  });

  test('the worker portal Help Center supports the same search behavior', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, 'sarah.johnson@company.com', 'TestPassword123!');
    await page.waitForURL('**/worker', { timeout: 45000 });

    await page.goto('/worker/help');
    await page.getByPlaceholder(/search help articles/i).fill('password');

    await expect(page.getByText('Why am I being asked to reset my password?')).toBeVisible();
    await expect(page.getByText('Where can I find my certificates?')).toHaveCount(0);
  });
});

test.describe('Help Center — public /help route (unauthenticated)', () => {
  // `/help` is public by default per proxy.ts's ROUTE_CONFIG (like /privacy,
  // /terms) and renders BOTH admin- and worker-audience articles
  // (`audience="all"`), unlike the two portal-scoped pages above.
  test('renders both admin- and worker-facing content and search works, with no login', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.goto('/help');

    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByText('How do I onboard workers?')).toBeVisible();
    await expect(page.getByText('Why am I being asked to reset my password?')).toBeVisible();

    await page.getByPlaceholder(/search help articles/i).fill('onboard');

    await expect(page.getByText('How do I onboard workers?')).toBeVisible();
    await expect(page.getByText('Why am I being asked to reset my password?')).toHaveCount(0);
  });

  test('a nonsense query on the public page shows the empty state, then clearing restores the full list', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.goto('/help');
    const searchInput = page.getByPlaceholder(/search help articles/i);
    await searchInput.fill('zzzznotarealquestionzzzz');

    await expect(page.getByText('No results found')).toBeVisible();

    await searchInput.clear();

    await expect(page.getByText('No results found')).toHaveCount(0);
    await expect(page.getByText('How do I onboard workers?')).toBeVisible();
  });
});
