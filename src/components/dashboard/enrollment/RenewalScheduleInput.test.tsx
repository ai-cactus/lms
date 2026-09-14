/**
 * `RenewalScheduleInput` is the new shared control introduced to end the
 * divergence between the wizard's 4-option interval list (no "none" row) and
 * the assign page's old 5-option list (which included `{ value: 'none',
 * label: 'No renewal' }`). The toggle is now the ONLY way to express "this
 * course does not recur" — the interval `Select` never offers `'none'` again.
 * Covers: the canonical option set and exact labels, `'none'`'s absence, the
 * interval being hidden while the toggle is off, and the host value/onChange
 * contract (including the `disabled` prop, which only AssignPublishClient's
 * host passes today).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

// jsdom stubs Radix Select depends on — same stubs as Step7Assign.test.tsx
// and ReminderLadderInput.test.tsx, which render the same primitive.
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

import RenewalScheduleInput, { RENEWAL_CYCLE_OPTIONS } from './RenewalScheduleInput';
import type { RenewalCycle } from '@/generated/prisma/enums';

function renderInput(overrides: Partial<React.ComponentProps<typeof RenewalScheduleInput>> = {}) {
  const onEnabledChange = vi.fn();
  const onCycleChange = vi.fn();
  render(
    <RenewalScheduleInput
      header={<h3>Renewal Settings</h3>}
      toggleLabel="Renewal Settings"
      enabled={false}
      onEnabledChange={onEnabledChange}
      cycle={'annual' as RenewalCycle}
      onCycleChange={onCycleChange}
      {...overrides}
    />,
  );
  return { onEnabledChange, onCycleChange };
}

async function openInterval(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('combobox', { name: 'Select interval' }));
  return screen.getByRole('listbox');
}

describe('RenewalScheduleInput — canonical option set', () => {
  it('exposes exactly the 4 canonical entries with their exact labels', () => {
    expect(RENEWAL_CYCLE_OPTIONS).toEqual([
      { value: 'monthly', label: 'Monthly (1 month)' },
      { value: 'quarterly', label: 'Quarterly (3 months)' },
      { value: 'semiannual', label: 'Semi-annual (6 months)' },
      { value: 'annual', label: 'Annual (12 months)' },
    ]);
  });

  it('never offers "none" as a selectable interval', async () => {
    const user = userEvent.setup();
    renderInput({ enabled: true });

    const listbox = await openInterval(user);

    expect(within(listbox).queryByText(/no renewal/i)).not.toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /none/i })).not.toBeInTheDocument();
    expect(within(listbox).getAllByRole('option')).toHaveLength(4);
  });
});

describe('RenewalScheduleInput — toggle gates the interval', () => {
  it('does not render the interval Select while the toggle is off', () => {
    renderInput({ enabled: false });

    expect(screen.queryByRole('combobox', { name: 'Select interval' })).not.toBeInTheDocument();
  });

  it('renders the interval Select, showing the current cycle, once the toggle is on', () => {
    renderInput({ enabled: true, cycle: 'monthly' as RenewalCycle });

    expect(screen.getByRole('combobox', { name: 'Select interval' })).toHaveTextContent(
      'Monthly (1 month)',
    );
  });

  it('shows the placeholder rather than a stale label when cycle is "none" but the toggle is on', () => {
    renderInput({ enabled: true, cycle: 'none' as RenewalCycle });

    expect(screen.getByRole('combobox', { name: 'Select interval' })).toHaveTextContent(
      'Select interval',
    );
  });
});

describe('RenewalScheduleInput — value/onChange contract', () => {
  it('fires onEnabledChange when the toggle is activated', async () => {
    const user = userEvent.setup();
    const { onEnabledChange } = renderInput({ enabled: false });

    await user.click(screen.getByRole('switch', { name: 'Renewal Settings' }));

    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it('fires onCycleChange with the picked interval', async () => {
    const user = userEvent.setup();
    const { onCycleChange } = renderInput({ enabled: true, cycle: 'annual' as RenewalCycle });

    const listbox = await openInterval(user);
    await user.click(within(listbox).getByRole('option', { name: 'Quarterly (3 months)' }));

    expect(onCycleChange).toHaveBeenCalledWith('quarterly');
  });

  it('disables both the toggle and the interval Select when disabled is set', () => {
    renderInput({ enabled: true, disabled: true });

    expect(screen.getByRole('switch', { name: 'Renewal Settings' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Select interval' })).toBeDisabled();
  });
});
