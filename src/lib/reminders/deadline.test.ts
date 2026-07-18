/**
 * Unit tests for src/lib/reminders/deadline.ts
 *
 * Pure functions — no mocks required, except for env-var manipulation in
 * resolveDefaultDueWindowDays tests (restored after each test via afterEach).
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_DUE_WINDOW_DAYS,
  resolveDefaultDueWindowDays,
  resolveStartDate,
  computeDueAt,
  combineDateAndTime,
} from './deadline';

// Snap-shot the original value so we can restore it.
const ORIGINAL_ENV = process.env.REMINDER_DEFAULT_DUE_WINDOW_DAYS;
afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.REMINDER_DEFAULT_DUE_WINDOW_DAYS;
  } else {
    process.env.REMINDER_DEFAULT_DUE_WINDOW_DAYS = ORIGINAL_ENV;
  }
});

describe('resolveDefaultDueWindowDays', () => {
  it('returns DEFAULT_DUE_WINDOW_DAYS (30) when env var is absent', () => {
    delete process.env.REMINDER_DEFAULT_DUE_WINDOW_DAYS;
    expect(resolveDefaultDueWindowDays()).toBe(DEFAULT_DUE_WINDOW_DAYS);
    expect(DEFAULT_DUE_WINDOW_DAYS).toBe(30);
  });

  it('returns the parsed env value when REMINDER_DEFAULT_DUE_WINDOW_DAYS is valid', () => {
    process.env.REMINDER_DEFAULT_DUE_WINDOW_DAYS = '14';
    expect(resolveDefaultDueWindowDays()).toBe(14);
  });

  it('falls back to DEFAULT_DUE_WINDOW_DAYS for a non-numeric env value', () => {
    process.env.REMINDER_DEFAULT_DUE_WINDOW_DAYS = 'not-a-number';
    expect(resolveDefaultDueWindowDays()).toBe(DEFAULT_DUE_WINDOW_DAYS);
  });

  it('falls back to DEFAULT_DUE_WINDOW_DAYS for a zero env value (non-positive)', () => {
    process.env.REMINDER_DEFAULT_DUE_WINDOW_DAYS = '0';
    expect(resolveDefaultDueWindowDays()).toBe(DEFAULT_DUE_WINDOW_DAYS);
  });

  it('falls back to DEFAULT_DUE_WINDOW_DAYS for a negative env value', () => {
    process.env.REMINDER_DEFAULT_DUE_WINDOW_DAYS = '-5';
    expect(resolveDefaultDueWindowDays()).toBe(DEFAULT_DUE_WINDOW_DAYS);
  });

  it('falls back to DEFAULT_DUE_WINDOW_DAYS for Infinity (non-finite)', () => {
    process.env.REMINDER_DEFAULT_DUE_WINDOW_DAYS = 'Infinity';
    expect(resolveDefaultDueWindowDays()).toBe(DEFAULT_DUE_WINDOW_DAYS);
  });
});

describe('resolveStartDate', () => {
  const SCHED = new Date('2024-06-01T00:00:00Z');
  const ACCESS = new Date('2024-06-05T00:00:00Z');
  const STARTED = new Date('2024-06-10T00:00:00Z');

  it('uses scheduleAt when all three dates are present (highest priority)', () => {
    const result = resolveStartDate(
      { scheduleAt: SCHED },
      { accessAt: ACCESS, startedAt: STARTED },
    );
    expect(result).toBe(SCHED);
  });

  it('uses accessAt when scheduleAt is null', () => {
    const result = resolveStartDate({ scheduleAt: null }, { accessAt: ACCESS, startedAt: STARTED });
    expect(result).toBe(ACCESS);
  });

  it('uses startedAt when scheduleAt and accessAt are both null', () => {
    const result = resolveStartDate({ scheduleAt: null }, { accessAt: null, startedAt: STARTED });
    expect(result).toBe(STARTED);
  });
});

describe('computeDueAt', () => {
  const START = new Date('2024-06-01T00:00:00Z');

  it('returns assignmentDueAt directly when it is provided (highest priority)', () => {
    const dueAt = new Date('2024-07-15T00:00:00Z');
    const result = computeDueAt({
      assignmentDueAt: dueAt,
      assignmentWindowDays: 10,
      orgWindowDays: 20,
      start: START,
    });
    expect(result).toBe(dueAt);
  });

  it('uses assignmentWindowDays when assignmentDueAt is null', () => {
    const result = computeDueAt({
      assignmentDueAt: null,
      assignmentWindowDays: 7,
      orgWindowDays: 14,
      start: START,
    });
    // start + 7 days = 2024-06-08
    expect(result.toISOString()).toBe('2024-06-08T00:00:00.000Z');
  });

  it('falls back to orgWindowDays when assignmentWindowDays is null', () => {
    const result = computeDueAt({
      assignmentDueAt: null,
      assignmentWindowDays: null,
      orgWindowDays: 14,
      start: START,
    });
    // start + 14 days = 2024-06-15
    expect(result.toISOString()).toBe('2024-06-15T00:00:00.000Z');
  });

  it('falls back to the system default (30 days) when all explicit windows are null', () => {
    delete process.env.REMINDER_DEFAULT_DUE_WINDOW_DAYS;
    const result = computeDueAt({
      assignmentDueAt: null,
      assignmentWindowDays: null,
      orgWindowDays: null,
      start: START,
    });
    // start + DEFAULT_DUE_WINDOW_DAYS (30) = 2024-07-01
    expect(result.toISOString()).toBe('2024-07-01T00:00:00.000Z');
  });

  it('honors REMINDER_DEFAULT_DUE_WINDOW_DAYS env override when all explicit windows are null', () => {
    process.env.REMINDER_DEFAULT_DUE_WINDOW_DAYS = '60';
    const result = computeDueAt({
      assignmentDueAt: null,
      assignmentWindowDays: null,
      orgWindowDays: null,
      start: START,
    });
    // start + 60 days = 2024-07-31
    expect(result.toISOString()).toBe('2024-07-31T00:00:00.000Z');
  });
});

describe('combineDateAndTime', () => {
  // Regression guard for the wizard deadline-drop bug (Issue #2 / TC-015):
  // createFullCourse must pass a real due date through to enrollUsers instead
  // of silently dropping it.
  it('returns null when no date is given, regardless of time', () => {
    expect(combineDateAndTime(null, '9:00 AM')).toBeNull();
    expect(combineDateAndTime(undefined, '9:00 AM')).toBeNull();
  });

  it('leaves the deadline at 00:00 UTC when no time is given', () => {
    const date = new Date('2026-08-01T00:00:00Z');
    const result = combineDateAndTime(date, undefined);
    expect(result?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('leaves the deadline at 00:00 UTC when the time string is empty', () => {
    const date = new Date('2026-08-01T00:00:00Z');
    const result = combineDateAndTime(date, '');
    expect(result?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('parses a canonical "H:MM AM" time onto the date', () => {
    const date = new Date('2026-08-01T00:00:00Z');
    const result = combineDateAndTime(date, '9:30 AM');
    expect(result?.toISOString()).toBe('2026-08-01T09:30:00.000Z');
  });

  it('parses a canonical "H:MM PM" time, rolling the hour into 24h', () => {
    const date = new Date('2026-08-01T00:00:00Z');
    const result = combineDateAndTime(date, '5:45 PM');
    expect(result?.toISOString()).toBe('2026-08-01T17:45:00.000Z');
  });

  it('treats 12:00 AM (midnight) as hour 0', () => {
    const date = new Date('2026-08-01T00:00:00Z');
    const result = combineDateAndTime(date, '12:00 AM');
    expect(result?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('treats 12:00 PM (noon) as hour 12', () => {
    const date = new Date('2026-08-01T00:00:00Z');
    const result = combineDateAndTime(date, '12:00 PM');
    expect(result?.toISOString()).toBe('2026-08-01T12:00:00.000Z');
  });

  it('returns 00:00 UTC when the time string is unparseable (no digits)', () => {
    const date = new Date('2026-08-01T00:00:00Z');
    const result = combineDateAndTime(date, 'noon-ish');
    expect(result?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('does not mutate the original dueDate object', () => {
    const date = new Date('2026-08-01T00:00:00Z');
    combineDateAndTime(date, '9:30 AM');
    expect(date.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
});
