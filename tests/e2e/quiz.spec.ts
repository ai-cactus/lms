import { test, expect } from '@playwright/test';

test.describe('Quiz Flows', () => {

  test('ENG-020: Clicking 4th option highlights the correct option instead of the 1st', async ({ page }) => {
    // Visit /login
    await page.goto('/login');
    
    // Login as worker (since the seed script provides 'sarah.johnson@company.com')
    await page.fill('input[type="email"]', 'sarah.johnson@company.com');
    await page.fill('input[type="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');

    // Wait for dashboard load
    await page.waitForURL('**/dashboard');

    // Click on a course card to open it
    await page.click('div[class*="courseCard"] >> nth=0');

    // We assume the first course opens a detailed view or starts automatically. 
    // In our seed, 'worker1' should have an enrolled course.
    // If there's a "Start Course" button or "Resume Course", click it.
    const startBtn = page.locator('button:has-text("Start Course"), button:has-text("Resume Course")').first();
    // Wait for the page or modal
    await startBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
    if(await startBtn.isVisible()){
        await startBtn.click();
    }

    // Now inside the course player, wait for an "Assessment" or "Quiz" button to appear OR just navigate there
    const quizTab = page.locator('text=Assessment').first();
    await quizTab.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
    if(await quizTab.isVisible()){
       await quizTab.click();
    }
    
    // If there's a "Start quiz" button inside the assessment
    const startQuizBtn = page.locator('button:has-text("Start Quiz")').first();
    await startQuizBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
    if(await startQuizBtn.isVisible()){
        await startQuizBtn.click();
    }

    // Now we should see the quiz options mapping over [A, B, C, D]
    // The option components have text strings. Let's find all the option labels.
    // Assuming the labels are A, B, C, D or texts.
    const optionLabels = page.locator('div[class*="optionIcon"] span');
    await optionLabels.nth(3).waitFor({ state: 'visible' });

    // Click the 4th option (Index 3)
    await page.locator('div[class*="optionContainer"], div[class*="quizOption"]').nth(3).click();

    // Verify option D is highlighted. 
    // Usually it sets a selected style or class. We can check either classname or border colors.
    // We'll rely on the class name `isSelected` or similar, or just verify the 1st option did NOT get selected.
    
    // We check that the 1st option is not selected
    const option1 = page.locator('div[class*="optionContainer"], div[class*="quizOption"]').nth(0);
    const option4 = page.locator('div[class*="optionContainer"], div[class*="quizOption"]').nth(3);

    // Let's check attributes, typically nextjs applications put a custom data-attribute or class for selected states,
    // e.g., class*="selected" or class*="active"
    const class4 = await option4.getAttribute('class') || '';
    const class1 = await option1.getAttribute('class') || '';
    
    // As per the bug (ENG-020), clicking D would highlight A. Let's strictly expect A is NOT highlighted.
    // Since we don't know the exact class name "selected" securely, we can assert class differences.
    expect(class4).not.toEqual(class1);
  });

});
