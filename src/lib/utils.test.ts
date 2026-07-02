/**
 * Regression tests for formatFileSize — guards the "0.0 MB" bug where small
 * files (< 1 MB) were always displayed in MB, rounding to "0.0 MB" instead of
 * an accurate size in the most appropriate unit.
 */

import { describe, it, expect } from 'vitest';
import { formatFileSize } from './utils';

describe('formatFileSize', () => {
  it('returns "0 Bytes" for zero, negative, or non-finite input', () => {
    expect(formatFileSize(0)).toBe('0 Bytes');
    expect(formatFileSize(-100)).toBe('0 Bytes');
    expect(formatFileSize(NaN)).toBe('0 Bytes');
    expect(formatFileSize(Infinity)).toBe('0 Bytes');
  });

  it('formats sub-1KB sizes in Bytes', () => {
    expect(formatFileSize(1)).toBe('1 Bytes');
    expect(formatFileSize(500)).toBe('500 Bytes');
    expect(formatFileSize(1023)).toBe('1023 Bytes');
  });

  it('formats sizes in the 1KB–1MB range as KB, not "0.0 MB"', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(51200)).toBe('50 KB');
    expect(formatFileSize(500 * 1024)).toBe('500 KB'); // previously rendered as "0.5 MB" / "0.0 MB"
  });

  it('formats sizes in the 1MB–1GB range as MB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB');
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('formats sizes in the 1GB–1TB range as GB', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
    expect(formatFileSize(3.2 * 1024 * 1024 * 1024)).toBe('3.2 GB');
  });

  it('formats sizes >= 1TB as TB (falls back to the largest defined unit)', () => {
    expect(formatFileSize(1024 * 1024 * 1024 * 1024)).toBe('1 TB');
  });
});
