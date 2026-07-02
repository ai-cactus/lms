import { describe, it, expect } from 'vitest';
import { resolveDateRange, startedAtWhere, toReportPeriod } from './date-range';

describe('resolveDateRange', () => {
  it('returns an empty object for an absent or empty range (no filter)', () => {
    expect(resolveDateRange(undefined)).toEqual({});
    expect(resolveDateRange(null)).toEqual({});
    expect(resolveDateRange({})).toEqual({});
    expect(resolveDateRange({ from: '', to: '' })).toEqual({});
  });

  it('anchors a bare "from" date to the start of its UTC day', () => {
    const { gte, lte } = resolveDateRange({ from: '2026-06-01' });
    expect(gte?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(lte).toBeUndefined();
  });

  it('anchors a bare "to" date to the end of its UTC day', () => {
    const { gte, lte } = resolveDateRange({ to: '2026-06-30' });
    expect(gte).toBeUndefined();
    expect(lte?.toISOString()).toBe('2026-06-30T23:59:59.999Z');
  });

  it('resolves a full range with inclusive day boundaries', () => {
    const { gte, lte } = resolveDateRange({ from: '2026-06-01', to: '2026-06-30' });
    expect(gte?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(lte?.toISOString()).toBe('2026-06-30T23:59:59.999Z');
  });

  it('accepts full ISO datetimes verbatim', () => {
    const { gte } = resolveDateRange({ from: '2026-06-01T09:30:00.000Z' });
    expect(gte?.toISOString()).toBe('2026-06-01T09:30:00.000Z');
  });

  it('throws when "from" is after "to"', () => {
    expect(() => resolveDateRange({ from: '2026-06-30', to: '2026-06-01' })).toThrow(
      /from.*before.*to/i,
    );
  });

  it('allows an equal from/to (single-day range)', () => {
    const { gte, lte } = resolveDateRange({ from: '2026-06-15', to: '2026-06-15' });
    expect(gte?.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(lte?.toISOString()).toBe('2026-06-15T23:59:59.999Z');
  });

  it('throws on an unparseable value', () => {
    expect(() => resolveDateRange({ from: 'not-a-date' })).toThrow(/invalid date value/i);
  });
});

describe('startedAtWhere', () => {
  it('returns no predicate for an empty range', () => {
    expect(startedAtWhere(undefined)).toEqual({});
    expect(startedAtWhere({ from: '', to: '' })).toEqual({});
  });

  it('builds a startedAt gte/lte predicate for a populated range', () => {
    const where = startedAtWhere({ from: '2026-06-01', to: '2026-06-30' });
    expect(where).toEqual({
      startedAt: {
        gte: new Date('2026-06-01T00:00:00.000Z'),
        lte: new Date('2026-06-30T23:59:59.999Z'),
      },
    });
  });

  it('produces boundaries that include in-range and exclude out-of-range enrollments', () => {
    const { startedAt } = startedAtWhere({ from: '2026-06-01', to: '2026-06-30' });
    const gte = startedAt!.gte!.getTime();
    const lte = startedAt!.lte!.getTime();
    const inRange = (d: string) => {
      const t = new Date(d).getTime();
      return t >= gte && t <= lte;
    };

    // In range — start, middle, and last instant of the window.
    expect(inRange('2026-06-01T00:00:00.000Z')).toBe(true);
    expect(inRange('2026-06-15T12:00:00.000Z')).toBe(true);
    expect(inRange('2026-06-30T23:59:59.999Z')).toBe(true);
    // Out of range — the day before and the day after.
    expect(inRange('2026-05-31T23:59:59.999Z')).toBe(false);
    expect(inRange('2026-07-01T00:00:00.000Z')).toBe(false);
  });
});

describe('toReportPeriod', () => {
  it('returns undefined for an empty range', () => {
    expect(toReportPeriod(undefined)).toBeUndefined();
    expect(toReportPeriod({ from: '', to: '' })).toBeUndefined();
  });

  it('normalizes a one-sided range, nulling the missing bound', () => {
    expect(toReportPeriod({ from: '2026-06-01' })).toEqual({ from: '2026-06-01', to: null });
    expect(toReportPeriod({ to: '2026-06-30' })).toEqual({ from: null, to: '2026-06-30' });
  });

  it('carries a full range through', () => {
    expect(toReportPeriod({ from: '2026-06-01', to: '2026-06-30' })).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
    });
  });
});
