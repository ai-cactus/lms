/**
 * `ReminderLadderInput` had no test of its own before this — the wizard's suite
 * (Step7Assign.test.tsx) only reaches it indirectly through `Step7Assign`, and
 * `AssignPublishClient` is the control's second host. Covers the control's own
 * behavior in isolation: row add/remove, the stepper, the
 * `MAX_WIZARD_REMINDER_ROWS` cap, the `disabled` prop (neither host's suite
 * exercises this directly), and the exact aria-label strings
 * `Step7Assign.test.tsx` depends on (`Reminder ${i+1} days before deadline`,
 * `Increase/Decrease reminder ${i+1}`) — a rename here would silently break
 * that file's `getByLabelText`/`getByRole(name:)` queries without this file
 * failing first to point at the actual component.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

// jsdom stubs Radix Select depends on (the "days" unit dropdown) — same stubs
// as Step7Assign.test.tsx, which renders this same Select.
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

import ReminderLadderInput, { type ReminderLadderRow } from './ReminderLadderInput';
import { MAX_WIZARD_REMINDER_ROWS } from '@/lib/enrollment/reminder-ladder';

function renderInput(value: ReminderLadderRow[], disabled = false) {
  const onChange = vi.fn();
  render(<ReminderLadderInput value={value} onChange={onChange} disabled={disabled} />);
  return { onChange };
}

describe('ReminderLadderInput — rows and aria-labels', () => {
  it('renders one row per value, with the exact aria-labels Step7Assign.test.tsx depends on', () => {
    renderInput([
      { value: 14, unit: 'days' },
      { value: 3, unit: 'days' },
    ]);

    expect(screen.getByLabelText('Reminder 1 days before deadline')).toHaveValue(14);
    expect(screen.getByLabelText('Reminder 2 days before deadline')).toHaveValue(3);
    expect(screen.getByRole('button', { name: 'Increase reminder 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decrease reminder 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase reminder 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decrease reminder 2' })).toBeInTheDocument();
  });

  it('renders no rows and only the add control when value is empty', () => {
    renderInput([]);

    expect(screen.queryByLabelText(/Reminder \d+ days before deadline/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add reminder/ })).toBeInTheDocument();
  });
});

describe('ReminderLadderInput — add', () => {
  it('adds a new row with the [1, "days"] default', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInput([{ value: 7, unit: 'days' }]);

    await user.click(screen.getByRole('button', { name: /Add reminder/ }));

    expect(onChange).toHaveBeenCalledWith([
      { value: 7, unit: 'days' },
      { value: 1, unit: 'days' },
    ]);
  });

  it('disables the add control once the ladder reaches MAX_WIZARD_REMINDER_ROWS', () => {
    const rows = Array.from({ length: MAX_WIZARD_REMINDER_ROWS }, (_, i) => ({
      value: i + 1,
      unit: 'days' as const,
    }));

    renderInput(rows);

    expect(screen.getByRole('button', { name: /Add reminder/ })).toBeDisabled();
  });

  it('a click on the (disabled) add control past the cap never calls onChange', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: MAX_WIZARD_REMINDER_ROWS }, (_, i) => ({
      value: i + 1,
      unit: 'days' as const,
    }));
    const { onChange } = renderInput(rows);

    await user.click(screen.getByRole('button', { name: /Add reminder/ }));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ReminderLadderInput — remove', () => {
  it('removes exactly the targeted row, leaving the others untouched', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInput([
      { value: 14, unit: 'days' },
      { value: 3, unit: 'days' },
      { value: 0, unit: 'days' },
    ]);

    await user.click(screen.getByRole('button', { name: 'Remove reminder 2' }));

    expect(onChange).toHaveBeenCalledWith([
      { value: 14, unit: 'days' },
      { value: 0, unit: 'days' },
    ]);
  });
});

describe('ReminderLadderInput — stepper', () => {
  it('increases a row via its stepper button', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInput([{ value: 7, unit: 'days' }]);

    await user.click(screen.getByRole('button', { name: 'Increase reminder 1' }));

    expect(onChange).toHaveBeenCalledWith([{ value: 8, unit: 'days' }]);
  });

  it('decreases a row via its stepper button', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInput([{ value: 7, unit: 'days' }]);

    await user.click(screen.getByRole('button', { name: 'Decrease reminder 1' }));

    expect(onChange).toHaveBeenCalledWith([{ value: 6, unit: 'days' }]);
  });

  it('never steps a row below zero', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInput([{ value: 0, unit: 'days' }]);

    await user.click(screen.getByRole('button', { name: 'Decrease reminder 1' }));

    expect(onChange).toHaveBeenCalledWith([{ value: 0, unit: 'days' }]);
  });

  it('updates a row via direct entry in its number field', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInput([{ value: 7, unit: 'days' }]);

    await user.type(screen.getByLabelText('Reminder 1 days before deadline'), '0');

    // Controlled input starting at "7": typing "0" produces "70" (append),
    // same behavior Step7Assign.test.tsx pins for the pre-extraction control.
    expect(onChange).toHaveBeenCalledWith([{ value: 70, unit: 'days' }]);
  });
});

describe('ReminderLadderInput — disabled', () => {
  it('disables every row control and the add button when disabled', () => {
    renderInput([{ value: 7, unit: 'days' }], true);

    expect(screen.getByLabelText('Reminder 1 days before deadline')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase reminder 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decrease reminder 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove reminder 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Add reminder/ })).toBeDisabled();
  });

  it('a click on a disabled stepper never calls onChange', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInput([{ value: 7, unit: 'days' }], true);

    await user.click(screen.getByRole('button', { name: 'Increase reminder 1' }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
