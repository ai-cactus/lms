import { test, expect } from '@playwright/test';

/**
 * Document Hub e2e coverage (Phase 2 Issues #11, #13, and the "full org
 * parity" extra).
 *
 * Live document UPLOAD is out of scope here: uploadDocument's PHI gate always
 * fails closed on a real Vertex AI call (documents.ts — see
 * documents.test.ts), and this sandbox has no Vertex AI credentials, so any
 * upload attempt is blocked before it reaches storage. The two seeded PDF
 * documents (one per admin, prisma/seed.ts) stand in for "already uploaded"
 * fixtures so the LIST/rename/delete/visibility behavior can be driven
 * end-to-end without needing a live scan.
 */

async function loginAsAdmin(page: import('@playwright/test').Page, email: string): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'Admin123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}

test.describe('Document Hub — full org parity', () => {
  test('admin2 sees the document uploaded by admin1, and vice versa', async ({ page }) => {
    await loginAsAdmin(page, 'admin2@test.com');
    await page.goto('/dashboard/documents');

    await expect(page.getByRole('row', { name: /e2e-compliance-policy\.pdf/i })).toBeVisible();

    await loginAsAdmin(page, 'admin@test.com');
    await page.goto('/dashboard/documents');

    await expect(page.getByRole('row', { name: /e2e-admin2-policy\.pdf/i })).toBeVisible();
  });

  test('deleting another admin\'s document shows the shadcn AlertDialog — never a native confirm()', async ({
    page,
  }) => {
    // Fail the test immediately if a native browser dialog (window.confirm)
    // ever appears — the whole point of Issue #13 is that it must not.
    page.on('dialog', (dialog) => {
      throw new Error(
        `Unexpected native browser dialog appeared (message: "${dialog.message()}") — ` +
          'the delete confirmation must be the shadcn AlertDialog, never window.confirm().',
      );
    });

    await loginAsAdmin(page, 'admin@test.com');
    await page.goto('/dashboard/documents');

    const targetRow = page.getByRole('row', { name: /e2e-admin2-policy\.pdf/i });
    await expect(targetRow).toBeVisible();
    await targetRow.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menuitem', { name: /delete/i }).click();

    // The shadcn AlertDialog appears with an explicit confirm/cancel — not a
    // blocking native dialog (which would have thrown above already).
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Delete document?')).toBeVisible();

    // Cancel rather than actually deleting the shared fixture — re-seeding
    // resets it for every run anyway, but this keeps this test independent of
    // run order relative to other document specs.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(targetRow).toBeVisible();
  });
});

test.describe('PDF viewer — self-hosted pdf.js worker (Issue #1 / TC-011)', () => {
  test('opening a PDF document raises no CSP console errors (self-hosted worker, not unpkg)', async ({
    page,
  }) => {
    const cspViolations: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (/content security policy|refused to (load|connect|execute)|unpkg\.com/i.test(text)) {
        cspViolations.push(text);
      }
    });

    await loginAsAdmin(page, 'admin@test.com');
    await page.goto('/dashboard/documents');
    await page.getByRole('row', { name: /e2e-compliance-policy\.pdf/i }).click();
    await page.waitForURL('**/dashboard/documents/**');

    // Give the worker + document a moment to load (or fail) before asserting.
    await page.waitForTimeout(2000);

    expect(cspViolations, `CSP/worker-loading console errors: ${cspViolations.join('; ')}`).toEqual(
      [],
    );
  });
});

test.describe('Document upload — client-side .doc rejection (Issue #13)', () => {
  test('selecting a .doc file shows a validation error and never enables Upload', async ({
    page,
  }) => {
    await loginAsAdmin(page, 'admin@test.com');
    await page.goto('/dashboard/documents');

    await page.getByRole('button', { name: /upload/i }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Upload Document' });
    await expect(dialog).toBeVisible();

    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'legacy-policy.doc',
      mimeType: 'application/msword',
      buffer: Buffer.from('not a real doc file, just bytes for the client-side check'),
    });

    await expect(dialog.getByText('Only PDF and DOCX files are allowed.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Upload' })).toBeDisabled();
  });
});
