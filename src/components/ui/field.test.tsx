import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Field } from './field';
import { Input } from './input';

describe('Field', () => {
  test('associates label with the control', () => {
    render(
      <Field label="Email">
        <Input name="email" />
      </Field>,
    );
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  test('renders error text and marks control invalid + described-by', () => {
    render(
      <Field label="Email" error="Email is required">
        <Input name="email" />
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    const error = screen.getByText('Email is required');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', error.getAttribute('id'));
  });

  test('renders helper text when no error', () => {
    render(
      <Field label="Email" helperText="We never share this">
        <Input name="email" />
      </Field>,
    );
    expect(screen.getByText('We never share this')).toBeInTheDocument();
  });

  test('error takes precedence over helper text', () => {
    render(
      <Field label="Email" error="Bad" helperText="Helper">
        <Input name="email" />
      </Field>,
    );
    expect(screen.getByText('Bad')).toBeInTheDocument();
    expect(screen.queryByText('Helper')).not.toBeInTheDocument();
  });

  test('preserves a child-provided aria-describedby (merges, no clobber)', () => {
    render(
      <Field label="Password">
        <Input name="password" aria-describedby="strength-hint" />
      </Field>,
    );
    const input = screen.getByLabelText('Password');
    expect(input.getAttribute('aria-describedby')).toContain('strength-hint');
  });

  test('merges error id with child-provided aria-describedby', () => {
    render(
      <Field label="Password" error="Too weak">
        <Input name="password" aria-describedby="strength-hint" />
      </Field>,
    );
    const input = screen.getByLabelText('Password');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('strength-hint');
    const errorEl = screen.getByText('Too weak');
    expect(describedBy).toContain(errorEl.getAttribute('id'));
  });
});
