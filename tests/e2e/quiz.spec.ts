import { test, expect } from '@playwright/test';

const SEEDED_COURSE_TITLE = 'E2E Compliance Training';

test.describe('Quiz Flows', () => {
  test('ENG-020: Clicking the 4th option highlights that option, not the 1st', async ({ page }) => {
    await page.goto('/login');

    // Seeded worker with an in-progress enrollment in the compliance course.
    await page.fill('input[type="email"]', 'sarah.johnson@company.com');
    await page.fill('input[type="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');

    // Workers land on /worker, not /dashboard.
    await page.waitForURL('**/worker');

    // Open the seeded course from the worker dashboard list (target by title so
    // the test doesn't depend on row order), then enter the course player.
    await page.getByText(SEEDED_COURSE_TITLE).first().click();
    await page.waitForURL('**/worker/courses/**');
    await page.getByRole('button', { name: /continue course|start course|resume course/i }).click();
    await page.waitForURL('**/learn/**');

    // From the lesson, proceed to the quiz. The "Proceed to Quiz" CTA
    // (src/app/learn/[id]/page.tsx's onProceedToQuiz handler) unlocks the quiz
    // and jumps straight to the intro screen — it does NOT show the "Ready for
    // the Quiz?" gate modal (that modal only appears via the "Next" lesson
    // navigation button when the quiz isn't yet unlocked, a different path).
    await page.getByRole('button', { name: 'Proceed to Quiz' }).click();

    // Start the quiz from the intro screen.
    await expect(page.getByRole('button', { name: 'Start Quiz' })).toBeVisible();
    await page.getByRole('button', { name: 'Start Quiz' }).click();

    // Options expose data-quiz-option (0-based index) and data-selected hooks.
    const options = page.locator('[data-quiz-option]');
    await expect(options).toHaveCount(4);

    const firstOption = page.locator('[data-quiz-option="0"]');
    const fourthOption = page.locator('[data-quiz-option="3"]');

    // Click the 4th option and assert IT is selected while the 1st is not
    // (ENG-020 regression: selecting D used to highlight A).
    await fourthOption.click();
    await expect(fourthOption).toHaveAttribute('data-selected', 'true');
    await expect(firstOption).toHaveAttribute('data-selected', 'false');
  });
});
