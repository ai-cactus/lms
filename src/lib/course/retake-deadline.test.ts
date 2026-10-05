/**
 * Unit tests for src/lib/course/retake-deadline.ts (Q-26): the dialog's
 * pre-fill, the server-side parse of the picked date (the BUG-12 NaN-guard gap
 * closed for this path), the learner-zone deadline (BUG-12.3), and the server
 * default.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RETAKE_DUE_DAYS,
  defaultRetakeDueAt,
  defaultRetakeDueDate,
  parseRetakeDueDate,
  retakeDueAt,
  retakeDueAtIfNotPast,
} from './retake-deadline';

const NOW = new Date('2026-09-28T15:00:00.000Z');
const UNREADABLE = "That due date couldn't be read. Please pick the date again.";
const PAST = (zone: string) =>
  `That due date has already passed where this learner is (${zone}). Please pick a later date.`;

describe('defaultRetakeDueDate', () => {
  it(`is ${DEFAULT_RETAKE_DUE_DAYS} calendar days after the learner's today`, () => {
    expect(defaultRetakeDueDate(NOW, 'America/New_York')).toBe('2026-10-12');
  });

  // 15:00 UTC on 28 Sept is still the 28th in Honolulu, already the 29th in Kiritimati.
  it("counts from a UTC+14 learner's today, a day ahead of a UTC−10 one", () => {
    expect(defaultRetakeDueDate(NOW, 'Pacific/Kiritimati')).toBe('2026-10-13');
    expect(defaultRetakeDueDate(NOW, 'Pacific/Honolulu')).toBe('2026-10-12');
  });

  it('rolls across a month and a year end', () => {
    expect(defaultRetakeDueDate(new Date('2026-12-25T12:00:00Z'), 'UTC')).toBe('2027-01-08');
  });

  it('is the date the server default ends on, so dialog and server agree', () => {
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Honolulu', 'America/New_York']) {
      expect(defaultRetakeDueAt(NOW, zone)).toEqual(
        retakeDueAt(defaultRetakeDueDate(NOW, zone), zone),
      );
    }
  });
});

describe('parseRetakeDueDate', () => {
  it('accepts a real calendar date', () => {
    expect(parseRetakeDueDate('2026-10-05')).toEqual({ dueDate: '2026-10-05' });
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
    expect(parseRetakeDueDate(value)).toEqual({ refusedReason: UNREADABLE });
  });
});

describe('retakeDueAt', () => {
  it('is 11:59 PM on the date in the given zone', () => {
    expect(retakeDueAt('2026-10-05', 'UTC')).toEqual(new Date('2026-10-05T23:59:00.000Z'));
  });
});

describe('retakeDueAtIfNotPast', () => {
  it('ends the picked date at 11:59 PM in the learner zone', () => {
    expect(retakeDueAtIfNotPast('2026-10-05', 'America/New_York', NOW)).toEqual({
      dueAt: new Date('2026-10-06T03:59:00.000Z'),
    });
  });

  // BUG-12.3: the same picked date ends at 23:59 wherever the learner's facility is.
  it.each([
    ['UTC+14 (Pacific/Kiritimati)', 'Pacific/Kiritimati', '2026-10-05T09:59:00.000Z'],
    ['UTC−10 (Pacific/Honolulu)', 'Pacific/Honolulu', '2026-10-06T09:59:00.000Z'],
  ])('ends it at 23:59 local for a facility at %s', (_label, timeZone, expected) => {
    expect(retakeDueAtIfNotPast('2026-10-05', timeZone, NOW)).toEqual({
      dueAt: new Date(expected),
    });
  });

  it('accepts today while the day has not ended where the learner is', () => {
    expect(retakeDueAtIfNotPast('2026-09-28', 'America/New_York', NOW)).toEqual({
      dueAt: new Date('2026-09-29T03:59:00.000Z'),
    });
  });

  it("refuses today once the learner's day has ended, though it has not ended in UTC", () => {
    // 15:00 UTC on 28 Sept is already 29 Sept 05:00 in Kiritimati.
    expect(retakeDueAtIfNotPast('2026-09-28', 'Pacific/Kiritimati', NOW)).toEqual({
      refusedReason: PAST('Pacific/Kiritimati'),
    });
  });

  it('refuses a date in the past', () => {
    expect(retakeDueAtIfNotPast('2026-09-27', 'America/New_York', NOW)).toEqual({
      refusedReason: PAST('America/New_York'),
    });
  });
});

describe('defaultRetakeDueAt', () => {
  it(`is ${DEFAULT_RETAKE_DUE_DAYS} days after today in the learner zone, at 11:59 PM there`, () => {
    expect(defaultRetakeDueAt(NOW, 'America/New_York')).toEqual(
      new Date('2026-10-13T03:59:00.000Z'),
    );
  });

  it("counts from the learner's today, which may already be tomorrow in UTC", () => {
    // 15:00 UTC on 28 Sept is 29 Sept in Kiritimati, so 14 days on is 13 Oct.
    expect(defaultRetakeDueAt(NOW, 'Pacific/Kiritimati')).toEqual(
      new Date('2026-10-13T09:59:00.000Z'),
    );
  });
});
