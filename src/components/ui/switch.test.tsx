import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { Switch } from './switch';

/**
 * `Switch` has two independent accessible-naming paths in this codebase:
 * an `aria-label` prop (used by Step7Assign's and AssignPublishClient's
 * "Recurring Course Requirement"/"Set Completion Deadline" toggles via
 * RenewalScheduleInput), and a wrapping <label> (used by AssignPublishClient's
 * "Send deadline reminders" toggle, which passes no aria-label at all).
 * Step7Assign.test.tsx:194 locates its toggle by
 * `getByRole('switch', { name: 'Set Completion Deadline' })`, so a naming
 * regression on either path is load-bearing for that test — cover both here
 * rather than only the one currently exercised by a host test.
 */
describe('Switch', () => {
  test('renders with role="switch"', () => {
    render(<Switch aria-label="Enable feature" />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  test('aria-checked reflects the checked prop and flips on activation', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <Switch aria-label="Enable feature" checked={false} onCheckedChange={onCheckedChange} />,
    );

    const toggle = screen.getByRole('switch', { name: 'Enable feature' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await user.click(toggle);
    expect(onCheckedChange).toHaveBeenCalledWith(true);

    rerender(
      <Switch aria-label="Enable feature" checked={true} onCheckedChange={onCheckedChange} />,
    );
    expect(screen.getByRole('switch', { name: 'Enable feature' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('names itself via an aria-label prop', () => {
    render(<Switch aria-label="Recurring Course Requirement" checked={false} />);
    expect(
      screen.getByRole('switch', { name: 'Recurring Course Requirement' }),
    ).toBeInTheDocument();
  });

  test('names itself via a wrapping <label> when no aria-label is given', () => {
    render(
      <label>
        <Switch checked={false} />
        Send deadline reminders
      </label>,
    );
    expect(screen.getByRole('switch', { name: 'Send deadline reminders' })).toBeInTheDocument();
  });

  test('disabled blocks onCheckedChange', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Switch
        aria-label="Enable feature"
        checked={false}
        disabled
        onCheckedChange={onCheckedChange}
      />,
    );

    const toggle = screen.getByRole('switch', { name: 'Enable feature' });
    expect(toggle).toBeDisabled();

    await user.click(toggle);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
