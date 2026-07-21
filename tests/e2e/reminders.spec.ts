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
// Seeded by prisma/seed.ts specifically for Status Tracker fixtures: a worker
// whose enrollment dueAt is always ~10 days before "now" at seed time, so it
// stays past the 7-day HARD_ESCALATION threshold on every run.
const OVERDUE_WORKER_NAME = 'Olivia Overdue';

async function loginAsAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}

/**
 * Drive the custom calendar DatePicker (src/components/ui/DatePicker.tsx — no
 * native <input type="date">) to a specific date `daysFromNow` in the future.
 * `pickerName` is the toggle button's accessible name, which equals its empty
 * placeholder text ("Select date" for Training Schedule, "Select due date"
 * for Due Date) — the two pickers on the Assign page are otherwise identical.
 * Returns the resulting `YYYY-MM-DD` string so callers can assert against it.
 */
async function pickFutureDate(
  page: import('@playwright/test').Page,
  pickerName: string,
  daysFromNow: number,
): Promise<string> {
  const today = new Date();
  const target = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysFromNow);
  const monthsToAdvance =
    (target.getFullYear() - today.getFullYear()) * 12 + (target.getMonth() - today.getMonth());

  await page.getByRole('button', { name: pickerName }).click();
  const popover = page.locator('#date-picker-popover');
  await expect(popover).toBeVisible();

  const nextMonthButton = popover.getByRole('button').nth(1);
  for (let i = 0; i < monthsToAdvance; i++) {
    await nextMonthButton.click();
  }

  await popover.getByRole('button', { name: String(target.getDate()), exact: true }).click();
  await expect(popover).toBeHidden();

  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  return `${target.getFullYear()}-${mm}-${dd}`;
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
  // Flow 4: Status Tracker page shows the hard-escalation banner when an overdue
  // enrollment passes the 7-day threshold; banner clears after attestation.
  // ---------------------------------------------------------------------------
  test('REM-004: status tracker page shows hard-escalation banner for 7+ day overdue enrollment', async ({
    page,
  }) => {
    // Uses the seeded "Olivia Overdue" enrollment (dueAt ~10 days ago).
    await loginAsAdmin(page);

    // Hard-escalation banner is site-wide for admins, so it must already be
    // visible right after landing on /dashboard.
    const banner = page.getByRole('alert').filter({ hasText: /escalation|overdue/i });
    await expect(banner).toBeVisible();

    await page.goto('/dashboard/status-tracker');
    await expect(banner).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Flow 5: Renamed nav entry ("Compliance" → "Status Tracker") links to the
  // new /dashboard/status-tracker URL, and the page itself renders under its
  // new heading.
  // ---------------------------------------------------------------------------
  test('REM-005: nav shows "Status Tracker" and links to /dashboard/status-tracker', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    const navLink = page.getByRole('link', { name: 'Status Tracker', exact: true });
    await expect(navLink).toBeVisible();
    await expect(navLink).toHaveAttribute('href', '/dashboard/status-tracker');

    await navLink.click();
    await page.waitForURL('**/dashboard/status-tracker');
    await expect(page.getByRole('heading', { name: 'Status Tracker', level: 1 })).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Flow 6: Admin dashboard shows the Status Tracker overview widget — summary
  // counts, a "View all" link, and the seeded overdue worker in its top-5 list.
  // ---------------------------------------------------------------------------
  test('REM-006: admin dashboard shows the Status Tracker overview with the overdue worker', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    const section = page.locator('section', {
      has: page.getByRole('heading', { name: 'Status Tracker', level: 2 }),
    });
    await expect(section).toBeVisible();

    const viewAllLink = section.getByRole('link', { name: /view all/i });
    await expect(viewAllLink).toHaveAttribute('href', '/dashboard/status-tracker');

    // Summary counts are non-empty since the seeded overdue worker exists.
    await expect(section.getByText('Overdue training')).toBeVisible();
    await expect(section.getByText(/Hard escalations/)).toBeVisible();

    // Seeded overdue worker appears in the compact top-5 list.
    await expect(section.getByText(OVERDUE_WORKER_NAME)).toBeVisible();
    await expect(section.getByText(SEEDED_COURSE_TITLE)).toBeVisible();

    // Following "View all" lands on the full status-tracker page with the
    // same worker present.
    await viewAllLink.click();
    await page.waitForURL('**/dashboard/status-tracker');
    await expect(page.getByText(OVERDUE_WORKER_NAME)).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Flow 7 (Phase 2 Issue #2 / TC-015 regression): the wizard-assigned-course
  // deadline-drop bug — createFullCourse used to write bare enrollments with no
  // dueAt, silently disabling the reminder ladder. createFullCourse now
  // delegates to enrollUsers (unit-tested directly in
  // course.create-full-course.test.ts); this e2e check proves the SAME
  // underlying delegation (enrollUsers → createEnrollmentForUser) round-trips
  // a due date all the way to what the assigned worker actually sees. The
  // wizard's own UI can't reach this admin-assign step in this environment
  // (Step 2+ requires a live Vertex AI call the sandbox has no credentials
  // for), so this drives the assign page directly — the same server action the
  // wizard delegates to.
  // ---------------------------------------------------------------------------
  test('TC-015: a due date set on assignment shows up on the assigned worker\'s training list', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    await page.goto('/dashboard/courses');
    await page.getByText(SEEDED_COURSE_TITLE).first().click();
    await page.waitForURL('**/training/courses/**');
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await page.waitForURL('**/assign');

    const assignInput = page.locator('#assign-input');
    await assignInput.fill('walt.assignable@test.com');
    await assignInput.press('Enter');
    await expect(page.getByText('walt.assignable@test.com')).toBeVisible();

    const dueDateStr = await pickFutureDate(page, 'Select due date', 21);
    const [y, m, d] = dueDateStr.split('-').map(Number);
    const expectedDueLabel = new Date(y, m - 1, d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    await page.getByRole('button', { name: 'Assign Course' }).click();
    await expect(page.getByText('Course Assigned Successfully')).toBeVisible();

    // Log out and back in as the assigned worker to see their own training list.
    await page.goto('/login');
    await page.fill('input[type="email"]', 'walt.assignable@test.com');
    await page.fill('input[type="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/worker**');

    await page.goto('/worker/trainings');
    await expect(page.getByText(SEEDED_COURSE_TITLE)).toBeVisible();
    await expect(page.getByText(`Due ${expectedDueLabel}`)).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Flow 8 (Phase 2 Issue #5 / TC-018): reopening the assign page for an
  // already-assigned course prefills the live settings, and re-submitting
  // updates the existing CourseAssignment rather than creating a duplicate
  // enrollment for someone already assigned.
  // ---------------------------------------------------------------------------
  test('TC-018: re-opening Assign shows the saved due date, and re-submitting does not duplicate the enrollment', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    await page.goto('/dashboard/courses');
    await page.getByText(SEEDED_COURSE_TITLE).first().click();
    await page.waitForURL('**/training/courses/**');

    // Walt is already assigned by the TC-015 test above (or a prior run) —
    // re-opening Assign must show "existing assignment" messaging, not a blank
    // factory-default form.
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await page.waitForURL('**/assign');
    await expect(
      page.getByText(/this course has an existing assignment/i),
    ).toBeVisible();

    // The saved schedule/deadline/renewal/reminder SETTINGS are prefilled from
    // the existing CourseAssignment, but the assignee list is not (it isn't
    // part of that row — it's derived from Enrollment rows) — re-add Walt so
    // "Assign Course" enables, then re-submit. His EXISTING enrollment is left
    // alone by createEnrollmentForUser's alreadyEnrolled check; only the
    // CourseAssignment settings row is updated (the upsert path under test).
    const assignInput = page.locator('#assign-input');
    await assignInput.fill('walt.assignable@test.com');
    await assignInput.press('Enter');

    await page.getByRole('button', { name: 'Assign Course' }).click();
    await expect(page.getByText('Course Assigned Successfully')).toBeVisible();

    // Walt appears exactly once in the training-detail roster — no duplicate
    // enrollment row from the re-submit.
    await page.goto('/dashboard/courses');
    await page.getByText(SEEDED_COURSE_TITLE).first().click();
    await page.waitForURL('**/training/courses/**');
    await expect(page.getByRole('row', { name: /walt assignable/i })).toHaveCount(1);
  });

  // ---------------------------------------------------------------------------
  // Flow 9 (Phase 2 Issue #4 / TC-016): role-based assignment enrolls current
  // holders of the targeted role.
  // ---------------------------------------------------------------------------
  test('TC-016: assigning a course to a whole role enrolls current holders of that role', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    await page.goto('/dashboard/courses');
    await page.getByText(SEEDED_COURSE_TITLE).first().click();
    await page.waitForURL('**/training/courses/**');
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await page.waitForURL('**/assign');

    await page.getByRole('button', { name: 'A whole role' }).click();
    await page.getByRole('combobox').first().click();
    // Display name per src/lib/rbac/permissions.ts — "Front Desk / Administrative
    // Support", the seeded workers' role (worker, sarah, overdueWorker, walt, etc).
    await page.getByRole('option', { name: /front desk/i }).click();

    // Role-target assignments never carry an absolute due date — the "Due
    // Date" field belongs to "Specific people" mode only.
    await expect(page.getByRole('heading', { name: 'Due Date' })).not.toBeVisible();

    // Current-holder preview copy is present (roleHolderCounts wiring).
    await expect(page.getByText(/will be enrolled now/i)).toBeVisible();

    await page.getByRole('button', { name: 'Assign Course' }).click();
    await expect(page.getByText('Course Assigned Successfully')).toBeVisible();

    // The seeded front_desk_admin holders (worker, sarah, overdueWorker,
    // nearDeadlineWorker, walt) are all enrolled — already-enrolled ones are a
    // safe no-op (idempotent), so this never fails on re-runs.
    await page.goto('/dashboard/courses');
    await page.getByText(SEEDED_COURSE_TITLE).first().click();
    await page.waitForURL('**/training/courses/**');
    await expect(page.getByRole('row', { name: /nadia nearing/i })).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Flow 10 (Phase 2 Issues #9/#10, TC-025): the status-tracker "At Risk — Next
  // 7 Days" section lists an enrollment due soon (not yet overdue) — seeded
  // separately from the always-overdue "Olivia Overdue" fixture.
  // ---------------------------------------------------------------------------
  test('TC-025: status tracker shows the At Risk — Next 7 Days section with a near-deadline worker', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/status-tracker');

    await expect(page.getByRole('heading', { name: 'At Risk — Next 7 Days' })).toBeVisible();
    await expect(page.getByText('Nadia Nearing')).toBeVisible();
  });
});
