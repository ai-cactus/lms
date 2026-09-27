/**
 * Founder ruling Q-19: the learner reviewing a graded attempt sees WHY each
 * wrong option is wrong, next to the option it explains.
 *
 * The three cases that matter are the full map, the partial map (the model or
 * author wrote a rationale for some distractors only) and the null map — every
 * question authored before `Question.incorrectOptionExplanations` existed, which
 * must render exactly as it did before, with no empty rows under the options.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import QuizResults from './QuizResults';

const OPTIONS = [
  { id: 'A', text: '24 hours' },
  { id: 'B', text: '48 hours' },
  { id: 'C', text: '72 hours' },
  { id: 'D', text: '7 days' },
];

function renderResults(options: { id: string; text: string; explanation?: string }[]) {
  render(
    <QuizResults
      courseId="course-1"
      enrollmentId="enrollment-1"
      passed
      hideActions
      data={{
        courseName: 'Infection Control',
        score: 75,
        answered: 1,
        correct: 0,
        wrong: 1,
        time: 5,
        questions: [
          {
            id: 'q-1',
            text: 'How soon must an incident be reported?',
            options,
            selectedAnswer: 'A',
            correctAnswer: 'C',
            explanation: 'Policy states 72 hours.',
          },
        ],
      }}
    />,
  );
}

/** The option's own container — `getByText` lands on the inner label row. */
function optionCard(text: string): HTMLElement {
  const card = screen.getByText(text).closest('div')?.parentElement;
  if (!card) throw new Error(`No option card for "${text}"`);
  return card;
}

describe('QuizResults — per-option rationale', () => {
  it('renders each wrong option’s rationale beside that option', () => {
    renderResults([
      { ...OPTIONS[0], explanation: 'Understates the window (D1).' },
      { ...OPTIONS[1], explanation: 'Understates the window (D2).' },
      OPTIONS[2],
      { ...OPTIONS[3], explanation: 'Overshoots the window (D4).' },
    ]);

    expect(optionCard('24 hours')).toHaveTextContent('Understates the window (D1).');
    expect(optionCard('7 days')).toHaveTextContent('Overshoots the window (D4).');

    // The correct answer keeps its single question-level explanation block and
    // gains no inline rationale of its own.
    expect(optionCard('72 hours')).not.toHaveTextContent('Understates');
    expect(screen.getByText('Policy states 72 hours.')).toBeInTheDocument();
  });

  it('renders only the rationales that exist when the map is partial', () => {
    renderResults([OPTIONS[0], OPTIONS[1], OPTIONS[2], { ...OPTIONS[3], explanation: 'D4 only.' }]);

    expect(screen.getByText('D4 only.')).toBeInTheDocument();
    expect(screen.queryByText('Understates the window (D1).')).not.toBeInTheDocument();
  });

  it('renders a pre-Q-19 question unchanged — no rationale rows at all', () => {
    renderResults(OPTIONS);

    expect(screen.getByText('Policy states 72 hours.')).toBeInTheDocument();
    for (const option of OPTIONS) {
      const card = optionCard(option.text);
      expect(card).toHaveTextContent(option.text);
      expect(card.querySelector('p')).toBeNull();
    }
  });
});
