/**
 * Unit tests for src/lib/course/retake-deadline.ts (Q-26): the dialog's
 * pre-fill, the server-side parse of the picked date (the BUG-12 NaN-guard gap
 * closed for this path), and the server default.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RETAKE_DUE_DAYS,
  defaultRetakeDueAt,
  defaultRetakeDueDate,
  parseRetakeDueDate,
} from './retake-deadline';

const NOW = new Date('2026-09-28T15:00:00.000Z');
const UNREADABLE = "That due date couldn't be read. Please pick the date again.";

describe('defaultRetakeDueDate', () => {
  it(`is ${DEFAULT_RETAKE_DUE_DAYS} calendar days after today, in the viewer's own calendar`, () => {
    expect(defaultRetakeDueDate(new Date(2026, 8, 28, 12))).toBe('2026-10-12');
  });

  it('rolls across a month and a year end', () => {
    expect(defaultRetakeDueDate(new Date(2026, 11, 25, 12))).toBe('2027-01-08');
  });
});

describe('parseRetakeDueDate', () => {
  it('turns a date into that day at 11:59 PM UTC', () => {
    expect(parseRetakeDueDate('2026-10-05', NOW)).toEqual({
      dueAt: new Date('2026-10-05T23:59:00.000Z'),
    });
  });

  it('accepts today while the day has not ended', () => {
    expect(parseRetakeDueDate('2026-09-28', NOW)).toEqual({
      dueAt: new Date('2026-09-28T23:59:00.000Z'),
    });
  });

  it('refuses a date in the past', () => {
    expect(parseRetakeDueDate('2026-09-27', NOW)).toEqual({
      refusedReason: 'The retake due date must be today or later.',
    });
  });

  it.each([
    ['an impossible day, which Date would roll forward', '2026-02-31'],
    ['month 13', '2026-13-01'],
    ['a timestamp rather than a date', '2026-10-05T10:00:00Z'],
    ['free text', 'next friday'],
    ['an empty string', ''],
    ['a number', 20261005],
    ['null', null],
  ])('refuses %s as unreadable', (_label, value) => {
    expect(parseRetakeDueDate(value, NOW)).toEqual({ refusedReason: UNREADABLE });
  });
});

describe('defaultRetakeDueAt', () => {
  it(`is ${DEFAULT_RETAKE_DUE_DAYS} UTC days out, at 11:59 PM UTC`, () => {
    expect(defaultRetakeDueAt(NOW)).toEqual(new Date('2026-10-12T23:59:00.000Z'));
  });
});
