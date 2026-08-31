/**
 * E2E spec: course creation wizard — multi-module builder (course-creation-wizard
 * redesign wave, now 7 steps: category → modules → details → quiz → generate →
 * quiz review → assign & publish).
 *
 * Generation and everything after it needs a real Vertex AI call and this
 * environment has no credentials, so — following the precedent already
 * established by ENG-024 in course.spec.ts and the upload-mechanics-only
 * coverage in documents.spec.ts — this spec drives the wizard as far as it can
 * go WITHOUT submitting anything AI-dependent: Steps 1 through 4. It deep-links
 * `?documentId=` with the seeded document (prisma/seed.ts DOC_ID) to seed
 * Step 2's first module attachment, sidestepping uploadDocument's real PHI scan
 * (out of scope for e2e — see documents.spec.ts) while still exercising the
 * module-builder's own form and "Add module".
 *
 * Acceptance criteria:
 *   - A module filled in on Step 2 (with a pre-attached document) can be added
 *     and appears in the modules list; Next Step then advances to Step 3 even
 *     though the document-analysis call it triggers has no Vertex AI credentials
 *     to succeed with (CourseWizard.tsx's handleNext advances in its `finally`
 *     block regardless of that call's outcome).
 *   - The FIRST module asks for no completion deadline: until a second module
 *     exists the course is still a whole course, which carries none.
 *   - Steps 3 and 4 accept the required Details/Quiz fields and reach a
 *     Next-enabled state on Step 4 of 7 — the last step before the AI-generation
 *     screen — without ever clicking into it.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005.
 *   - prisma/seed.ts has been run (admin@test.com + its seeded document).
 */

import { test, expect } from '@playwright/test';

const SEEDED_DOCUMENT_ID = '33333333-3333-4333-8333-333333333331';
const SEEDED_DOCUMENT_FILENAME = 'e2e-compliance-policy.pdf';

async function loginAsAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'admin@test.com');
  await page.fill('input[type="password"]', 'Admin123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}

test.describe('Course creation wizard — module builder', () => {
  test('builds a module from a deep-linked document and reaches the quiz step without triggering generation', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    await page.goto(`/dashboard/courses/create?documentId=${SEEDED_DOCUMENT_ID}`);
    await expect(page.getByText(/step 1 of 7/i)).toBeVisible();

    await page.getByRole('combobox').first().click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Next Step' }).click();

    // Step 2 — the deep-linked document seeds the first module's attachment
    // slot directly, bypassing the real upload/PHI-scan.
    await expect(page.getByText(/step 2 of 7/i)).toBeVisible();
    await expect(page.getByText(SEEDED_DOCUMENT_FILENAME)).toBeVisible();

    // The first module carries no deadline: it may turn out to BE the whole
    // course, so the field only appears once a second module is being authored.
    await expect(page.getByText(/Module Completion Deadline/i)).toBeHidden();

    await page.getByLabel(/module title/i).fill('Infection Control Basics');
    await page.getByLabel(/objective/i).fill('Recognize and respond to infection control risks.');
    await page.getByRole('button', { name: 'Add module' }).click();

    // The committed module renders as a "Module 1" card and the draft form
    // resets, ready for a second module — which now does ask for a deadline.
    await expect(page.getByText('Infection Control Basics')).toBeVisible();
    await expect(page.getByText('Module 1')).toBeVisible();
    await expect(page.getByLabel(/module title/i)).toHaveValue('');
    await expect(page.getByText(/Module Completion Deadline/i)).toBeVisible();

    // Next triggers analyzeStoredDocument (course-ai.ts, deprecated v1
    // pipeline) against Vertex AI, which has no credentials here — the
    // wizard's `finally` block advances to Step 3 regardless of that call's
    // outcome, so this must not hang.
    await page.getByRole('button', { name: 'Next Step' }).click();
    await expect(page.getByText(/step 3 of 7/i)).toBeVisible({ timeout: 30000 });

    // Step 3 — Details. Auto-analysis never ran successfully (no AI creds),
    // so title/description/objectives are still blank and must be filled.
    await expect(page.getByRole('heading', { name: 'Course Details' })).toBeVisible();
    await page.locator('#course-title').fill('Infection Control Essentials');
    await page
      .locator('#course-description')
      .fill('A short course covering core infection-control procedures.');
    const objectiveInputs = page.getByPlaceholder(/^Objective \d$/);
    await objectiveInputs.nth(0).fill('Identify common infection risks.');
    await objectiveInputs.nth(1).fill('Apply standard precautions correctly.');
    await objectiveInputs.nth(2).fill('Report exposure incidents promptly.');
    await expect(page.getByRole('button', { name: 'Next Step' })).toBeEnabled();
    await page.getByRole('button', { name: 'Next Step' }).click();

    // Step 4 — Quiz. Reaching a Next-enabled state here is the coverage
    // boundary: clicking through would start real (unavailable) generation.
    await expect(page.getByText(/step 4 of 7/i)).toBeVisible();
    await page.locator('#quiz-title').fill('Infection Control Knowledge Check');
    await expect(page.getByRole('button', { name: 'Next Step' })).toBeEnabled();
  });
});
