/**
 * E2E spec: quiz AI-generation controls — "Generate with AI" (single question),
 * "Regenerate Quiz" (whole set), and their surrounding save/delete affordances.
 *
 * Before this spec, `tests/e2e/` had ZERO coverage of these controls (grep for
 * "Generate with AI" / "Add new question" / "Regenerate Quiz" / "Save Question"
 * returned nothing) — which is why a bug where "Generate with AI" failed ~2 in
 * 3 attempts with a Cloudflare 524 reached staging unnoticed. Fixed in #657 by
 * bounding the Vertex retry budget to 45s on browser-awaited paths and
 * returning an actionable "The AI service is taking longer than usual…"
 * message instead of a bare network failure. #647 fixed AI-added questions
 * arriving with no explanation (the schema now requires one). #657 also
 * replaced 13 native `alert()`s and a `confirm()` in `Step6QuizReview.tsx` /
 * `AdminQuizEditor.tsx` with shadcn `Alert`/`AlertDialog` — this spec proves no
 * native dialog fires on either control.
 *
 * ── The Vertex constraint (read this before touching AI assertions) ─────────
 * This environment has no live Vertex AI credentials — the same constraint
 * documented in course-creation.spec.ts, course-creation-phi-rejection.spec.ts,
 * course-publish-review-gate.spec.ts, documents.spec.ts and reminders.spec.ts.
 * `ai-client.ts`'s `callVertexAI` calls `auth.getAccessToken()` BEFORE its own
 * retry loop even starts; with no Application Default Credentials configured,
 * that call rejects immediately (a live run confirmed "Could not load the
 * default credentials"), which is neither a `PhiBlockedError` nor a
 * `VertexBudgetExceededError` — `generateSingleQuestion` / `regenerateQuiz`
 * fall through to their generic catch and return the fixed user-facing
 * messages asserted below. A genuine AI-SUCCESS path (a question or quiz
 * arriving FROM Vertex) cannot be driven live from this environment, only
 * from one with real credentials configured — this spec follows the
 * established repo pattern rather than adding new test-only stub code to
 * product source, and covers the "can be saved, with an explanation" and
 * "the set is replaced" acceptance criteria via the controls' own manual-entry
 * path, which is the same UI a human uses when they choose not to use AI (or
 * edit the AI's output before saving). See this file's final report for the
 * options considered (server-side network interception is not something
 * Playwright's `page.route` can reach — the Vertex call happens in the Next.js
 * server process, never in the browser page).
 *
 * ── Two surfaces, one pair of server actions (src/app/actions/quiz-ai.ts) ───
 *   1. `AdminQuizEditor` (src/components/courses/AdminQuizEditor.tsx) — the
 *      post-publication quiz editor at `/learn/{courseId}`'s quiz index for an
 *      admin viewer. Reached by seeding a published course directly (same
 *      technique as learn-admin-edit-affordance.spec.ts), no wizard or live
 *      generation required at all.
 *   2. `Step6QuizReview` (src/components/dashboard/courses/steps/
 *      Step6QuizReview.tsx) — the course-creation wizard's quiz-review step.
 *      Reaching it live via the wizard's own generation step is NOT possible
 *      here (see course-creation.spec.ts's docstring: generation always fails
 *      closed, so the wizard never advances past the interstitial). Instead
 *      this spec seeds the wizard's own `sessionStorage` "resume draft"
 *      feature — a real, product-intended mechanism (CourseWizard.tsx's
 *      `DRAFT_KEY`/`showResumeBanner`/"Resume Draft") — with a draft parked at
 *      `stepKey: 'quizReview'` and a fabricated `generatedContent.quiz`, which
 *      is exactly what a genuine successful generation would have left
 *      behind. This is not new product code; it exercises the wizard's
 *      existing resume path the same way a real interrupted session would.
 *      The AI-context text is kept under `phiScanner.ts`'s 50-char
 *      `MIN_SCAN_LENGTH` (same technique as course-creation-phi-rejection.spec.ts)
 *      so the PHI pre-check resolves via the deterministic local pre-pass
 *      before the (credential-less, and therefore failing) Vertex call — the
 *      assertions below are about the GENERATION failure, not the PHI gate.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - DATABASE_URL reachable for direct DB seeding (AdminQuizEditor tests).
 *   - prisma/seed.ts has been run (admin@test.com — the wizard tests reuse it,
 *     matching course-creation.spec.ts's own login helper).
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

const GENERATION_FAILED_MESSAGE =
  "We couldn't generate a question just now. Please try again in a moment.";
const REGENERATION_FAILED_MESSAGE =
  "We couldn't regenerate the quiz just now. Please try again in a moment.";

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@quiz-ai-e2e.invalid`;
}

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

/** Fails the test if a native `alert`/`confirm`/`prompt` fires — every dialog
 * on these two surfaces must be the in-page shadcn Alert/AlertDialog now. */
function guardAgainstNativeDialogs(page: Page): void {
  page.on('dialog', (dialog) => {
    throw new Error(
      `Unexpected native ${dialog.type()} dialog fired: "${dialog.message()}". ` +
        'This control must use the in-page Alert/AlertDialog, not a native one.',
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AdminQuizEditor — post-publication quiz editing (/learn/{courseId} quiz index)
// ─────────────────────────────────────────────────────────────────────────────

interface AdminEditorFixture {
  orgId: string;
  facilityId: string;
  hrUserId: string;
  hrOrgUserId: string;
  hrEmail: string;
  hrPassword: string;
  courseId: string;
  lessonId: string;
  quizId: string;
  seededQuestionId: string;
}

async function seedAdminEditorFixture(): Promise<AdminEditorFixture> {
  const client = await db();
  try {
    const slug = `quiz-ai-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Quiz AI E2E ${slug}`, slug, uid('org')],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Quiz AI Facility ${slug}`],
    );

    const periodStart = new Date();
    const periodEnd = new Date(periodStart);
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    await client.query(
      `INSERT INTO subscriptions (
         id, organization_id, stripe_subscription_id, stripe_price_id, plan,
         billing_cycle, status, current_period_start, current_period_end,
         cancel_at_period_end, paused_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'growth'::"SubscriptionPlan", 'yearly'::"SubscriptionBillingCycle",
         'active'::"SubscriptionStatus", $5, $6, false, NULL, NOW(), NOW())`,
      [
        crypto.randomUUID(),
        orgId,
        `sub_e2e_${crypto.randomBytes(6).toString('hex')}`,
        `price_e2e_${crypto.randomBytes(6).toString('hex')}`,
        periodStart,
        periodEnd,
      ],
    );

    const hrUserId = crypto.randomUUID();
    const hrOrgUserId = crypto.randomUUID();
    const hrPassword = 'QuizAiHr!9';
    const hrEmail = uid('hr');
    const hashed = await bcrypt.hash(hrPassword, 10);

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
      [hrUserId, hrEmail, hashed, 'QuizAi', 'Hr', 'QuizAi Hr'],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'hr'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [hrOrgUserId, hrUserId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), hrOrgUserId, facilityId],
    );

    const courseId = crypto.randomUUID();
    const lessonId = crypto.randomUUID();
    const quizId = crypto.randomUUID();
    const seededQuestionId = crypto.randomUUID();

    await client.query(
      `INSERT INTO courses (
         id, title, description, status, created_by_org_user_id, organization_id,
         type, is_global, review_required, created_at, updated_at
       ) VALUES ($1, $2, $3, 'published'::"CourseStatus", $4, $5, 'text'::"CourseType", false, false, NOW(), NOW())`,
      [
        courseId,
        `Quiz AI E2E Course ${slug}`,
        'A course seeded to exercise quiz AI generation.',
        hrOrgUserId,
        orgId,
      ],
    );
    await client.query(
      `INSERT INTO lessons (id, course_id, title, content, "order", media_status, created_at, updated_at)
       VALUES ($1, $2, 'Module 1', $3, 0, 'ready'::"MediaStatus", NOW(), NOW())`,
      [lessonId, courseId, '<p>Lesson content for the quiz AI editor spec.</p>'],
    );
    await client.query(
      `INSERT INTO quizzes (id, lesson_id, title, passing_score, allowed_attempts, created_at)
       VALUES ($1, $2, 'Quiz AI E2E Quiz', 70, 2, NOW())`,
      [quizId, lessonId],
    );
    await client.query(
      `INSERT INTO questions (id, quiz_id, text, type, options, correct_answer, "order")
       VALUES ($1, $2, $3, 'multiple_choice', $4::jsonb, $5, 0)`,
      [
        seededQuestionId,
        quizId,
        'Seeded question — what is the correct option?',
        JSON.stringify(['Alpha', 'Bravo', 'Charlie', 'Delta']),
        'Bravo',
      ],
    );

    return {
      orgId,
      facilityId,
      hrUserId,
      hrOrgUserId,
      hrEmail,
      hrPassword,
      courseId,
      lessonId,
      quizId,
      seededQuestionId,
    };
  } finally {
    await client.end();
  }
}

async function cleanupAdminEditorFixture(f: AdminEditorFixture): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM enrollments WHERE course_id = $1`, [f.courseId]);
    await client.query(`DELETE FROM questions WHERE quiz_id = $1`, [f.quizId]);
    await client.query(`DELETE FROM quizzes WHERE id = $1`, [f.quizId]);
    await client.query(`DELETE FROM lessons WHERE course_id = $1`, [f.courseId]);
    await client.query(`DELETE FROM courses WHERE id = $1`, [f.courseId]);
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [f.orgId]);
    await client.query(`DELETE FROM organization_user_facilities WHERE organization_user_id = $1`, [
      f.hrOrgUserId,
    ]);
    await client.query(`DELETE FROM organization_users WHERE id = $1`, [f.hrOrgUserId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [f.hrUserId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [f.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [f.orgId]);
  } finally {
    await client.end();
  }
}

async function loginAsAdmin(page: Page, email: string, password: string): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 45000 });
}

async function openAdminQuizEditor(page: Page, courseId: string): Promise<void> {
  await page.goto(`/learn/${courseId}`);
  await page.waitForLoadState('networkidle');
  // CourseRail (and its "QUIZ" rail tile) only renders once already on the
  // quiz screen (`showSharedLayout = isQuizIndex || ...`) — from the lesson
  // view, "Proceed to Quiz" is what advances into it. Admin viewers bypass
  // the earned-progress gate (`isProceedBlocked`'s `userData?.isAdminView`
  // check), so it's enabled immediately, with no scrolling/completion needed.
  await page.getByRole('button', { name: 'Proceed to Quiz' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Quiz Questions' })).toBeVisible({
    timeout: 15000,
  });
}

test.describe('AdminQuizEditor — post-publication quiz editing (PR #647 / #657)', () => {
  test('a manually-added question with an explanation saves and survives a reload', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    guardAgainstNativeDialogs(page);
    const fixture = await seedAdminEditorFixture();

    try {
      await loginAsAdmin(page, fixture.hrEmail, fixture.hrPassword);
      await openAdminQuizEditor(page, fixture.courseId);

      await page.getByRole('button', { name: '+ Add New Question' }).click();
      const questionText = `Manually added question ${crypto.randomBytes(3).toString('hex')}`;
      const explanationText = `Because option 2 is correct — ${crypto.randomBytes(3).toString('hex')}.`;

      await page.getByLabel('Question Text').fill(questionText);
      await page.getByRole('textbox', { name: 'Option 1' }).fill('One');
      await page.getByRole('textbox', { name: 'Option 2' }).fill('Two');
      await page.getByRole('textbox', { name: 'Option 3' }).fill('Three');
      await page.getByRole('textbox', { name: 'Option 4' }).fill('Four');
      await page.getByRole('radio', { name: 'Mark option 2 correct' }).check();
      await page.getByLabel('Detailed Explanation / Reference').fill(explanationText);

      await page.getByRole('button', { name: 'Save Question' }).click();
      await expect(page.getByText(questionText)).toBeVisible();

      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page.getByText('Quiz updated successfully.')).toBeVisible({ timeout: 15000 });

      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: 'Proceed to Quiz' }).click();
      await expect(page.getByRole('heading', { name: 'Edit Quiz Questions' })).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByText(questionText)).toBeVisible();

      // Persistence of the explanation specifically — the read-only card
      // doesn't render it, so open Edit and read the field back. The manually
      // added question is appended after the seeded one, so it's the last
      // "Edit" button in the list.
      await page.getByRole('button', { name: 'Edit' }).last().click();
      await expect(page.getByLabel('Detailed Explanation / Reference')).toHaveValue(
        explanationText,
      );
    } finally {
      await cleanupAdminEditorFixture(fixture);
    }
  });

  test('"Generate with AI" fails closed with an in-page error (no hang, no native dialog), and retry works', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    guardAgainstNativeDialogs(page);
    const fixture = await seedAdminEditorFixture();

    try {
      await loginAsAdmin(page, fixture.hrEmail, fixture.hrPassword);
      await openAdminQuizEditor(page, fixture.courseId);

      await page.getByRole('button', { name: '+ Add New Question' }).click();
      const generateButton = page.getByRole('button', { name: /Generate with AI/i });

      await generateButton.click();
      await expect(page.getByText(GENERATION_FAILED_MESSAGE)).toBeVisible({ timeout: 20000 });
      await expect(generateButton).toBeEnabled();

      // Retry: the control is not stuck after a failure.
      await generateButton.click();
      await expect(page.getByText(GENERATION_FAILED_MESSAGE)).toBeVisible({ timeout: 20000 });
    } finally {
      await cleanupAdminEditorFixture(fixture);
    }
  });

  test('delete-question confirmation uses the in-page dialog; cancelling keeps it, confirming removes it', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    guardAgainstNativeDialogs(page);
    const fixture = await seedAdminEditorFixture();
    const seededQuestionText = 'Seeded question — what is the correct option?';

    try {
      await loginAsAdmin(page, fixture.hrEmail, fixture.hrPassword);
      await openAdminQuizEditor(page, fixture.courseId);

      await expect(page.getByText(seededQuestionText)).toBeVisible();
      await page.getByRole('button', { name: 'Delete' }).first().click();

      const dialog = page.getByRole('alertdialog');
      await expect(dialog.getByText('Delete this question?')).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText(seededQuestionText)).toBeVisible();

      await page.getByRole('button', { name: 'Delete' }).first().click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await expect(page.getByText(seededQuestionText)).toHaveCount(0);
    } finally {
      await cleanupAdminEditorFixture(fixture);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step6QuizReview — the course-creation wizard's quiz-review step, reached via
// its own "resume draft" sessionStorage feature (see module docstring).
// ─────────────────────────────────────────────────────────────────────────────

const DRAFT_KEY = 'lms_course_wizard_draft_v4';

function seededQuizReviewDraft(
  quizQuestions: { question: string; options: string[]; answer: number }[],
) {
  return {
    stepKey: 'quizReview',
    formData: {
      categoryId: '',
      // Kept short on purpose: buildAiContext() assembles
      // "Course: <title>\n\n<rawContext>", and this whole string must stay
      // under phiScanner.ts's 50-char MIN_SCAN_LENGTH so the PHI pre-check
      // resolves via the deterministic local pre-pass rather than a live
      // (credential-less, and therefore failing) contextual Vertex scan —
      // the assertions in this describe block are about the GENERATION
      // failure, not the PHI gate.
      title: 'T',
      description: '',
      difficulty: 'moderate',
      duration: '10',
      notesCount: '10',
      completionDeadlineDays: 30,
      objectives: [],
      quizTitle: 'Quiz AI E2E Quiz Review',
      quizQuestionCount: String(quizQuestions.length),
      quizDifficulty: 'medium',
      quizQuestionType: 'multiple_choice',
      quizDuration: '',
      quizPassMark: '80%',
      quizAttempts: '2',
      assignments: [],
      dueDate: '',
      dueTime: '',
      modules: [],
      assignMode: 'roles',
      assignRoles: [],
      dueDeadlineEnabled: false,
      reminders: [],
      recurringEnabled: false,
      renewalCycle: 'annually',
    },
    generatedContent: {
      title: 'T',
      description: 'D',
      difficulty: 'moderate',
      duration: '10',
      objectives: [],
      modules: [{ id: 'seeded-module', title: 'Module 1', content: '' }],
      quiz: quizQuestions.map((q) => ({ ...q, type: 'multiple_choice' })),
      rawArticleMarkdown: 'hi',
    },
    savedAt: Date.now(),
  };
}

async function resumeToQuizReview(
  page: Page,
  quizQuestions: { question: string; options: string[]; answer: number }[],
): Promise<void> {
  await page.addInitScript(
    ({ key, payload }) => {
      window.sessionStorage.setItem(key, JSON.stringify(payload));
    },
    { key: DRAFT_KEY, payload: seededQuizReviewDraft(quizQuestions) },
  );
  await page.goto('/dashboard/courses/create');
  await page.getByRole('button', { name: 'Resume Draft' }).click();
  await expect(page.getByRole('heading', { name: 'Review Quiz Questions' })).toBeVisible({
    timeout: 15000,
  });
}

async function loginAsWizardAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'admin@test.com');
  await page.fill('input[type="password"]', 'Admin123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}

const SEEDED_QUIZ_QUESTIONS = [
  { question: 'Seeded review question one?', options: ['A', 'B', 'C', 'D'], answer: 0 },
  { question: 'Seeded review question two?', options: ['A', 'B', 'C', 'D'], answer: 1 },
];

test.describe('Course wizard — Review Quiz Questions step (PR #647 / #657)', () => {
  test('cancelling "Regenerate Quiz" leaves the existing questions untouched', async ({ page }) => {
    test.setTimeout(60_000);
    guardAgainstNativeDialogs(page);
    await loginAsWizardAdmin(page);
    await resumeToQuizReview(page, SEEDED_QUIZ_QUESTIONS);

    await expect(page.getByText('2 questions')).toBeVisible();
    await expect(page.getByText('Seeded review question one?')).toBeVisible();

    await page.getByRole('button', { name: 'Regenerate Quiz' }).first().click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText('Regenerate the whole quiz?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(page.getByText('2 questions')).toBeVisible();
    await expect(page.getByText('Seeded review question one?')).toBeVisible();
    await expect(page.getByText('Seeded review question two?')).toBeVisible();
  });

  test('confirming "Regenerate Quiz" fails closed with an in-page error and does NOT replace the set; retry works', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    guardAgainstNativeDialogs(page);
    await loginAsWizardAdmin(page);
    await resumeToQuizReview(page, SEEDED_QUIZ_QUESTIONS);

    const triggerRegenerate = async () => {
      await page.getByRole('button', { name: 'Regenerate Quiz' }).first().click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Regenerate Quiz' }).click();
    };

    await triggerRegenerate();
    await expect(page.getByText(REGENERATION_FAILED_MESSAGE)).toBeVisible({ timeout: 20000 });
    // Not replaced: the original two questions are still on screen.
    await expect(page.getByText('Seeded review question one?')).toBeVisible();
    await expect(page.getByText('Seeded review question two?')).toBeVisible();
    await expect(page.getByText('2 questions')).toBeVisible();

    // Retry: the control is not stuck after a failure.
    await triggerRegenerate();
    await expect(page.getByText(REGENERATION_FAILED_MESSAGE)).toBeVisible({ timeout: 20000 });
  });

  test('"Generate with AI" fails closed with an in-page error, and a manually filled question can still be saved', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    guardAgainstNativeDialogs(page);
    await loginAsWizardAdmin(page);
    await resumeToQuizReview(page, SEEDED_QUIZ_QUESTIONS);

    await page.getByRole('button', { name: 'Add new question' }).click();
    const generateButton = page.getByRole('button', { name: /Generate with AI/i });
    await generateButton.click();
    await expect(page.getByText(GENERATION_FAILED_MESSAGE)).toBeVisible({ timeout: 20000 });
    await expect(generateButton).toBeEnabled();

    const questionText = `Manually added wizard question ${crypto.randomBytes(3).toString('hex')}`;
    await page.getByPlaceholder('Enter your question here...').fill(questionText);
    const optionInputs = page.getByPlaceholder(/^Option \d$/);
    await optionInputs.nth(0).fill('One');
    await optionInputs.nth(1).fill('Two');
    await optionInputs.nth(2).fill('Three');
    await optionInputs.nth(3).fill('Four');
    await page.getByRole('radio', { name: 'Mark option 2 correct' }).check();

    await page.getByRole('button', { name: 'Save Question' }).click();
    await expect(page.getByText(questionText)).toBeVisible();
    await expect(page.getByText('3 questions')).toBeVisible();
  });
});
