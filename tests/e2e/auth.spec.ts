import { test, expect } from '@playwright/test';

test.describe('Authentication Flows', () => {
  test('Tier 3 5.2: /login renders the hero image immediately (static fallback or hydrated framer-motion slider)', async ({
    page,
  }) => {
    // AuthHeroSlider (src/app/(auth)/components/AuthHeroSlider.tsx) now lazy-loads
    // its framer-motion implementation via next/dynamic({ ssr: false }), painting
    // a static first-slide fallback in the meantime so the LCP image on /login
    // isn't blocked behind the framer-motion chunk. Whether the page is caught in
    // the fallback or already hydrated, slide 0's priority image and copy must be
    // visible — this guards against a regression to blank/spinner on first paint.
    await page.goto('/login');

    const heroImage = page.getByAltText('Audit-ready training, built from your policies');
    await expect(heroImage).toBeVisible();
    // Next/Image rewrites the src through its optimizer (e.g.
    // /_next/image?url=%2Fimages%2Fslider_1.png&w=...&q=100) — "." isn't a
    // URI-reserved character, so the original filename survives verbatim.
    await expect(heroImage).toHaveAttribute('src', /slider_1\.png/);
    await expect(page.getByText('Audit-ready training, built from your policies')).toBeVisible();
  });

  test('ENG-001: Microsoft OAuth Sign Up callbackUrl points to /dashboard (signup is owner-only, no role selection)', async ({
    page,
  }) => {
    // The Microsoft provider is only registered when AUTH_MICROSOFT_ENTRA_ID_ID
    // is set (CI provides dummy values). Without it the signup page renders no
    // Microsoft button and the POST this test intercepts can never fire.
    test.skip(
      !process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      'AUTH_MICROSOFT_ENTRA_ID_ID not set — Microsoft provider not registered',
    );
    await page.goto('/signup');

    // NextAuth v5's client `signIn('microsoft-entra-id', …)` POSTs to the
    // sign-in endpoint with the callbackUrl in the body. The provider is only
    // registered when AUTH_MICROSOFT_ENTRA_ID_ID is set (dummy values in CI),
    // and constructing it makes no eager network call, so the POST fires safely.
    const [request] = await Promise.all([
      page.waitForRequest(
        (req) => req.url().includes('microsoft-entra-id') && req.method() === 'POST',
      ),
      page.getByRole('button', { name: /sign up with microsoft/i }).click(),
    ]);

    // Self-serve signup was simplified to owner-only — there is no role-selection
    // step anymore, so Microsoft signup callbackUrl now goes straight to /dashboard.
    // The callbackUrl travels URL-encoded in the POST body (%2Fdashboard), so
    // decode before asserting on the path.
    const postData = decodeURIComponent(request.postData() ?? '');
    expect(postData).toContain('/dashboard');
    expect(postData).not.toContain('role-selection');
  });

  test('ENG-002 & ENG-018: Logout redirect routes correctly', async ({ page }) => {
    await page.goto('/login');

    // Log in as the seeded admin (lands on /dashboard).
    await page.fill('input[type="email"]', 'admin@test.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');

    // Open the profile dropdown (the name is shown at desktop widths).
    await page.locator('header').getByText('Jane Doe').first().click();

    // Logout is a two-step confirm: the dropdown "Logout" opens a dialog whose
    // footer holds the real Logout button.
    await page.getByRole('button', { name: 'Logout' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Confirm Logout')).toBeVisible();

    await Promise.all([
      page.waitForURL('**/login'),
      dialog.getByRole('button', { name: 'Logout' }).click(),
    ]);

    expect(page.url()).toContain('/login');
  });
});
