import { test, expect } from '@playwright/test';

test.describe('Authentication Flows', () => {

  test('ENG-001: Microsoft OAuth Sign Up callbackUrl points to /dashboard (signup is owner-only, no role selection)', async ({ page }) => {
    // Navigate to signup
    await page.goto('/signup');

    // We intercept the network request to the NextAuth signin endpoint
    // to verify the redirect generated contains the right callbackUrl in its parameters or cookies.
    const [request] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('microsoft-entra-id') && req.method() === 'POST'),
      page.click('button:has-text("Microsoft")')
    ]);

    // Self-serve signup was simplified to owner-only — there is no role-selection
    // step anymore, so Microsoft signup callbackUrl now goes straight to /dashboard.
    const postData = request.postData();
    expect(postData).toContain('/dashboard');
    expect(postData).not.toContain('role-selection');
  });

  test('ENG-002 & ENG-018: Logout redirect routes correctly', async ({ page }) => {
    // Visit /login
    await page.goto('/login');
    
    // Login as admin
    await page.fill('input[type="email"]', 'admin@test.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');

    // Wait for dashboard load
    await page.waitForURL('**/dashboard');

    // Focus/Click profile to open dropdown
    // Based on the Header.tsx, the profile div toggles the dropdown
    await page.locator('header').locator('text=Jane Doe').first().click();
    
    // Click Logout button
    await Promise.all([
      page.waitForURL('**/login'),
      page.click('button:has-text("Logout")') // Might need better selector if text differs
    ]);
    
    expect(page.url()).toContain('/login');
  });

});
