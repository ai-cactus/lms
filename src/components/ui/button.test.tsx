import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Button } from './button';

describe('Button loading', () => {
  test('disables the button and sets aria-busy when loading', () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  test('renders a spinner icon when loading', () => {
    const { container } = render(<Button loading>Save</Button>);
    expect(container.querySelector('svg.animate-spin')).toBeInTheDocument();
  });

  test('is not disabled or busy by default', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn).not.toBeDisabled();
    expect(btn).not.toHaveAttribute('aria-busy');
  });

  test('does not inject spinner when asChild (Slot single-child)', () => {
    const { container } = render(
      <Button asChild loading>
        <a href="/x">Link</a>
      </Button>,
    );
    expect(container.querySelector('svg.animate-spin')).not.toBeInTheDocument();
  });

  test('a disabled (not loading) button is disabled without aria-busy', () => {
    // Distinguishes the grey "requirements not met" state (disabled, no aria-busy)
    // from the loading state (disabled + aria-busy, which keeps the brand colour).
    render(<Button disabled>Save</Button>);
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn).toBeDisabled();
    expect(btn).not.toHaveAttribute('aria-busy');
  });
});
