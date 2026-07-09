/**
 * Unit tests for src/lib/reminders/time.ts
 *
 * All functions are pure (explicit Date + tz → explicit output), so no mocking
 * is required. Tests cover: cross-timezone day differences, DST transitions,
 * invalid-tz fallback, midnight-straddling instants, and addDays arithmetic.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_TZ, localDateKey, startOfDayInTz, addDays, diffInDaysInTz } from './time';

describe('time utilities', () => {
  describe('localDateKey', () => {
    it('returns YYYY-MM-DD for a UTC instant at midnight EST (America/New_York)', () => {
      // 2024-01-15T05:00:00Z = 2024-01-15T00:00:00 EST (UTC-5)
      expect(localDateKey(new Date('2024-01-15T05:00:00Z'), 'America/New_York')).toBe('2024-01-15');
    });

    it('returns the prior calendar day for an instant that is still "yesterday" in Los Angeles', () => {
      // 2024-01-15T05:00:00Z = 2024-01-14T21:00:00 PST (UTC-8) → still Jan 14 in LA
      expect(localDateKey(new Date('2024-01-15T05:00:00Z'), 'America/Los_Angeles')).toBe(
        '2024-01-14',
      );
    });

    it('returns the correct date in Hawaii (Pacific/Honolulu, no DST, UTC-10)', () => {
      // 2024-01-15T10:00:00Z = 2024-01-15T00:00:00 HST (UTC-10)
      expect(localDateKey(new Date('2024-01-15T10:00:00Z'), 'Pacific/Honolulu')).toBe('2024-01-15');
    });

    it('maps an instant one second before midnight to the correct local day', () => {
      // 2024-07-04T03:59:59Z = 2024-07-03T23:59:59 EDT (UTC-4) → still July 3 in New York
      const date = new Date('2024-07-04T03:59:59Z');
      expect(localDateKey(date, 'America/New_York')).toBe('2024-07-03');
    });

    it('returns a different local date for the same UTC instant in different timezones', () => {
      // 2024-06-15T05:00:00Z = 01:00 EDT (Jun 15) in New York vs 22:00 PDT (Jun 14) in LA
      const date = new Date('2024-06-15T05:00:00Z');
      expect(localDateKey(date, 'America/New_York')).toBe('2024-06-15');
      expect(localDateKey(date, 'America/Los_Angeles')).toBe('2024-06-14');
    });

    it('falls back to DEFAULT_TZ for an invalid timezone', () => {
      const date = new Date('2024-01-15T05:00:00Z');
      expect(localDateKey(date, 'Invalid/Zone')).toBe(localDateKey(date, DEFAULT_TZ));
    });

    it('spring-forward boundary (2024-03-10 in New York) — local day is still March 10', () => {
      // 07:00 UTC = the moment spring-forward occurs (02:00 EST → 03:00 EDT)
      expect(localDateKey(new Date('2024-03-10T07:00:00Z'), 'America/New_York')).toBe('2024-03-10');
    });

    it('fall-back boundary (2024-11-03 in New York) — repeated 01:00 hour still lands on Nov 3', () => {
      // 06:30 UTC = 01:30 EST (after fall-back), still November 3
      expect(localDateKey(new Date('2024-11-03T06:30:00Z'), 'America/New_York')).toBe('2024-11-03');
    });
  });

  describe('startOfDayInTz', () => {
    it('returns the UTC instant for midnight EST (UTC-5) on a winter day in New York', () => {
      // Noon UTC Jan 15 = 07:00 EST; midnight Jan 15 EST = 05:00 UTC
      const result = startOfDayInTz(new Date('2024-01-15T12:00:00Z'), 'America/New_York');
      expect(result.toISOString()).toBe('2024-01-15T05:00:00.000Z');
    });

    it('returns the UTC instant for midnight PST (UTC-8) on a winter day in Los Angeles', () => {
      // Midnight Jan 15 PST = 08:00 UTC
      const result = startOfDayInTz(new Date('2024-01-15T12:00:00Z'), 'America/Los_Angeles');
      expect(result.toISOString()).toBe('2024-01-15T08:00:00.000Z');
    });

    it('preserves the local calendar day for an instant that is already at local midnight', () => {
      // 05:00 UTC = midnight EST Jan 15; startOfDay should also be 05:00 UTC
      const result = startOfDayInTz(new Date('2024-01-15T05:00:00Z'), 'America/New_York');
      expect(result.toISOString()).toBe('2024-01-15T05:00:00.000Z');
    });

    it('handles DST spring-forward: midnight of 2024-03-10 in New York is 05:00 UTC (still EST at midnight)', () => {
      // Spring-forward is at 07:00 UTC (02:00 EST → 03:00 EDT); midnight is still in EST
      const result = startOfDayInTz(new Date('2024-03-10T12:00:00Z'), 'America/New_York');
      expect(result.toISOString()).toBe('2024-03-10T05:00:00.000Z');
    });

    it('handles DST fall-back: midnight of 2024-11-03 in New York is 04:00 UTC (midnight is still in EDT)', () => {
      // Fall-back: clocks go 02:00 EDT → 01:00 EST at 06:00 UTC on Nov 3.
      // Midnight Nov 3 (00:00 local) is BEFORE that transition → still in EDT (UTC-4).
      // So midnight Nov 3 EDT = 04:00 UTC.
      const result = startOfDayInTz(new Date('2024-11-03T12:00:00Z'), 'America/New_York');
      expect(result.toISOString()).toBe('2024-11-03T04:00:00.000Z');
    });

    it('falls back to DEFAULT_TZ for an invalid timezone', () => {
      const date = new Date('2024-01-15T12:00:00Z');
      expect(startOfDayInTz(date, 'Not/A/Zone').getTime()).toBe(
        startOfDayInTz(date, DEFAULT_TZ).getTime(),
      );
    });
  });

  describe('addDays', () => {
    it('adds positive days', () => {
      expect(addDays(new Date('2024-01-15T00:00:00.000Z'), 5).toISOString()).toBe(
        '2024-01-20T00:00:00.000Z',
      );
    });

    it('subtracts days when days is negative', () => {
      expect(addDays(new Date('2024-01-15T00:00:00.000Z'), -2).toISOString()).toBe(
        '2024-01-13T00:00:00.000Z',
      );
    });

    it('crosses a month boundary (Jan → Feb)', () => {
      expect(addDays(new Date('2024-01-30T00:00:00.000Z'), 5).toISOString()).toBe(
        '2024-02-04T00:00:00.000Z',
      );
    });

    it('handles a leap-year February (2024-02-28 + 1 = 2024-02-29)', () => {
      expect(addDays(new Date('2024-02-28T00:00:00.000Z'), 1).toISOString()).toBe(
        '2024-02-29T00:00:00.000Z',
      );
    });

    it('adds 0 days returning an equal-time copy', () => {
      const date = new Date('2024-06-15T12:34:56.789Z');
      const result = addDays(date, 0);
      expect(result.getTime()).toBe(date.getTime());
    });

    it('does not mutate the input date', () => {
      const date = new Date('2024-01-15T00:00:00.000Z');
      const originalTime = date.getTime();
      addDays(date, 7);
      expect(date.getTime()).toBe(originalTime);
    });
  });

  describe('diffInDaysInTz', () => {
    it('returns 0 when both instants fall in the same local calendar day', () => {
      const a = new Date('2024-01-15T20:00:00Z'); // 15:00 EST Jan 15
      const b = new Date('2024-01-15T08:00:00Z'); //  03:00 EST Jan 15
      expect(diffInDaysInTz(a, b, 'America/New_York')).toBe(0);
    });

    it('returns a positive integer when a is later than b', () => {
      const a = new Date('2024-01-18T12:00:00Z');
      const b = new Date('2024-01-15T12:00:00Z');
      expect(diffInDaysInTz(a, b, 'America/New_York')).toBe(3);
    });

    it('returns a negative integer when a is earlier than b', () => {
      const a = new Date('2024-01-12T12:00:00Z');
      const b = new Date('2024-01-15T12:00:00Z');
      expect(diffInDaysInTz(a, b, 'America/New_York')).toBe(-3);
    });

    it('returns whole days across a DST spring-forward (NY 2024-03-09 → 2024-03-10)', () => {
      // March 9 noon EST (17:00 UTC) → March 10 noon EDT (16:00 UTC) = 1 calendar day
      const a = new Date('2024-03-10T16:00:00Z'); // 12:00 EDT
      const b = new Date('2024-03-09T17:00:00Z'); // 12:00 EST
      expect(diffInDaysInTz(a, b, 'America/New_York')).toBe(1);
    });

    it('returns whole days across a DST fall-back (NY 2024-11-02 → 2024-11-03)', () => {
      // Nov 2 noon EDT (16:00 UTC) → Nov 3 noon EST (17:00 UTC) = 1 calendar day
      const a = new Date('2024-11-03T17:00:00Z'); // 12:00 EST
      const b = new Date('2024-11-02T16:00:00Z'); // 12:00 EDT
      expect(diffInDaysInTz(a, b, 'America/New_York')).toBe(1);
    });

    it('works in a timezone with a non-integer UTC offset (India Standard Time UTC+5:30)', () => {
      // June 15 noon UTC = 17:30 IST → June 15; June 18 noon UTC = June 18 in IST
      const a = new Date('2024-06-18T12:00:00Z');
      const b = new Date('2024-06-15T12:00:00Z');
      expect(diffInDaysInTz(a, b, 'Asia/Kolkata')).toBe(3);
    });

    it('falls back to DEFAULT_TZ for an invalid timezone', () => {
      const a = new Date('2024-01-18T12:00:00Z');
      const b = new Date('2024-01-15T12:00:00Z');
      expect(diffInDaysInTz(a, b, 'Invalid/Zone')).toBe(diffInDaysInTz(a, b, DEFAULT_TZ));
    });
  });
});
