/**
 * Unit tests for the shared free-text email-list parser used by the staff
 * invite modal and the course assign modal. Both flows depend on identical
 * validation, so the rules are pinned here rather than in either consumer.
 */
import { describe, it, expect } from 'vitest';
import { parseEmailList, isValidEmail } from './email-list';

describe('isValidEmail', () => {
  it.each(['a@b.co', 'first.last+tag@sub.example.org'])('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each(['', 'no-at-sign', 'a@b', 'a @b.co', 'a@@b.co'])('rejects %s', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});

describe('parseEmailList', () => {
  it('splits on commas, spaces, semicolons and new lines', () => {
    expect(parseEmailList('a@x.com, b@x.com c@x.com;d@x.com\ne@x.com').valid).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
      'd@x.com',
      'e@x.com',
    ]);
  });

  it('lowercases and de-duplicates while preserving first-seen order', () => {
    const result = parseEmailList('B@x.com, a@x.com, b@X.com');

    expect(result.valid).toEqual(['b@x.com', 'a@x.com']);
    expect(result.invalidCount).toBe(0);
  });

  it('counts invalid tokens without dropping the valid ones', () => {
    const result = parseEmailList('good@x.com, nope, also-bad@');

    expect(result.valid).toEqual(['good@x.com']);
    expect(result.invalidCount).toBe(2);
  });

  it('returns an empty result for blank / whitespace-only input', () => {
    expect(parseEmailList('   \n  ')).toEqual({ valid: [], invalidCount: 0 });
  });
});
