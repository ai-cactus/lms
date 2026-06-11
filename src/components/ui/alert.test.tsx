import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Alert } from './alert';

describe('Alert', () => {
  test('renders title and description with role=alert', () => {
    render(
      <Alert variant="success" title="Saved">
        Your changes were saved.
      </Alert>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Saved');
    expect(alert).toHaveTextContent('Your changes were saved.');
  });

  test('applies the variant class', () => {
    render(<Alert variant="error" title="Oops" />);
    expect(screen.getByRole('alert').className).toMatch(/border-error/);
  });

  test('renders an icon', () => {
    const { container } = render(<Alert variant="warning" title="Careful" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
