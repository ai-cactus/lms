/**
 * E2E spec: course creation wizard — PHI hard block on the single-document
 * upload step (D2: PHI stays a hard block; Step2Upload).
 *
 * A document whose text contains a HIGH-confidence structural identifier (an
 * SSN, in canonical dashed form) is blocked by phiScanner.ts's deterministic
 * local pre-pass, which runs with ZERO network transmission — it never reaches
 * the contextual Vertex AI scan. That makes this genuinely drivable live here,
 * unlike the rest of the wizard's AI-dependent steps (course-wizard's own
 * generation step, and — per documents.spec.ts's module docstring — a document
 * upload whose PHI verdict actually depends on the contextual AI scan, which
 * this sandbox has no live Vertex credentials for).
 *
 * The uploaded files are real, valid .docx documents (built with the `docx`
 * package and read back through the real `uploadDocument` -> extractTextFromFile
 * -> mammoth -> scanText pipeline) — not placeholder bytes — so this exercises
 * the actual extraction + scan path, not just the dropzone's client-side
 * mechanics.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005.
 *   - prisma/seed.ts has been run (admin@test.com).
 *   - MinIO reachable for the second (clean) upload, which does reach storage.
 */

import { test, expect, type Page } from '@playwright/test';
import { Document, Packer, Paragraph, TextRun } from 'docx';

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'admin@test.com');
  await page.fill('input[type="password"]', 'Admin123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}

async function buildDocx(text: string): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun(text)] })] }],
  });
  return Packer.toBuffer(doc);
}

test.describe('Course creation wizard — PHI hard block on upload (D2)', () => {
  test('a PHI-flagging upload leaves the dropzone empty and Next disabled, then a clean re-upload unblocks it', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    await page.goto('/dashboard/courses/create');
    await expect(page.getByText(/step 1 of 7/i)).toBeVisible();

    await page.getByRole('combobox').first().click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Next Step' }).click();

    await expect(page.getByText(/step 2 of 7/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upload Training Documents' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next Step' })).toBeDisabled();

    await page.getByLabel(/contains no Personal Health Information/i).click();

    const phiFile = await buildDocx(
      'Patient SSN: 123-45-6789. Escalate any suspected breach immediately.',
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: 'confidential-intake-notes.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: phiFile,
    });

    // D2: the flagged document is never stored, so the slot is cleared and Next
    // stays disabled. The design replaced the "PHI WARNING" banner with a
    // dismissible toast (role="alert") carrying the same warning copy. Next.js's
    // own route announcer also carries an (empty, nameless) role="alert" — the
    // `alert` role isn't named from its contents, so `hasText` (a text filter,
    // not an accessible-name filter) is what actually narrows this to the toast.
    const phiToast = page
      .getByRole('alert')
      .filter({ hasText: /Protected Health Information \(PHI\) detected/i });
    await expect(phiToast).toBeVisible();
    await expect(page.getByText(/This document was not saved/i)).toBeVisible();
    await expect(page.getByText('confidential-intake-notes.docx')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Next Step' })).toBeDisabled();

    // A clean re-upload — no PHI attestation re-check needed, the dropzone is
    // offered again alongside the warning — unblocks Next.
    //
    // Kept under phiScanner.ts's 50-char MIN_SCAN_LENGTH deliberately: past
    // that length a clean document still falls through to the CONTEXTUAL AI
    // scan (scanChunkWithAI), which this sandbox has no live Vertex
    // credentials for and which therefore fails closed — the same constraint
    // documents.spec.ts's module docstring documents for live document upload
    // generally. Short-circuiting on `skipped_short` keeps this deterministic
    // without depending on live AI infrastructure.
    const cleanFile = await buildDocx('Complete annual training.');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'infection-control-policy.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: cleanFile,
    });

    await expect(page.getByText(/No Protected Health Information \(PHI\) detected/i)).toBeVisible();
    await expect(page.getByText('infection-control-policy.docx')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next Step' })).toBeEnabled();
  });
});
