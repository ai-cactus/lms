/**
 * Tests for the "Review Quiz Questions" wizard step, covering the design
 * alignment's module-grouped accordions: one section per generating module, the
 * legacy single-section fallback for untagged courses, and the per-section
 * add-question flow that has to tag what it creates so persistence keeps the
 * grouping.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import Step8QuizReview from './Step8QuizReview';
import { CourseWizardData } from '@/types/course';
import { QuizQuestion } from '@/types/quiz';
import { WIZARD_FORM_DATA } from './wizardTestData';

const generateSingleQuestion = vi.hoisted(() => vi.fn());
vi.mock('@/app/actions/quiz-ai', () => ({ generateSingleQuestion }));

const question = (overrides: Partial<QuizQuestion> & { question: string }): QuizQuestion => ({
  options: ['Option 1', 'Option 2', 'Option 3', 'Option 4'],
  answer: 0,
  type: 'multiple_choice',
  ...overrides,
});

const TAGGED_QUIZ: QuizQuestion[] = [
  question({ question: 'Privacy Q1', moduleIndex: 0, moduleTitle: 'Privacy Rule' }),
  question({ question: 'Privacy Q2', moduleIndex: 0, moduleTitle: 'Privacy Rule' }),
  question({ question: 'Security Q1', moduleIndex: 1, moduleTitle: 'Security Rule' }),
];

function renderStep(quiz: QuizQuestion[], overrides: Partial<CourseWizardData> = {}) {
  const onQuizUpdate = vi.fn();
  render(
    <Step8QuizReview
      data={{ ...WIZARD_FORM_DATA, ...overrides }}
      quiz={quiz}
      rawContext="Merged article markdown"
      onQuizUpdate={onQuizUpdate}
    />,
  );
  return { onQuizUpdate };
}

function sectionTrigger(title: string) {
  const trigger = screen
    .getAllByRole('button')
    .find(
      (button) =>
        button.dataset.slot === 'accordion-trigger' && button.textContent?.startsWith(title),
    );
  if (!trigger) throw new Error(`No section header found for "${title}"`);
  return trigger;
}

/** The section accordion whose header carries `title`. */
function section(title: string) {
  return sectionTrigger(title).closest('[data-slot="accordion-item"]') as HTMLElement;
}

function sectionCount() {
  return document.querySelectorAll('[data-slot="accordion-item"]').length;
}

async function fillNewQuestion(user: ReturnType<typeof userEvent.setup>, scope: HTMLElement) {
  await user.type(within(scope).getByLabelText('Question Text'), 'Manually added question');
  const optionInputs = within(scope).getAllByPlaceholderText(/^Option \d$/);
  for (const [index, input] of optionInputs.entries()) {
    await user.type(input, `Answer ${index + 1}`);
  }
}

describe('Step8QuizReview', () => {
  beforeEach(() => {
    generateSingleQuestion.mockReset();
  });

  it('renders one section per generating module, with its question count', () => {
    renderStep(TAGGED_QUIZ);

    expect(sectionCount()).toBe(2);
    expect(sectionTrigger('Privacy Rule')).toHaveTextContent('2 questions');
    expect(sectionTrigger('Security Rule')).toHaveTextContent('1 question');
  });

  it('lists each module’s questions under its own section, numbered from 1', () => {
    renderStep(TAGGED_QUIZ);

    const privacy = section('Privacy Rule');
    expect(within(privacy).getByText('Privacy Q1')).toBeInTheDocument();
    expect(within(privacy).getByText('Privacy Q2')).toBeInTheDocument();
    expect(within(privacy).queryByText('Security Q1')).not.toBeInTheDocument();

    const security = section('Security Rule');
    expect(within(security).getByText('Security Q1')).toBeInTheDocument();
    expect(within(security).getByText('1.')).toBeInTheDocument();
  });

  it('keeps an untagged legacy quiz in a single section named after the course', () => {
    renderStep([question({ question: 'Legacy Q1' }), question({ question: 'Legacy Q2' })]);

    expect(sectionCount()).toBe(1);
    expect(sectionTrigger(WIZARD_FORM_DATA.title)).toHaveTextContent('2 questions');
  });

  it('tags a question added from a section with that module and keeps it grouped', async () => {
    const user = userEvent.setup();
    const { onQuizUpdate } = renderStep(TAGGED_QUIZ);

    await user.click(screen.getByRole('button', { name: 'Add question to Privacy Rule' }));
    await fillNewQuestion(user, section('Privacy Rule'));
    await user.click(screen.getByRole('button', { name: 'Save Question' }));

    expect(onQuizUpdate).toHaveBeenCalledTimes(1);
    const updated = onQuizUpdate.mock.calls[0][0] as QuizQuestion[];
    expect(updated).toHaveLength(4);
    expect(updated[2]).toMatchObject({
      question: 'Manually added question',
      moduleIndex: 0,
      moduleTitle: 'Privacy Rule',
    });
    expect(updated[3].question).toBe('Security Q1');
  });

  it('leaves a question added to an untagged section untagged', async () => {
    const user = userEvent.setup();
    const { onQuizUpdate } = renderStep([question({ question: 'Legacy Q1' })]);

    await user.click(
      screen.getByRole('button', { name: `Add question to ${WIZARD_FORM_DATA.title}` }),
    );
    await fillNewQuestion(user, section(WIZARD_FORM_DATA.title));
    await user.click(screen.getByRole('button', { name: 'Save Question' }));

    const updated = onQuizUpdate.mock.calls[0][0] as QuizQuestion[];
    expect(updated[1].moduleIndex).toBeUndefined();
    expect(updated[1].moduleTitle).toBeUndefined();
  });

  it('names the section’s module when generating a question with AI', async () => {
    const user = userEvent.setup();
    generateSingleQuestion.mockResolvedValue({ success: false, error: 'nope' });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    renderStep(TAGGED_QUIZ, {
      modules: [
        {
          title: 'Privacy Rule',
          objective: 'Explain PHI handling',
          completionDeadlineDays: null,
          documentId: null,
        },
        {
          title: 'Security Rule',
          objective: '',
          completionDeadlineDays: null,
          documentId: null,
        },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Add question to Privacy Rule' }));
    await user.click(screen.getByRole('button', { name: /Generate with AI/i }));

    expect(generateSingleQuestion).toHaveBeenCalledWith({
      courseId: undefined,
      context: 'Module: Privacy Rule\n\nObjective: Explain PHI handling\n\nMerged article markdown',
    });
  });

  it('still edits a question in place', async () => {
    const user = userEvent.setup();
    const { onQuizUpdate } = renderStep(TAGGED_QUIZ);

    const security = section('Security Rule');
    await user.click(within(security).getByRole('button', { name: 'Edit' }));
    await user.type(within(security).getByLabelText('Question Text'), ' (revised)');
    await user.click(within(security).getByRole('button', { name: 'Save Changes' }));

    const updated = onQuizUpdate.mock.calls[0][0] as QuizQuestion[];
    expect(updated[2].question).toBe('Security Q1 (revised)');
    expect(updated[2].moduleTitle).toBe('Security Rule');
  });

  it('warns when fewer questions were generated than requested', () => {
    renderStep(TAGGED_QUIZ, { quizQuestionCount: '10' });

    expect(screen.getByText('Fewer questions than requested')).toBeInTheDocument();
  });

  it('warns when no questions were generated at all', () => {
    renderStep([]);

    expect(screen.getByText('No quiz questions were generated')).toBeInTheDocument();
  });
});
