import { describe, expect, test } from 'vitest';
import { sanitizeHtml } from './sanitize';

describe('sanitizeHtml', () => {
  test('strips script tags', () => {
    expect(sanitizeHtml('<p>ok</p><script>alert(1)</script>')).not.toContain('script');
  });

  test('keeps allowed formatting tags', () => {
    const out = sanitizeHtml('<h2>About</h2><ul><li>One</li></ul>');
    expect(out).toContain('<h2>About</h2>');
    expect(out).toContain('<li>One</li>');
  });

  test('forces rel="noopener noreferrer" on target="_blank" links', () => {
    const out = sanitizeHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  test('returns empty string for falsy input', () => {
    expect(sanitizeHtml('')).toBe('');
  });
});
