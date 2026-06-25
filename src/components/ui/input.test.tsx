import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Input } from './input';

describe('Input startIcon', () => {
  test('renders without a wrapper or icon by default', () => {
    render(<Input placeholder="plain" />);
    const input = screen.getByPlaceholderText('plain');
    expect(input.tagName).toBe('INPUT');
    expect(input).not.toHaveClass('pl-11');
  });

  test('renders the start icon and adds left padding', () => {
    render(<Input placeholder="with-icon" startIcon={<svg data-testid="mail" />} />);
    const input = screen.getByPlaceholderText('with-icon');
    expect(screen.getByTestId('mail')).toBeInTheDocument();
    expect(input).toHaveClass('pl-11');
  });

  test('forwards id and aria props to the inner input even with a start icon', () => {
    render(
      <Input
        placeholder="with-icon"
        id="email"
        aria-invalid
        aria-describedby="err"
        startIcon={<svg />}
      />,
    );
    const input = screen.getByPlaceholderText('with-icon');
    expect(input).toHaveAttribute('id', 'email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'err');
  });
});
