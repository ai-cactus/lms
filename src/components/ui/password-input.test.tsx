import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { PasswordInput } from './password-input';

describe('PasswordInput', () => {
  test('starts masked (type=password)', () => {
    render(<PasswordInput name="password" placeholder="pw" />);
    expect(screen.getByPlaceholderText('pw')).toHaveAttribute('type', 'password');
  });

  test('toggle reveals and re-hides the value', async () => {
    const user = userEvent.setup();
    render(<PasswordInput name="password" placeholder="pw" />);
    const input = screen.getByPlaceholderText('pw');
    const toggle = screen.getByRole('button', { name: /show password/i });

    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /hide password/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: /hide password/i }));
    expect(input).toHaveAttribute('type', 'password');
  });

  test('forwards aria-invalid from Field wiring', () => {
    render(<PasswordInput name="password" placeholder="pw" aria-invalid />);
    expect(screen.getByPlaceholderText('pw')).toHaveAttribute('aria-invalid', 'true');
  });

  test('renders a start icon and pads the input when startIcon is provided', () => {
    render(
      <PasswordInput name="password" placeholder="pw" startIcon={<svg data-testid="lock" />} />,
    );
    expect(screen.getByTestId('lock')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('pw')).toHaveClass('pl-11');
  });
});
