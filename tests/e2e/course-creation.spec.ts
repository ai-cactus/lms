/**
 * E2E spec: course creation wizard — full single-document flow (D1: one
 * document, one module per course; course-creation-flow-redesign PR-3a).
 *
 * Replaces course-wizard-module-builder.spec.ts, which drove the deleted
 * multi-module builder (Step2Modules) and is obsolete now that Step2Upload
 * owns a single document with no per-module title/objective/deadline.
 *
 * Steps 1 through 4 (category, single-document upload, details, quiz) are
 * driven live end to end, including a REAL upload through the actual
 * uploadDocument -> extractTextFromFile -> scanText pipeline (kept under
 * phiScanner.ts's 50-char MIN_SCAN_LENGTH so the clean verdict resolves via
 * the deterministic local pre-pass, with no live AI call — see
 * course-creation-phi-rejection.spec.ts for the fuller explanation of that
 * boundary).
 *
 * What this spec does NOT drive live: the generation step's own AI call, and
 * therefore quiz review, assign & publish, and the success modal. Every
 * environment available to this suite — this sandbox's .env AND CI's own
 * .env.e2e (GOOGLE_PROJECT_ID=ci-dummy-project-not-real) — has no live Vertex
 * AI credentials, and ai-client.ts's `requireProjectId` refuses to call Vertex
 * at all without a real project. A live run against this exact test file
 * confirmed the failure mode directly: Vertex responded "Could not load the
 * default credentials." This is the same constraint
 * course-publish-review-gate.spec.ts documents for the same reason — a live success-path generation cannot be driven from this
 * environment, only from one with real Vertex credentials configured.
 *
 * What IS covered here for the generation step: entering it immediately shows
 * "Step 4 of 7" — the interstitial borrows the quiz step's number for as long
 * as it has produced no content (wizardSteps.ts's `displayStepNumber`),
 * covering both the polling interstitial and the failure card that replaces
 * it in place once the (credential-less) generation call fails.
 *
 * The single-module invariant this PR introduces (a course generated from one
 * document has exactly one `CourseModule`) is covered at the unit level
 * instead — GenerationController's module fan-out is driven directly off
 * `data.modules`, which D1 narrows to length 0 or 1 (see types/course.ts).
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005.
 *   - prisma/seed.ts has been run (admin@test.com).
 *   - MinIO reachable (the clean upload reaches storage).
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

test.describe('Course creation wizard — single-document flow', () => {
  test('drives category through quiz with a real upload, then reaches the generation interstitial at Step 4 of 7', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    await page.goto('/dashboard/courses/create');
    await expect(page.getByText(/step 1 of 7/i)).toBeVisible();

    // ── Step 1: Category ──
    await page.getByRole('combobox').first().click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Next Step' }).click();

    // ── Step 2: single-document upload ──
    await expect(page.getByText(/step 2 of 7/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upload Training Documents' })).toBeVisible();

    await page.getByLabel(/contains no Personal Health Information/i).click();
    const trainingDoc = await buildDocx('Annual infection-control refresher training.');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'infection-control-training.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: trainingDoc,
    });
    await expect(page.getByText(/No Protected Health Information \(PHI\) detected/i)).toBeVisible();
    await expect(page.getByText('infection-control-training.docx')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next Step' })).toBeEnabled();
    await page.getByRole('button', { name: 'Next Step' }).click();

    // Advancing off Upload also fires the deprecated v1 analyzeStoredDocument
    // call (course-ai.ts) against the just-uploaded content. It logs "Document
    // content is empty or too short" here — the same <50-char text kept the
    // PHI verdict on the deterministic local pre-pass above — but
    // CourseWizard.tsx's `finally` block advances regardless of that call's
    // outcome, matching the precedent this spec replaces
    // (course-wizard-module-builder.spec.ts).

    // ── Step 3: Details ──
    // The wizard's Next-defaults already satisfy notesCount (10) and the
    // completion deadline (30 days); only title, description and all three
    // objectives are blank on a fresh draft.
    await expect(page.getByText(/step 3 of 7/i)).toBeVisible({ timeout: 30000 });
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

    // ── Step 4: Quiz ──
    // quizQuestionCount ('5') and quizPassMark ('80%') already default to
    // valid values; only the quiz title is blank.
    await expect(page.getByText(/step 4 of 7/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Course Quiz' })).toBeVisible();
    await page.locator('#quiz-title').fill('Infection Control Knowledge Check');
    await expect(page.getByRole('button', { name: 'Next Step' })).toBeEnabled();
    await page.getByRole('button', { name: 'Next Step' }).click();

    // ── Generation interstitial ──
    // Advancing past Quiz enters the 'generate' step, which borrows the quiz
    // step's displayed number for as long as it has produced no content —
    // covering the polling interstitial. Reaching a genuine SUCCESS state
    // needs live Vertex AI credentials this environment does not have (see
    // this file's module docstring); the header assertion below is the
    // coverage boundary.
    await expect(page.getByText(/step 4 of 7/i)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Your course is being created…' }),
    ).toBeVisible();
  });
});
