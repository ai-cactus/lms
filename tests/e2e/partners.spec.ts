/**
 * E2E spec: Partners page + landing header/footer/hero/CTA refresh.
 *
 * Story: `/partners` ships the 8-section partner-program page (hero, about,
 * how-it-works, earnings calculator, benefits, founding-partner callout,
 * FAQ, apply form) wired to the real captcha + mail infra, and the landing
 * page (`/`) gets a refreshed marketing Navbar/Footer/Hero/closing CTA.
 *
 * Acceptance criteria:
 *   - /partners renders all 8 sections.
 *   - The earnings calculator recalculates the displayed total when a slider
 *     moves.
 *   - The application form blocks an empty submit client-side and reaches
 *     the success state on a valid submit.
 *   - The landing Navbar's "Partners" link routes to /partners, and the
 *     mobile menu opens on a mobile viewport.
 *   - / renders the refreshed header, hero, and footer.
 *
 * Pre-conditions / infra notes:
 *   - App running on http://localhost:3005 (no DB/auth needed — these routes
 *     are public and unauthenticated per src/proxy.ts's ROUTE_CONFIG, which
 *     only gates /worker* and /dashboard*).
 *   - The "reaches success state" test drives the real `submitPartnerApplication`
 *     server action end to end, including the email send. Per the project's
 *     e2e runbook this needs a local SMTP sink pointed at by SMTP_HOST/PORT
 *     (MailHog in CI/local Docker); with HCAPTCHA_ENABLED unset the captcha
 *     widget renders nothing and verifyCaptcha() is a no-op, so no captcha
 *     token is required to reach the success state.
 */

import { test, expect } from '@playwright/test';

test.describe('/partners page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/partners');
  });

  test('renders all 8 partner sections', async ({ page }) => {
    await expect(
      page.getByRole('heading', { level: 1, name: /Turn warm intros into/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Empowering facilities\. Simplifying compliance\./i }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /We do the heavy lifting\. You keep advising\./i }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Transparent rewards\. Compounding value\./i }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /We don.t replace your expertise\. We scale it\./i }),
    ).toBeVisible();
    await expect(page.getByText('Founding partners', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Questions/i })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Ready to scale your practice\?/i }),
    ).toBeVisible();
  });

  test('earnings calculator: moving a slider changes the displayed total', async ({ page }) => {
    const earnings = page.locator('#earnings');
    // The big payoff figure and the "in year 1" stat both render as a bare
    // "$X,XXX" <p> (the "by year N" stat has a trailing "/yr" and is excluded
    // by the exact-match regex) — either one recalculating on slider input is
    // sufficient proof the calculator is live, so `.first()` is fine here.
    const total = earnings.locator('p').filter({ hasText: /^\$[\d,]+$/ }).first();

    await expect(total).toBeVisible();
    const before = await total.textContent();

    const slider = page.getByRole('slider', { name: 'Facilities you refer / year' });
    await slider.focus();
    await slider.press('End'); // jump to the slider's max

    await expect(total).not.toHaveText(before ?? '');
  });

  test('form: client-side validation blocks an empty submit', async ({ page }) => {
    await page.getByRole('button', { name: /Apply to the partner program/i }).click();

    // Scope past Next.js's own route-announcer live region, which also has
    // role="alert" but no text.
    await expect(page.getByRole('alert').filter({ hasText: /valid email/i })).toBeVisible();
  });

  test('form: submitting valid fields reaches the success state', async ({ page }) => {
    await page.getByLabel('Full name').fill('Jordan Rivera');
    await page.getByLabel('Email').fill(`partner-e2e-${Date.now()}@example.com`);
    await page.getByLabel(/Consultancy \/ company/i).fill('Rivera Compliance Advisory');

    await page.getByRole('button', { name: /Apply to the partner program/i }).click();

    await expect(page.getByRole('heading', { name: 'Application received' })).toBeVisible({
      timeout: 15000,
    });
  });
});

test.describe('Navbar', () => {
  test('the Partners link on / navigates to /partners', async ({ page }) => {
    await page.goto('/');

    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Partners' })
      .click();

    await expect(page).toHaveURL(/\/partners$/);
    await expect(page.getByRole('heading', { level: 1, name: /Turn warm intros into/i })).toBeVisible();
  });

  test('the mobile menu opens on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const mobileNav = page.locator('#mobile-nav');
    await expect(mobileNav).not.toBeVisible();

    await page.getByRole('button', { name: 'Open menu' }).click();

    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'Partners' })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });
});

test.describe('/ (landing)', () => {
  test('renders the refreshed header, hero, and footer', async ({ page }) => {
    await page.goto('/');

    // Header (marketing Navbar)
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Partners' }),
    ).toBeVisible();

    // Refreshed hero
    await expect(
      page.getByRole('heading', { level: 1 }).filter({ hasText: /Be ready when inspectors ask for/i }),
    ).toBeVisible();

    // Refreshed closing CTA
    await expect(
      page.getByRole('heading', { name: /Work smarter, Stay Compliant with Theraptly/i }),
    ).toBeVisible();

    // Footer
    await expect(page.getByText('© 2026 Theraptly. All rights reserved.')).toBeVisible();
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Partner Program' })).toBeVisible();
  });
});
