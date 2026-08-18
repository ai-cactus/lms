import { test, expect } from '@playwright/test';

/**
 * Regression coverage for the CertificateModal button-overlap fix
 * (src/components/dashboard/training/CertificateModal.tsx): the preview
 * card's scale used to be bounded only by the available width, so at the
 * project's standard 1280x720 e2e viewport it could render tall enough to
 * slide under the fixed "Export PDF"/Close action bar and intercept clicks
 * meant for those buttons ("subtree intercepts pointer events"). The fix
 * bounds the scale by both width AND height and puts the action bar on top
 * with z-10.
 *
 * Seeded fixture (prisma/seed.ts): cara.certificate@test.com has a completed
 * enrollment in the shared 'E2E Compliance Training' course with an
 * already-issued Certificate row, seeded directly rather than via
 * issueCertificate(). CertificateModal's preview (getCertificateDetails) and
 * export (exportCertificatePdf) are both driven from the DB row + DOM, not
 * from the certificate's pdfStoragePath, so this fixture needs no
 * MinIO/GCS-backed storage to reach or interact with the modal.
 */

const COURSE_TITLE = 'E2E Compliance Training';
const STUDENT_NAME = 'Cara Certificate';

test.describe('Certificate modal — action bar overlap regression', () => {
  // Explicit, not relied on implicitly: the whole point of this regression
  // test is proving the fix holds at the project's standard desktop e2e
  // viewport, not at a taller workaround size.
  test.use({ viewport: { width: 1280, height: 720 } });

  test('Export PDF and Close stay clickable, and the preview stays visible, at the standard 1280x720 viewport', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'cara.certificate@test.com');
    await page.fill('input[type="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/worker');

    await page.goto('/worker/certificates');
    await page.getByRole('button', { name: `View certificate for ${COURSE_TITLE}` }).click();

    const dialog = page.getByRole('dialog');

    // Preview stays visible — guards against a future "fix" that dodges the
    // overlap by hiding the card instead of bounding its scale.
    await expect(dialog.getByText(STUDENT_NAME, { exact: true })).toBeVisible();
    await expect(dialog.getByText(COURSE_TITLE, { exact: true })).toBeVisible();

    const exportButton = dialog.getByRole('button', { name: 'Export PDF' });
    const closeButton = dialog.getByRole('button', { name: 'Close' });
    await expect(exportButton).toBeEnabled();
    await expect(closeButton).toBeEnabled();

    // Real clicks, not mere visibility checks: Playwright's actionability
    // check fails with "subtree intercepts pointer events" if another
    // element (the overflowing preview card, pre-fix) sits on top at the
    // click point. A successful click here is the actual regression proof.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportButton.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

    // Let the in-flight rasterization settle back to idle before closing, so
    // it doesn't race the dialog's unmount.
    await expect(exportButton).toHaveText(/Export PDF/, { timeout: 15000 });
    await expect(exportButton).toBeEnabled();

    await closeButton.click();
    await expect(dialog).toBeHidden();
  });
});
