/**
 * Tests for the new `disabled` prop added to PhoneInput so FacilityForm can
 * render the phone field as fully read-only. Also guards the pre-existing
 * (enabled) typing/onChange behavior so the new prop doesn't regress it.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import PhoneInput from './PhoneInput';

const PLACEHOLDER = 'Enter the phone number of the main contact';

describe('PhoneInput — disabled', () => {
  it('disables the tel input and the country-selector button', () => {
    render(<PhoneInput value="" allowedCountries={['US']} disabled />);

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeDisabled();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('does not change the value or fire onChange when typing', async () => {
    const onChange = vi.fn();
    render(<PhoneInput value="" onChange={onChange} allowedCountries={['US']} disabled />);

    const input = screen.getByPlaceholderText(PLACEHOLDER);
    await userEvent.type(input, '5551234567');

    expect(input).toHaveValue('');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not open the country dropdown when the selector button is clicked', async () => {
    render(<PhoneInput value="" allowedCountries={['US', 'GB']} disabled />);

    await userEvent.click(screen.getByRole('button'));

    expect(screen.queryByPlaceholderText('Search countries...')).not.toBeInTheDocument();
  });
});

describe('PhoneInput — enabled (guards pre-existing behavior)', () => {
  it('allows typing and formats/reports a US number via onChange', async () => {
    const onChange = vi.fn();
    render(<PhoneInput value="" onChange={onChange} allowedCountries={['US']} />);

    const input = screen.getByPlaceholderText(PLACEHOLDER);
    expect(input).not.toBeDisabled();

    await userEvent.type(input, '5551234567');

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]).toBe('+1 (555)-123-4567');
  });

  it('enables the country-selector button when more than one country is allowed', () => {
    render(<PhoneInput value="" allowedCountries={['US', 'GB']} />);

    expect(screen.getByRole('button')).not.toBeDisabled();
  });
});
