import { test, expect } from '@playwright/test';

test.describe('Authentication Flows', () => {
  test('ENG-001: Microsoft OAuth Sign Up callbackUrl points to /dashboard (signup is owner-only, no role selection)', async ({
    page,
  }) => {
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
    const postData = request.postData();
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
