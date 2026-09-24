/**
 * Tests for the "Review Quiz Questions" wizard step. The design draws the
 * whole quiz as one collapsible, continuously-numbered list rather than one
 * accordion per generating module — `groupQuestionsByModule` still tags each
 * question with the module it came from (so persistence and the single
 * "Add new question" footer keep grouping legacy multi-module courses
 * correctly), but that grouping is no longer reflected in the section title or
 * per-section numbering, only in which module a newly added question inherits.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import Step6QuizReview from './Step6QuizReview';
import { CourseWizardData } from '@/types/course';
import { QuizQuestion } from '@/types/quiz';
import { WIZARD_FORM_DATA } from './wizardTestData';

const { generateSingleQuestion, regenerateQuiz } = vi.hoisted(() => ({
  generateSingleQuestion: vi.fn(),
  regenerateQuiz: vi.fn(),
}));
vi.mock('@/app/actions/quiz-ai', () => ({ generateSingleQuestion, regenerateQuiz }));

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
    <Step6QuizReview
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

function sectionCount() {
  return document.querySelectorAll('[data-slot="accordion-item"]').length;
}

// There is exactly one add-question form on screen at a time (the design
// dropped the per-section forms), so it needs no scoping.
async function fillNewQuestion(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Question Text'), 'Manually added question');
  const optionInputs = screen.getAllByPlaceholderText(/^Option \d$/);
  for (const [index, input] of optionInputs.entries()) {
    await user.type(input, `Answer ${index + 1}`);
  }
}

/** The rendered question card (text + Edit button) for a given question's text. */
function questionCard(questionText: string) {
  return screen.getByText(questionText).closest('.bg-background-secondary') as HTMLElement;
}

describe('Step6QuizReview', () => {
  beforeEach(() => {
    generateSingleQuestion.mockReset();
  });

  it('renders a single collapsible section for the whole quiz, titled by the quiz title, with the total count shown alongside it', () => {
    renderStep(TAGGED_QUIZ);

    // The design flattened the per-module accordions into one section — the
    // module grouping still exists in `sections`, it just isn't drawn.
    expect(sectionCount()).toBe(1);
    expect(sectionTrigger(WIZARD_FORM_DATA.quizTitle)).toBeInTheDocument();
    expect(screen.getByText('3 questions')).toBeInTheDocument();
  });

  it('numbers every question continuously across modules, instead of restarting per module', () => {
    renderStep(TAGGED_QUIZ);

    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('Privacy Q1')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    expect(screen.getByText('Privacy Q2')).toBeInTheDocument();
    // Security Q1 is the 3rd question overall — under the old per-module
    // accordions this would have restarted at "1."; it must not any more.
    expect(screen.getByText('3.')).toBeInTheDocument();
    expect(screen.getByText('Security Q1')).toBeInTheDocument();
  });

  it('renders a single section for an untagged legacy quiz, falling back to the course title when no quiz title is set', () => {
    renderStep([question({ question: 'Legacy Q1' }), question({ question: 'Legacy Q2' })], {
      quizTitle: '',
    });

    expect(sectionCount()).toBe(1);
    expect(sectionTrigger(WIZARD_FORM_DATA.title)).toBeInTheDocument();
    expect(screen.getByText('Legacy Q1')).toBeInTheDocument();
    expect(screen.getByText('Legacy Q2')).toBeInTheDocument();
  });

  it('the single Add-new-question control appends to the end of the quiz, tagged with the last module', async () => {
    // Legacy multi-module courses depend on this: the footer button always
    // targets `sections[sections.length - 1]`, so a manually added question
    // must still land in — and inherit the tag of — the last module.
    const user = userEvent.setup();
    const { onQuizUpdate } = renderStep(TAGGED_QUIZ);

    await user.click(screen.getByRole('button', { name: 'Add new question' }));
    await fillNewQuestion(user);
    await user.click(screen.getByRole('button', { name: 'Save Question' }));

    expect(onQuizUpdate).toHaveBeenCalledTimes(1);
    const updated = onQuizUpdate.mock.calls[0][0] as QuizQuestion[];
    expect(updated).toHaveLength(4);
    expect(updated[3]).toMatchObject({
      question: 'Manually added question',
      moduleIndex: 1,
      moduleTitle: 'Security Rule',
    });
  });

  it('leaves a question added to an untagged quiz untagged', async () => {
    const user = userEvent.setup();
    const { onQuizUpdate } = renderStep([question({ question: 'Legacy Q1' })]);

    await user.click(screen.getByRole('button', { name: 'Add new question' }));
    await fillNewQuestion(user);
    await user.click(screen.getByRole('button', { name: 'Save Question' }));

    const updated = onQuizUpdate.mock.calls[0][0] as QuizQuestion[];
    expect(updated[1].moduleIndex).toBeUndefined();
    expect(updated[1].moduleTitle).toBeUndefined();
  });

  it('describes the course itself when generating a question with AI', async () => {
    const user = userEvent.setup();
    generateSingleQuestion.mockResolvedValue({ success: false, error: 'nope' });
    renderStep(TAGGED_QUIZ, { modules: [{ documentId: 'doc-1' }] });

    await user.click(screen.getByRole('button', { name: 'Add new question' }));
    await user.click(screen.getByRole('button', { name: /Generate with AI/i }));

    expect(generateSingleQuestion).toHaveBeenCalledWith({
      courseId: undefined,
      context: [
        `Course: ${WIZARD_FORM_DATA.title}`,
        `Objectives: ${WIZARD_FORM_DATA.objectives.join('; ')}`,
        'Merged article markdown',
      ].join('\n\n'),
    });
  });

  it('carries the AI-generated explanation onto the added question', async () => {
    // Regression: `handleGenerateQuestion` used to copy only question/options/
    // answer/type out of the action result, so a question added with AI landed
    // with no explanation at all while every originally generated question had
    // one. Q-13 then made the action return a rationale for the WRONG options
    // too, so the whole explanation object must survive the hand-off intact.
    const user = userEvent.setup();
    generateSingleQuestion.mockResolvedValue({
      success: true,
      question: {
        question: 'What is the escalation window?',
        options: ['24h', '48h', '72h', '96h'],
        answer: 2,
        type: 'multiple_choice',
        explanation: {
          correctExplanation: 'Policy states 72 hours.',
          incorrectOptions: {
            '0': 'Too short — the policy allows three days (D3).',
            '1': 'Halves the stated window (D1).',
            '3': 'Overshoots the stated window (D4).',
          },
        },
      },
    });
    const { onQuizUpdate } = renderStep(TAGGED_QUIZ);

    await user.click(screen.getByRole('button', { name: 'Add new question' }));
    await user.click(screen.getByRole('button', { name: /Generate with AI/i }));
    await screen.findByDisplayValue('What is the escalation window?');
    await user.click(screen.getByRole('button', { name: 'Save Question' }));

    const updated = onQuizUpdate.mock.calls[0][0] as QuizQuestion[];
    expect(updated[3]).toMatchObject({
      question: 'What is the escalation window?',
      explanation: {
        correctExplanation: 'Policy states 72 hours.',
        incorrectOptions: {
          '0': 'Too short — the policy allows three days (D3).',
          '1': 'Halves the stated window (D1).',
          '3': 'Overshoots the stated window (D4).',
        },
      },
    });
  });

  it('renders the explanation on an AI-added question the same way as a generated one', () => {
    renderStep([
      question({
        question: 'Privacy Q1',
        explanation: { correctExplanation: 'Policy states 72 hours.', incorrectOptions: {} },
      }),
    ]);

    expect(
      within(questionCard('Privacy Q1')).getByText(/Correct: Policy states 72 hours\./),
    ).toBeInTheDocument();
  });

  // Q-13: the author reviewing in the wizard is the reader this rationale is
  // for, so the card must list one line per wrong option, labelled A–D by the
  // option's own position.
  it('renders a rationale for each wrong option', () => {
    renderStep([
      question({
        question: 'Privacy Q1',
        options: ['24h', '48h', '72h', '96h'],
        answer: 2,
        explanation: {
          correctExplanation: 'Policy states 72 hours.',
          incorrectOptions: {
            '0': 'Too short — the policy allows three days (D3).',
            '3': 'Overshoots the stated window (D4).',
          },
        },
      }),
    ]);

    const card = questionCard('Privacy Q1');
    expect(
      within(card).getByText(/Option A: Too short — the policy allows three days \(D3\)\./),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(/Option D: Overshoots the stated window \(D4\)\./),
    ).toBeInTheDocument();
  });

  // A model that answers with the correct-answer rationale but no distractor
  // ones must still produce a usable, renderable question.
  it('renders a question whose wrong options carry no rationale', () => {
    renderStep([
      question({
        question: 'Privacy Q1',
        explanation: { correctExplanation: 'Policy states 72 hours.', incorrectOptions: {} },
      }),
    ]);

    const card = questionCard('Privacy Q1');
    expect(within(card).getByText(/Correct: Policy states 72 hours\./)).toBeInTheDocument();
    // No distractor rows — the option list itself still renders "Option 1"…
    // so match the rationale row's own "Option <letter>:" prefix.
    expect(within(card).queryByText(/Option [A-D]:/)).not.toBeInTheDocument();
  });

  it('still edits a question in place', async () => {
    const user = userEvent.setup();
    const { onQuizUpdate } = renderStep(TAGGED_QUIZ);

    const securityCard = questionCard('Security Q1');
    await user.click(within(securityCard).getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByLabelText('Question Text'), ' (revised)');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    const updated = onQuizUpdate.mock.calls[0][0] as QuizQuestion[];
    expect(updated[2].question).toBe('Security Q1 (revised)');
    expect(updated[2].moduleTitle).toBe('Security Rule');
  });

  it('drops a distractor rationale when the author rewrites that option (Q-19)', async () => {
    const user = userEvent.setup();
    const explained = question({
      question: 'Explained Q',
      explanation: {
        correctExplanation: 'Option 1 is correct.',
        incorrectOptions: { '1': 'Option 2 halves it (D1).', '3': 'Option 4 overshoots (D4).' },
      },
    });
    const { onQuizUpdate } = renderStep([explained]);

    await user.click(within(questionCard('Explained Q')).getByRole('button', { name: 'Edit' }));
    const optionInput = screen.getByDisplayValue('Option 2');
    await user.clear(optionInput);
    await user.type(optionInput, 'Something else entirely');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    const updated = onQuizUpdate.mock.calls[0][0] as QuizQuestion[];
    expect(updated[0].options[1]).toBe('Something else entirely');
    // The rationale for the option that was rewritten goes with it; the one for
    // the untouched option stays keyed where it was.
    expect(updated[0].explanation?.incorrectOptions).toEqual({
      '3': 'Option 4 overshoots (D4).',
    });
  });

  it('warns when fewer questions were generated than requested', () => {
    renderStep(TAGGED_QUIZ, { quizQuestionCount: '10' });

    expect(screen.getByText('Fewer questions than requested')).toBeInTheDocument();
  });

  it('warns when no questions were generated at all', () => {
    renderStep([]);

    expect(screen.getByText('No quiz questions were generated')).toBeInTheDocument();
  });

  describe('Regenerate Quiz', () => {
    beforeEach(() => {
      regenerateQuiz.mockReset();
    });

    it('renders a Regenerate Quiz control', () => {
      renderStep(TAGGED_QUIZ);

      expect(screen.getByRole('button', { name: /Regenerate Quiz/i })).toBeInTheDocument();
    });

    it('opens a confirmation warning that manual edits will be lost', async () => {
      const user = userEvent.setup();
      renderStep(TAGGED_QUIZ);

      await user.click(screen.getByRole('button', { name: /Regenerate Quiz/i }));

      const dialog = screen.getByRole('alertdialog');
      expect(within(dialog).getByText(/Regenerate the whole quiz\?/i)).toBeInTheDocument();
      expect(within(dialog).getByText(/will be lost/i)).toBeInTheDocument();
      expect(regenerateQuiz).not.toHaveBeenCalled();
    });

    it('confirming replaces the whole quiz array with the regenerated set', async () => {
      const user = userEvent.setup();
      regenerateQuiz.mockResolvedValue({
        success: true,
        questions: [
          {
            question: 'Fresh Q1',
            options: ['A', 'B', 'C', 'D'],
            answer: 1,
            type: 'multiple_choice',
            explanation: {
              correctExplanation: 'B is correct because the policy says so.',
              incorrectOptions: { '0': 'A swaps must for should (D1).' },
            },
          },
          {
            question: 'Fresh Q2',
            options: ['A', 'B', 'C', 'D'],
            answer: 3,
            type: 'multiple_choice',
            explanation: {
              correctExplanation: 'D is correct because the manual says so.',
              incorrectOptions: { '2': 'C reverses the outcome (D3).' },
            },
          },
        ],
      });
      const { onQuizUpdate } = renderStep(TAGGED_QUIZ);

      await user.click(screen.getByRole('button', { name: /Regenerate Quiz/i }));
      const dialog = screen.getByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Regenerate Quiz' }));

      expect(regenerateQuiz).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(onQuizUpdate).toHaveBeenCalledTimes(1));
      const updated = onQuizUpdate.mock.calls[0][0] as QuizQuestion[];
      expect(updated).toHaveLength(2);
      expect(updated.map((q) => q.question)).toEqual(['Fresh Q1', 'Fresh Q2']);
      // Same regression as the single-question path: the regenerated set used
      // to be re-mapped without its explanations.
      expect(updated.map((q) => q.explanation?.correctExplanation)).toEqual([
        'B is correct because the policy says so.',
        'D is correct because the manual says so.',
      ]);
      expect(updated.map((q) => q.explanation?.incorrectOptions)).toEqual([
        { '0': 'A swaps must for should (D1).' },
        { '2': 'C reverses the outcome (D3).' },
      ]);
    });

    it('cancelling leaves the quiz untouched', async () => {
      const user = userEvent.setup();
      const { onQuizUpdate } = renderStep(TAGGED_QUIZ);

      await user.click(screen.getByRole('button', { name: /Regenerate Quiz/i }));
      const dialog = screen.getByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      expect(regenerateQuiz).not.toHaveBeenCalled();
      expect(onQuizUpdate).not.toHaveBeenCalled();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('a failed regeneration surfaces the sanitised error without clearing existing questions', async () => {
      const user = userEvent.setup();
      regenerateQuiz.mockResolvedValue({
        success: false,
        error: 'AI generated an invalid quiz format.',
      });
      const { onQuizUpdate } = renderStep(TAGGED_QUIZ);

      await user.click(screen.getByRole('button', { name: /Regenerate Quiz/i }));
      const dialog = screen.getByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Regenerate Quiz' }));

      // The refusal lands in the shared Alert banner, not a native alert().
      expect(await screen.findByText('AI generated an invalid quiz format.')).toBeInTheDocument();
      expect(onQuizUpdate).not.toHaveBeenCalled();
      // The original questions are still rendered — nothing was cleared.
      expect(screen.getByText('Privacy Q1')).toBeInTheDocument();
      expect(screen.getByText('Security Q1')).toBeInTheDocument();
    });
  });
});
