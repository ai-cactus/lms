import { describe, expect, test } from 'vitest';
import { isEmptyHtml, containsHtml } from './html';

describe('isEmptyHtml', () => {
  test('treats empty string as empty', () => {
    expect(isEmptyHtml('')).toBe(true);
  });

  test('treats whitespace as empty', () => {
    expect(isEmptyHtml('   \n  ')).toBe(true);
  });

  test('treats Quill empty markup as empty', () => {
    expect(isEmptyHtml('<p><br></p>')).toBe(true);
  });

  test('treats &nbsp;-only markup as empty', () => {
    expect(isEmptyHtml('<p>&nbsp;</p>')).toBe(true);
  });

  test('treats real content as non-empty', () => {
    expect(isEmptyHtml('<p>Hello</p>')).toBe(false);
  });

  test('treats plain text as non-empty', () => {
    expect(isEmptyHtml('About')).toBe(false);
  });
});

describe('containsHtml', () => {
  test('detects HTML tags', () => {
    expect(containsHtml('<h2>About</h2>')).toBe(true);
  });

  test('returns false for plain text with no tags', () => {
    expect(containsHtml('About\nCourse Overview ...')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(containsHtml('')).toBe(false);
  });
});
