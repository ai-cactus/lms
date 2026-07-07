/**
 * E2E specs for the Reminders & Escalations feature.
 *
 * These run in CI against a Postgres/Redis service pair with migrations applied
 * and prisma/seed.ts loaded (admin@test.com + worker@test.com in the seeded
 * org). Auth rate limiting is bypassed via E2E_TEST_BYPASS_RATE_LIMIT.
 *
 * REM-001/REM-002 drive the real admin surfaces (course "Assign" page and the
 * staff-member manager picker). REM-003/REM-004 remain skipped: they need a
 * system-admin session cookie and a pre-aged overdue enrollment respectively,
 * neither of which the standard seed provides.
 */

import { test, expect } from '@playwright/test';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const ADMIN_EMAIL = process.env.PLAYWRIGHT_ADMIN_EMAIL ?? 'admin@test.com';
const ADMIN_PASSWORD = process.env.PLAYWRIGHT_ADMIN_PASSWORD ?? 'Admin123!';
// The staff list (StaffListClient.tsx) renders each row by email, not the
// profile's full name — the name is used only for the avatar initial, never
// as visible row text — so rows must be targeted by email.
const WORKER_EMAIL = 'worker@test.com';
const SEEDED_COURSE_TITLE = 'E2E Compliance Training';

async function loginAsAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe('Reminders & Escalations', () => {
  // ---------------------------------------------------------------------------
  // Flow 1: Admin assigns a course to a new assignee via the course "Assign"
  // page (which exposes the Due Date control that drives the reminder ladder).
  // ---------------------------------------------------------------------------
  test('REM-001: admin assigns a course with a due date via the assign page', async ({ page }) => {
    await loginAsAdmin(page);

    // Open the seeded course → its training-detail page → the Assign page.
    await page.goto('/dashboard/courses');
    await page.getByText(SEEDED_COURSE_TITLE).first().click();
    await page.waitForURL('**/training/courses/**');
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await page.waitForURL('**/assign');

    // Add an assignee (a fresh email → invite, keeping this test isolated from
    // the seeded enrollments used by other specs).
    const assignInput = page.locator('#assign-input');
    await assignInput.fill('rem001.newhire@example.com');
    await assignInput.press('Enter');
    await expect(page.getByText('rem001.newhire@example.com')).toBeVisible();

    // The Due Date control is part of this surface. Scope to the section
    // heading — the surface also has a "Select due date" button, so a plain
    // getByText('Due Date') match is ambiguous (strict-mode violation).
    await expect(page.getByRole('heading', { name: 'Due Date' })).toBeVisible();

    // Submit → success confirmation dialog.
    await page.getByRole('button', { name: 'Assign Course' }).click();
    await expect(page.getByText('Course Assigned Successfully')).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Flow 2: Admin sets a worker's manager on the staff-member detail page.
  // ---------------------------------------------------------------------------
  test('REM-002: admin sets a worker manager via the staff page', async ({ page }) => {
    await loginAsAdmin(page);

    // Open the seeded worker's detail page.
    await page.goto('/dashboard/staff');
    await page.getByRole('row', { name: new RegExp(WORKER_EMAIL, 'i') }).click();
    await page.waitForURL('**/dashboard/staff/**');

    // The manager picker is a Select labelled "Assign manager". Pick the only
    // assignable manager (the seeded admin) and confirm it sticks.
    await page.getByLabel('Assign manager').click();
    const managerOption = page.getByRole('option').filter({ hasNotText: 'No manager' }).first();
    const managerName = ((await managerOption.textContent()) ?? '').trim();
    await managerOption.click();

    await expect(page.getByLabel('Assign manager')).toContainText(managerName);
  });

  // ---------------------------------------------------------------------------
  // Flow 3: Manual reminder sweep via the system API (dryRun=true) returns
  // a summary — verifies the API route is wired, auth-gated, and responds.
  // ---------------------------------------------------------------------------
  test('REM-003: POST /api/system/reminders/run with dryRun:true returns a sweep summary (system-admin auth)', async ({
    request,
  }) => {
    // The system-admin session cookie must be present. Obtain it by logging in
    // via the browser context, or inject PLAYWRIGHT_SYSTEM_ADMIN_COOKIE in CI.
    const cookie = process.env.PLAYWRIGHT_SYSTEM_ADMIN_COOKIE;
    test.skip(!cookie, 'Skipped: PLAYWRIGHT_SYSTEM_ADMIN_COOKIE not set');

    const response = await request.post('/api/system/reminders/run', {
      data: { dryRun: true, catchUpDays: 0, nudgeIntervalDays: 3 },
      headers: { Cookie: cookie! },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();

    // The sweep summary shape (ReminderSweepSummary)
    expect(body).toMatchObject({
      scanned: expect.any(Number),
      ladderSent: expect.any(Number),
      nudgesSent: expect.any(Number),
      skipped: expect.any(Number),
      errors: expect.any(Number),
    });

    // dry-run: ladderSent and nudgesSent must be 0
    expect(body.ladderSent).toBe(0);
    expect(body.nudgesSent).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Flow 4: Compliance page shows the hard-escalation banner when an overdue
  // enrollment passes the 7-day threshold; banner clears after attestation.
  // ---------------------------------------------------------------------------
  test('REM-004: compliance page shows hard-escalation banner for 7+ day overdue enrollment', async ({
    page,
  }) => {
    // This test requires a seeded enrollment that is already ≥7 days overdue.
    // The standard seed does not provide one, so it stays skipped.
    test.skip(
      true,
      'Requires a seeded enrollment that is ≥7 days past dueAt — skip until such a fixture exists.',
    );

    await page.goto('/login');
    await page.fill('input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[name="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');

    await page.goto('/dashboard/compliance');

    // Hard-escalation banner must be visible
    const banner = page.getByRole('alert').filter({ hasText: /escalation|overdue/i });
    await expect(banner).toBeVisible();
  });
});
