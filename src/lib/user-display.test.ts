import { describe, it, expect } from 'vitest';
import { getUserDisplayName, getUserInitials } from './user-display';

describe('getUserDisplayName', () => {
  it('prefers the stored full name when both it and first/last are set', () => {
    expect(
      getUserDisplayName(
        { fullName: 'Jane Q Doe', firstName: 'Jane', lastName: 'Doe' },
        'jane.doe@example.com',
      ),
    ).toBe('Jane Q Doe');
  });

  it('uses the full name when first and last are null', () => {
    expect(
      getUserDisplayName(
        { fullName: 'Jane Doe', firstName: null, lastName: null },
        'jane.doe@example.com',
      ),
    ).toBe('Jane Doe');
  });

  it('composes first and last when the full name is null', () => {
    expect(
      getUserDisplayName(
        { fullName: null, firstName: 'Jane', lastName: 'Doe' },
        'jane.doe@example.com',
      ),
    ).toBe('Jane Doe');
  });

  it('uses whichever of first or last is present on its own', () => {
    expect(getUserDisplayName({ firstName: 'Jane', lastName: null }, 'j@example.com')).toBe('Jane');
    expect(getUserDisplayName({ firstName: null, lastName: 'Doe' }, 'j@example.com')).toBe('Doe');
  });

  it('falls back to the email local part when no name part is set', () => {
    expect(
      getUserDisplayName({ fullName: null, firstName: null, lastName: null }, 'jdoe@x.com'),
    ).toBe('jdoe');
    expect(getUserDisplayName(null, 'jdoe@x.com')).toBe('jdoe');
  });

  it('treats whitespace-only name parts as absent', () => {
    expect(
      getUserDisplayName({ fullName: '   ', firstName: '  ', lastName: '' }, 'jdoe@x.com'),
    ).toBe('jdoe');
  });

  it('falls back to the whole string when the email has no local part', () => {
    expect(getUserDisplayName(null, '@example.com')).toBe('@example.com');
  });
});

describe('getUserInitials', () => {
  it('takes the first letter of each word, capped at two', () => {
    expect(getUserInitials({ fullName: 'Jane Q Doe' }, 'j@example.com')).toBe('JQ');
  });

  it('derives initials from first/last when the full name is null', () => {
    expect(getUserInitials({ firstName: 'Jane', lastName: 'Doe' }, 'j@example.com')).toBe('JD');
  });

  it('never returns "UN" for a user carrying only a full name', () => {
    expect(
      getUserInitials({ fullName: 'Jane Doe', firstName: null, lastName: null }, 'j@x.com'),
    ).toBe('JD');
  });

  it('falls back to the email local part when no name part is set', () => {
    expect(getUserInitials(null, 'jdoe@example.com')).toBe('J');
  });

  it('returns a placeholder rather than an empty monogram when there is nothing to go on', () => {
    expect(getUserInitials(null, '')).toBe('?');
  });
});
