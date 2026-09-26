/**
 * Founder ruling Q-19: a question added one-at-a-time must carry an explanation
 * just like a generated one, and the rationale that already exists must survive
 * an edit.
 *
 * This editor is the hazard: `updateQuizQuestions` DELETES the quiz's questions
 * and recreates them from exactly what this component sends, so any field the
 * editor drops is erased from every question in the course — not just the one
 * being edited. Before Q-19 it dropped the per-distractor rationale outright.
 *
 * Its manual-entry inputs must also carry an accessible name, the way the
 * wizard's Step6QuizReview ones do — a screen reader (and every test locator)
 * otherwise has nothing to announce them by (BUG-03).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUpdateQuizQuestions, mockGenerateSingleQuestion, mockRefresh } = vi.hoisted(() => ({
  mockUpdateQuizQuestions: vi.fn(),
  mockGenerateSingleQuestion: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('@/app/actions/course', () => ({ updateQuizQuestions: mockUpdateQuizQuestions }));
vi.mock('@/app/actions/quiz-ai', () => ({ generateSingleQuestion: mockGenerateSingleQuestion }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import AdminQuizEditor from './AdminQuizEditor';

const EXISTING_QUESTION = {
  id: 'q-1',
  text: 'How soon must an incident be reported?',
  options: ['24 hours', '48 hours', '72 hours', '7 days'],
  correctAnswer: '72 hours',
  type: 'multiple_choice',
  order: 0,
  explanation: 'Policy states 72 hours.',
  incorrectOptionExplanations: {
    '0': 'Understates the window (D1).',
    '3': 'Overshoots the window (D4).',
  },
};

function renderEditor() {
  render(<AdminQuizEditor courseId="course-1" initialQuestions={[EXISTING_QUESTION]} />);
}

async function saveQuiz() {
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(mockUpdateQuizQuestions).toHaveBeenCalled());
  return mockUpdateQuizQuestions.mock.calls[0][1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateQuizQuestions.mockResolvedValue({ success: true });
});

describe('AdminQuizEditor — per-option rationale', () => {
  it('shows the stored rationale beside the option it explains', () => {
    renderEditor();

    expect(screen.getByText('Understates the window (D1).')).toBeInTheDocument();
    expect(screen.getByText('Overshoots the window (D4).')).toBeInTheDocument();
  });

  it('sends the stored rationale back on save instead of erasing it', async () => {
    renderEditor();

    const [saved] = await saveQuiz();
    expect(saved.incorrectOptionExplanations).toEqual(
      EXISTING_QUESTION.incorrectOptionExplanations,
    );
  });

  it('keeps the rationale an AI-generated question came with', async () => {
    mockGenerateSingleQuestion.mockResolvedValue({
      success: true,
      question: {
        question: 'Who signs the incident report?',
        options: ['The supervisor', 'The worker', 'HR', 'Nobody'],
        answer: 0,
        type: 'multiple_choice',
        explanation: {
          correctExplanation: 'The supervisor countersigns every report.',
          incorrectOptions: { '1': 'The worker only drafts it (D2).' },
        },
      },
    });

    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Add New Question' }));
    fireEvent.click(screen.getByRole('button', { name: /Generate with AI/ }));
    await waitFor(() =>
      expect(screen.getByDisplayValue('Who signs the incident report?')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Question' }));

    const saved = await saveQuiz();
    expect(saved).toHaveLength(2);
    expect(saved[1].explanation).toBe('The supervisor countersigns every report.');
    expect(saved[1].incorrectOptionExplanations).toEqual({
      '1': 'The worker only drafts it (D2).',
    });
  });

  it('drops the rationale for an option whose text the author rewrote', async () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    fireEvent.change(screen.getByDisplayValue('24 hours'), {
      target: { value: '12 hours' },
    });
    // The edit card carries its own "Save Changes" beneath the quiz-level one.
    const [, saveEdit] = screen.getAllByRole('button', { name: 'Save Changes' });
    fireEvent.click(saveEdit);

    const [saved] = await saveQuiz();
    expect(saved.options[0]).toBe('12 hours');
    expect(saved.incorrectOptionExplanations).toEqual({ '3': 'Overshoots the window (D4).' });
  });
});

const UNLABELLED_QUESTION = {
  id: 'q1',
  text: 'Which option is correct?',
  options: ['One', 'Two', 'Three', 'Four'],
  correctAnswer: 'Two',
  type: 'multiple_choice',
  order: 0,
  explanation: 'Because two.',
};

function renderUnlabelledEditor() {
  render(<AdminQuizEditor courseId="course-1" initialQuestions={[UNLABELLED_QUESTION]} />);
  return userEvent.setup();
}

describe('AdminQuizEditor — accessible names', () => {
  it('names every input of the add-question form', async () => {
    const user = renderUnlabelledEditor();
    await user.click(screen.getByRole('button', { name: '+ Add New Question' }));

    expect(screen.getByLabelText('Question Text')).toBeInTheDocument();
    expect(screen.getByLabelText('Detailed Explanation / Reference')).toBeInTheDocument();

    for (const position of [1, 2, 3, 4]) {
      expect(screen.getByRole('radio', { name: `Mark option ${position} correct` })).toBeVisible();
      expect(screen.getByRole('textbox', { name: `Option ${position}` })).toBeVisible();
    }
  });

  it('names every input of the edit-question form', async () => {
    const user = renderUnlabelledEditor();
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Question Text')).toHaveValue('Which option is correct?');
    expect(screen.getByLabelText('Detailed Explanation / Reference')).toHaveValue('Because two.');

    for (const [index, option] of UNLABELLED_QUESTION.options.entries()) {
      expect(screen.getByRole('radio', { name: `Mark option ${index + 1} correct` })).toBeVisible();
      expect(screen.getByRole('textbox', { name: `Option ${index + 1}` })).toHaveValue(option);
    }
  });

  it('keeps the labelled controls wired to the state they edit', async () => {
    const user = renderUnlabelledEditor();
    await user.click(screen.getByRole('button', { name: '+ Add New Question' }));

    await user.type(screen.getByLabelText('Question Text'), 'A new question');
    await user.type(screen.getByRole('textbox', { name: 'Option 1' }), 'First');
    await user.click(screen.getByRole('radio', { name: 'Mark option 3 correct' }));

    expect(screen.getByLabelText('Question Text')).toHaveValue('A new question');
    expect(screen.getByRole('textbox', { name: 'Option 1' })).toHaveValue('First');
    expect(screen.getByRole('radio', { name: 'Mark option 3 correct' })).toBeChecked();
  });
});
