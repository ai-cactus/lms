import { test, expect } from '@playwright/test';

/**
 * Phase 3 QA regression coverage for:
 *  1. retakeQuiz()/quiz start/submit's append-history attempt-limit + lockout
 *     enforcement (src/app/actions/course.ts, src/app/api/quiz/[id]/{start,submit}).
 *  2. The attestation-gate fix in src/app/learn/[id]/page.tsx — showAttestation
 *     now uses isWorkerRole() instead of a strict `role === 'worker'` check, so
 *     a genuine job-specific sub-role (e.g. `nurse`) that passes the quiz can
 *     attest, which it never could before.
 *
 * Seeded fixtures (prisma/seed.ts): the shared 'E2E Compliance Training'
 * course (1 question, passingScore 70, allowedAttempts 3), with three workers
 * pre-positioned at progress:100 / in_progress / zero quiz attempts so their
 * specs land straight on the quiz intro screen:
 *   - nina.nurse@test.com (role: nurse) — attestation-gate coverage.
 *   - larry.lockout@test.com (role: front_desk_admin) — API-driven fail-x3/lockout coverage.
 *   - rita.retake@test.com (role: front_desk_admin) — self-service UI retake coverage,
 *     kept separate from larry.lockout so the two specs never contend over the
 *     same enrollment's attempt history.
 */

const COURSE_TITLE = 'E2E Compliance Training';
const ENROLLMENT_LOCKOUT_ID = '88888888-8888-4888-8888-888888888886';
const QUIZ_ID = '66666666-6666-4666-8666-666666666661';
const COURSE_ID = '44444444-4444-4444-8444-444444444441';
const QUESTION_ID = '77777777-7777-4777-8777-777777777771';
const WRONG_ANSWER = 'Ignore it and continue working';

async function loginAsWorker(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/worker');
}

test.describe('Quiz retake lockout (append-history model)', () => {
  test('locks the enrollment after 3 failed attempts and /start then returns 403 QUIZ_LOCKED_MAX_ATTEMPTS', async ({
    page,
  }) => {
    // Drive the append-history start/submit contract directly via the
    // authenticated session's cookies (page.request shares the browser
    // context). This is the same contract the "Retake Quiz" UI button relies
    // on internally, and is what retakeQuiz()/the route fixes actually changed —
    // exercising it end-to-end proves the fix without depending on the
    // separate learn-page UI regression documented below.
    await loginAsWorker(page, 'larry.lockout@test.com');

    for (let attempt = 1; attempt <= 3; attempt++) {
      const startRes = await page.request.post(`/api/quiz/${QUIZ_ID}/start`, {
        data: { enrollmentId: ENROLLMENT_LOCKOUT_ID },
      });
      expect(startRes.status(), `attempt ${attempt} /start`).toBe(200);
      const startBody = await startRes.json();
      expect(startBody.attempt.attemptCount).toBe(attempt);
      expect(startBody.attempt.timeTaken).toBeNull();

      const submitRes = await page.request.post(`/api/quiz/${QUIZ_ID}/submit`, {
        data: {
          enrollmentId: ENROLLMENT_LOCKOUT_ID,
          answers: [{ questionId: QUESTION_ID, selectedAnswer: WRONG_ANSWER }],
          timeTaken: 5,
        },
      });
      expect(submitRes.status(), `attempt ${attempt} /submit`).toBe(200);
      const submitBody = await submitRes.json();
      expect(submitBody.passed).toBe(false);
      expect(submitBody.attemptsUsed).toBe(attempt);
      expect(submitBody.allowedAttempts).toBe(3);
    }

    // 4th start after 3 completed failures: enrollment is now locked.
    const lockedRes = await page.request.post(`/api/quiz/${QUIZ_ID}/start`, {
      data: { enrollmentId: ENROLLMENT_LOCKOUT_ID },
    });
    expect(lockedRes.status()).toBe(403);
    const lockedBody = await lockedRes.json();
    expect(lockedBody.error).toBe('QUIZ_LOCKED_MAX_ATTEMPTS');

    // The learn page surfaces the lock by showing the 3rd (final) attempt's
    // review with the "Retake Quiz" affordance now hidden (QuizResults'
    // canRetake correctly goes false once attemptsUsed >= allowedAttempts) —
    // the user-visible signal that no further self-service attempt exists.
    await page.goto(`/learn/${COURSE_ID}`);
    await expect(page.getByText('Attempt 3 of 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retake Quiz' })).not.toBeVisible();
  });

  test('self-service "Retake Quiz" lands on a fresh Start-Quiz screen and lets the worker complete attempt 2', async ({
    page,
  }) => {
    // Regression test for the retake-restore fix in
    // src/app/learn/[id]/page.tsx: retakeQuiz() resets enrollment.score to
    // null without mutating quiz-attempt history, so the client's
    // restore-on-load logic now has a THIRD branch (distinct from "review a
    // submitted attempt" and "resume an active draft"): hasQuizAttempt &&
    // !activeAttempt && score === null → "retake pending", which lands the
    // worker on the quiz intro screen (Start Quiz) instead of re-showing the
    // stale review of the attempt they just retook.
    //
    // Before the fix, this got stuck on repeat: retakeQuiz() applied
    // server-side (enrollment.status flipped back to in_progress) but the
    // client kept re-rendering the OLD failed-attempt review with the same
    // "Retake Quiz" button, from every navigation path into the course —
    // confirmed directly against a running dev server.
    //
    // Uses a dedicated fixture (rita.retake@test.com) so this UI journey
    // never contends with the API-driven lockout spec above over the same
    // enrollment's attempt history.
    await loginAsWorker(page, 'rita.retake@test.com');

    await page.getByText(COURSE_TITLE).first().click();
    await page.waitForURL('**/worker/courses/**');
    await page
      .getByRole('button', { name: /continue course|start course|resume course/i })
      .click();
    await page.waitForURL('**/learn/**');

    await page.getByRole('button', { name: 'Proceed to Quiz' }).click();
    await page.getByRole('button', { name: 'Start Quiz' }).click();
    await page.locator('[data-quiz-option="1"]').click(); // wrong answer
    await page.getByRole('button', { name: /Submit Quiz/ }).click();

    await expect(page.getByText('Attempt 1 of 3')).toBeVisible();
    const retakeButton = page.getByRole('button', { name: 'Retake Quiz' });
    await expect(retakeButton).toBeVisible();
    await retakeButton.click();

    // The retake lands on a fresh intro screen — "Attempt 2 of 3" + Start Quiz —
    // not the stale attempt-1 review.
    await expect(page.getByRole('button', { name: 'Start Quiz' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('Attempt 2 of 3')).toBeVisible();

    // Complete attempt 2 end-to-end (fail again) to prove /start actually
    // appends a new draft attempt rather than resuming/reusing attempt 1's row.
    // (The active-quiz header renders this same text uppercased via CSS
    // text-transform, so match case-insensitively.)
    await page.getByRole('button', { name: 'Start Quiz' }).click();
    await expect(page.getByText(/attempt 2 of 3/i)).toBeVisible();
    await page.locator('[data-quiz-option="2"]').click(); // wrong answer
    await page.getByRole('button', { name: /Submit Quiz/ }).click();

    await expect(page.getByText('Attempt 2 of 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retake Quiz' })).toBeVisible();
  });
});

test.describe('Attestation gate for sub-role workers (isWorkerRole fix)', () => {
  test('a nurse (job-specific worker sub-role) can pass the quiz and attest', async ({ page }) => {
    await loginAsWorker(page, 'nina.nurse@test.com');

    await page.getByText(COURSE_TITLE).first().click();
    await page.waitForURL('**/worker/courses/**');
    await page
      .getByRole('button', { name: /continue course|start course|resume course/i })
      .click();
    await page.waitForURL('**/learn/**');

    await page.getByRole('button', { name: 'Proceed to Quiz' }).click();
    await page.getByRole('button', { name: 'Start Quiz' }).click();
    await page.locator('[data-quiz-option="0"]').click(); // correct answer
    await page.getByRole('button', { name: /Submit Quiz/ }).click();

    await expect(page.getByText(/nice work/i)).toBeVisible();

    // Regression guard: before the fix, showAttestation checked
    // `userData?.role === 'worker'` literally, which no real sub-role
    // (including `nurse`) ever equals — the button never appeared.
    const attestButton = page.getByRole('button', { name: 'Attestate' });
    await expect(attestButton).toBeVisible();
    await attestButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.getByLabel('Name').fill('Nina Nurse');
    await dialog.getByRole('checkbox').nth(0).click();
    await dialog.getByRole('checkbox').nth(1).click();
    await dialog.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText("Well done! You've earned a Certificate!")).toBeVisible({
      timeout: 10000,
    });
  });
});
