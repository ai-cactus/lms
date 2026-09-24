/**
 * The manual-entry inputs of the post-publication quiz editor must carry an
 * accessible name, the way the wizard's Step6QuizReview ones do — a screen
 * reader (and every test locator) otherwise has nothing to announce them by.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import AdminQuizEditor from './AdminQuizEditor';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/actions/course', () => ({ updateQuizQuestions: vi.fn() }));
vi.mock('@/app/actions/quiz-ai', () => ({ generateSingleQuestion: vi.fn() }));

const INITIAL_QUESTIONS = [
  {
    id: 'q1',
    text: 'Which option is correct?',
    options: ['One', 'Two', 'Three', 'Four'],
    correctAnswer: 'Two',
    type: 'multiple_choice',
    order: 0,
    explanation: 'Because two.',
  },
];

function renderEditor() {
  render(<AdminQuizEditor courseId="course-1" initialQuestions={INITIAL_QUESTIONS} />);
  return userEvent.setup();
}

describe('AdminQuizEditor — accessible names', () => {
  it('names every input of the add-question form', async () => {
    const user = renderEditor();
    await user.click(screen.getByRole('button', { name: '+ Add New Question' }));

    expect(screen.getByLabelText('Question Text')).toBeInTheDocument();
    expect(screen.getByLabelText('Detailed Explanation / Reference')).toBeInTheDocument();

    for (const position of [1, 2, 3, 4]) {
      expect(screen.getByRole('radio', { name: `Mark option ${position} correct` })).toBeVisible();
      expect(screen.getByRole('textbox', { name: `Option ${position}` })).toBeVisible();
    }
  });

  it('names every input of the edit-question form', async () => {
    const user = renderEditor();
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Question Text')).toHaveValue('Which option is correct?');
    expect(screen.getByLabelText('Detailed Explanation / Reference')).toHaveValue('Because two.');

    for (const [index, option] of INITIAL_QUESTIONS[0].options.entries()) {
      expect(screen.getByRole('radio', { name: `Mark option ${index + 1} correct` })).toBeVisible();
      expect(screen.getByRole('textbox', { name: `Option ${index + 1}` })).toHaveValue(option);
    }
  });

  it('keeps the labelled controls wired to the state they edit', async () => {
    const user = renderEditor();
    await user.click(screen.getByRole('button', { name: '+ Add New Question' }));

    await user.type(screen.getByLabelText('Question Text'), 'A new question');
    await user.type(screen.getByRole('textbox', { name: 'Option 1' }), 'First');
    await user.click(screen.getByRole('radio', { name: 'Mark option 3 correct' }));

    expect(screen.getByLabelText('Question Text')).toHaveValue('A new question');
    expect(screen.getByRole('textbox', { name: 'Option 1' })).toHaveValue('First');
    expect(screen.getByRole('radio', { name: 'Mark option 3 correct' })).toBeChecked();
  });
});
