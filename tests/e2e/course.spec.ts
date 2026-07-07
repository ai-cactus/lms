import { test, expect } from '@playwright/test';

const SEEDED_COURSE_TITLE = 'E2E Compliance Training';

async function loginAsAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'admin@test.com');
  await page.fill('input[type="password"]', 'Admin123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}

test.describe('Course Flows', () => {
  test('ENG-022: admin assigns a retake for a locked enrollment', async ({ page }) => {
    await loginAsAdmin(page);

    // Open the seeded course; the row navigates to its training-detail page,
    // which lists enrolled staff with a per-row kebab (⋮) actions menu.
    await page.goto('/dashboard/courses');
    await page.getByText(SEEDED_COURSE_TITLE).first().click();
    await page.waitForURL('**/training/courses/**');

    // Regression guard for the bug this test used to exercise: assignRetake()
    // only accepts a `locked` enrollment, and TrainingDetails.tsx now disables
    // the "Assign Retake" item (data-disabled, per Radix) for any other
    // status. Sarah's seeded enrollment is `in_progress` — confirm her item
    // stays disabled before touching the worker's (locked) row.
    const sarahRow = page.getByRole('row', { name: /sarah johnson/i });
    await sarahRow.getByRole('button', { name: 'Row actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Assign Retake' })).toHaveAttribute(
      'data-disabled',
      '',
    );
    // Close the menu (Escape) before opening the worker's.
    await page.keyboard.press('Escape');

    // The seeded worker's enrollment is `locked` (quiz attempts exhausted,
    // failing score) — the surface assignRetake() is actually built for.
    const workerRow = page.getByRole('row', { name: /test worker/i });
    await workerRow.getByRole('button', { name: 'Row actions' }).click();
    const assignRetakeItem = page.getByRole('menuitem', { name: 'Assign Retake' });
    await expect(assignRetakeItem).not.toHaveAttribute('data-disabled', '');
    await assignRetakeItem.click();

    // The Assign Retake dialog opens. Scope to the dialog's title heading —
    // the dialog also contains a same-labelled "Assign Retake" submit button,
    // so a plain getByText match is ambiguous (strict-mode violation).
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Assign Retake' })).toBeVisible();

    // Complete the modal: an optional reason, then confirm.
    await dialog
      .getByLabel(/reason for retake/i)
      .fill('Granted after review — E2E regression test');
    await dialog.getByRole('button', { name: 'Assign Retake' }).click();

    // Success outcome (AssignRetakeModal.tsx): no confirmation toast — the
    // dialog closes and the page refreshes via router.refresh(). assignRetake()
    // creates a NEW `enrolled` enrollment row (retakeOf the locked one), so the
    // worker now has two rows in this table: the original locked attempt and
    // the fresh retake.
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('row', { name: /test worker/i })).toHaveCount(2);
  });

  test('ENG-024: Course creation wizard resets its state on unmount', async ({ page }) => {
    await loginAsAdmin(page);

    // The wizard is a full-page route (/dashboard/courses/create), not a modal.
    await page.goto('/dashboard/courses');
    await page.getByRole('button', { name: 'Create Course' }).click();
    await page.waitForURL('**/dashboard/courses/create');
    await expect(page.getByText(/step 1 of 7/i)).toBeVisible();

    // Step 1 — pick a (system) category so "Next Step" enables.
    await page.getByRole('combobox').first().click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Next Step' }).click();

    // Step 2 — the document picker (shadcn Checkbox). Select the seeded doc.
    // We intentionally do NOT advance past Step 2 (that triggers AI document
    // analysis, which is unavailable in CI).
    await expect(page.getByText(/step 2 of 7/i)).toBeVisible();
    await page.getByRole('checkbox').first().click();

    // Leave the wizard (unmount) without finishing, then reopen it.
    await page.goto('/dashboard/courses');
    await page.getByRole('button', { name: 'Create Course' }).click();
    await page.waitForURL('**/dashboard/courses/create');

    // ENG-024 fix: reopening starts a fresh wizard at Step 1 rather than
    // silently resuming at Step 2.
    await expect(page.getByText(/step 1 of 7/i)).toBeVisible();
  });
});
