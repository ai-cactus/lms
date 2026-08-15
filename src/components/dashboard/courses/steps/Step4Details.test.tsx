/**
 * Tests for the "Course Details" wizard step, covering the fields the design
 * alignment added: the read-only category echo (resolved from the id the wizard
 * carries), the single-option content type, and the completion-deadline stepper.
 * The AI "Estimated Duration" row was deliberately dropped from this screen.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetCategories } = vi.hoisted(() => ({ mockGetCategories: vi.fn() }));

vi.mock('@/app/actions/categories', () => ({ getCategories: mockGetCategories }));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import Step4Details from './Step4Details';
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
  render(<Step4Details data={{ ...WIZARD_FORM_DATA, ...overrides }} onChange={onChange} />);
  return { onChange };
}

beforeEach(() => {
  mockGetCategories.mockReset();
  mockGetCategories.mockResolvedValue([
    { id: 'cat-1', name: 'Cybersecurity and Technology', description: null, isSystem: true },
    { id: 'cat-2', name: 'Clinical Care', description: null, isSystem: true },
  ]);
});

describe('Step4Details', () => {
  it('echoes the step-1 category as a read-only value', async () => {
    renderStep();

    expect(await screen.findByText('Cybersecurity and Technology')).toBeInTheDocument();
  });

  it('renders "Notes & Slides" as the selected content type', async () => {
    renderStep();

    await waitFor(() => expect(mockGetCategories).toHaveBeenCalled());
    expect(screen.getByText('Notes & Slides')).toBeInTheDocument();
  });

  it('no longer renders the AI estimated duration row', async () => {
    renderStep();

    await waitFor(() => expect(mockGetCategories).toHaveBeenCalled());
    expect(screen.queryByText('Estimated Duration')).not.toBeInTheDocument();
  });

  it('shows the completion deadline in days', async () => {
    renderStep();

    expect(await screen.findByLabelText('Deadline to Complete Course')).toHaveValue(30);
    expect(screen.getByText('days')).toBeInTheDocument();
  });

  it('increments the deadline from the stepper', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep();

    await user.click(await screen.findByRole('button', { name: 'Increase deadline' }));

    expect(onChange).toHaveBeenCalledWith('completionDeadlineDays', 31);
  });

  it('never steps the deadline below a single day', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ completionDeadlineDays: 1 });

    await user.click(await screen.findByRole('button', { name: 'Decrease deadline' }));

    expect(onChange).toHaveBeenCalledWith('completionDeadlineDays', 1);
  });

  it('starts an empty deadline at one day', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ completionDeadlineDays: null });

    await user.click(await screen.findByRole('button', { name: 'Increase deadline' }));

    expect(onChange).toHaveBeenCalledWith('completionDeadlineDays', 1);
  });

  it('clears the deadline when the field is emptied', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep();

    await user.clear(await screen.findByLabelText('Deadline to Complete Course'));

    expect(onChange).toHaveBeenCalledWith('completionDeadlineDays', null);
  });
});
