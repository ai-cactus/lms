/**
 * Tests for the "Course Quiz" wizard step, covering the design alignment's
 * additions: the question-type picker (stored with the generator's own
 * `multiple_choice` / `true_false` vocabulary) and the "Moderate" display label
 * that must keep writing the stored `medium` difficulty.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import Step5Quiz from './Step5Quiz';
import { CourseWizardData } from '@/types/course';
import { WIZARD_FORM_DATA } from './wizardTestData';

// jsdom stubs Radix Select depends on.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

function renderStep(overrides: Partial<CourseWizardData> = {}) {
  const onChange = vi.fn();
  render(<Step5Quiz data={{ ...WIZARD_FORM_DATA, ...overrides }} onChange={onChange} />);
  return { onChange };
}

describe('Step5Quiz', () => {
  it('shows the stored question type as its display label', () => {
    renderStep();

    expect(screen.getByRole('combobox', { name: 'Question Type' })).toHaveTextContent(
      'Multiple Choice',
    );
  });

  it('stores the generator vocabulary when True / False is picked', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep();

    await user.click(screen.getByRole('combobox', { name: 'Question Type' }));
    await user.click(await screen.findByRole('option', { name: 'True / False' }));

    expect(onChange).toHaveBeenCalledWith('quizQuestionType', 'true_false');
  });

  it('labels the stored "medium" difficulty as Moderate', () => {
    renderStep();

    expect(screen.getByRole('combobox', { name: 'Difficulty' })).toHaveTextContent('Moderate');
  });

  it('keeps writing "medium" when Moderate is picked', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ quizDifficulty: 'easy' });

    await user.click(screen.getByRole('combobox', { name: 'Difficulty' }));
    await user.click(await screen.findByRole('option', { name: 'Moderate' }));

    expect(onChange).toHaveBeenCalledWith('quizDifficulty', 'medium');
  });

  it('keeps the quality notice on the question count', () => {
    renderStep();

    expect(screen.getByText('Quality Notice')).toBeInTheDocument();
  });

  it('keeps the read-only estimated duration derived from the question count', () => {
    renderStep({ quizQuestionCount: '10' });

    expect(screen.getByText(/~15 mins/)).toBeInTheDocument();
  });
});
