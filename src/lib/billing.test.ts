/**
 * Unit tests for src/lib/billing.ts.
 *
 * ⛔ THE INVARIANT THAT MUST NOT BREAK: `hasActiveBilling()` is the single
 * choke point every access gate funnels through — worker portal, quiz submit,
 * enrollment, course-assign, auditor access — and it must read ONLY
 * `pausedAt`, never `pauseStartsAt`. A deferred pause (product decision
 * 2026-08-27) records intent via `pauseStartsAt` while the org keeps full
 * access until the sweep materializes it at the period boundary by setting
 * `pausedAt`. If `pauseStartsAt` ever leaks into `hasActiveBilling` or
 * `getPauseState`, every customer with a scheduled pause silently loses
 * access the moment they request it, instead of at the boundary they were
 * promised. The tests below are written to fail loudly if that regresses.
 */
import { describe, it, expect } from 'vitest';
import {
  hasActiveBilling,
  hasPendingPause,
  getPauseState,
  pauseEndDate,
  MAX_PAUSE_MONTHS,
  type BillingSubscriptionLike,
} from './billing';

const NOW = new Date('2026-08-27T12:00:00Z');

describe('⛔ hasActiveBilling — must never consult pauseStartsAt', () => {
  it('reports ACTIVE for a subscription with a pending pause (pauseStartsAt set, pausedAt null)', () => {
    const sub: BillingSubscriptionLike = {
      status: 'active',
      pauseStartsAt: new Date('2026-09-01T00:00:00Z'),
      pausedAt: null,
    };
    expect(hasActiveBilling(sub)).toBe(true);
  });

  it('reports ACTIVE for a trialing subscription with a pending pause', () => {
    const sub: BillingSubscriptionLike = {
      status: 'trialing',
      pauseStartsAt: new Date('2026-09-01T00:00:00Z'),
      pausedAt: null,
    };
    expect(hasActiveBilling(sub)).toBe(true);
  });

  it('reports ACTIVE even when pauseStartsAt is in the past relative to any clock — still not consulted', () => {
    const sub: BillingSubscriptionLike = {
      status: 'active',
      pauseStartsAt: new Date('2020-01-01T00:00:00Z'),
      pausedAt: null,
    };
    expect(hasActiveBilling(sub)).toBe(true);
  });

  it('reports INACTIVE once pausedAt is actually set, regardless of pauseStartsAt', () => {
    const sub: BillingSubscriptionLike = {
      status: 'active',
      pauseStartsAt: null,
      pausedAt: new Date('2026-08-01T00:00:00Z'),
    };
    expect(hasActiveBilling(sub)).toBe(false);
  });

  it('reports INACTIVE when both pausedAt and a (now-irrelevant) pauseStartsAt are set', () => {
    const sub: BillingSubscriptionLike = {
      status: 'active',
      pauseStartsAt: new Date('2026-09-01T00:00:00Z'),
      pausedAt: new Date('2026-09-01T00:00:00Z'),
    };
    expect(hasActiveBilling(sub)).toBe(false);
  });

  it('reports ACTIVE for a plain active subscription with neither pause field set', () => {
    expect(hasActiveBilling({ status: 'active', pauseStartsAt: null, pausedAt: null })).toBe(true);
  });

  it('reports INACTIVE for a canceled subscription even without any pause fields', () => {
    expect(hasActiveBilling({ status: 'canceled', pauseStartsAt: null, pausedAt: null })).toBe(
      false,
    );
  });

  it('reports INACTIVE for a null/undefined subscription', () => {
    expect(hasActiveBilling(null)).toBe(false);
    expect(hasActiveBilling(undefined)).toBe(false);
  });
});

describe('⛔ getPauseState — must never consult pauseStartsAt', () => {
  it("reports 'none' for a subscription with a pending pause (pauseStartsAt set, pausedAt null)", () => {
    const sub: BillingSubscriptionLike = {
      pauseStartsAt: new Date('2026-09-01T00:00:00Z'),
      pausedAt: null,
    };
    expect(getPauseState(sub, NOW)).toBe('none');
  });

  it("reports 'none' even when pauseStartsAt is already in the past relative to now", () => {
    const sub: BillingSubscriptionLike = {
      pauseStartsAt: new Date('2020-01-01T00:00:00Z'),
      pausedAt: null,
    };
    expect(getPauseState(sub, NOW)).toBe('none');
  });

  it("reports 'paused' once pausedAt is actually set and pauseEndsAt is in the future", () => {
    const sub: BillingSubscriptionLike = {
      pausedAt: new Date('2026-08-01T00:00:00Z'),
      pauseEndsAt: new Date('2026-11-01T00:00:00Z'),
    };
    expect(getPauseState(sub, NOW)).toBe('paused');
  });

  it("reports 'expired' once pausedAt is set and pauseEndsAt has elapsed", () => {
    const sub: BillingSubscriptionLike = {
      pausedAt: new Date('2026-05-01T00:00:00Z'),
      pauseEndsAt: new Date('2026-08-01T00:00:00Z'),
    };
    expect(getPauseState(sub, NOW)).toBe('expired');
  });

  it("reports 'none' for a null/undefined subscription", () => {
    expect(getPauseState(null, NOW)).toBe('none');
    expect(getPauseState(undefined, NOW)).toBe('none');
  });
});

describe('hasPendingPause', () => {
  it('is true when pauseStartsAt is set and pausedAt is null', () => {
    const sub: BillingSubscriptionLike = {
      pauseStartsAt: new Date('2026-09-01T00:00:00Z'),
      pausedAt: null,
    };
    expect(hasPendingPause(sub)).toBe(true);
  });

  it('is false once the pause is active (pausedAt set)', () => {
    const sub: BillingSubscriptionLike = {
      pauseStartsAt: new Date('2026-09-01T00:00:00Z'),
      pausedAt: new Date('2026-09-01T00:00:00Z'),
    };
    expect(hasPendingPause(sub)).toBe(false);
  });

  it('is false when neither pause field is set', () => {
    expect(hasPendingPause({ pauseStartsAt: null, pausedAt: null })).toBe(false);
  });

  it('is false for a null/undefined subscription', () => {
    expect(hasPendingPause(null)).toBe(false);
    expect(hasPendingPause(undefined)).toBe(false);
  });
});

describe('pauseEndDate', () => {
  it('adds whole months to the start date', () => {
    expect(pauseEndDate(new Date('2026-09-01T00:00:00Z'), 2)).toEqual(
      new Date('2026-11-01T00:00:00Z'),
    );
  });

  it(`clamps above ${MAX_PAUSE_MONTHS} months to the maximum`, () => {
    expect(pauseEndDate(new Date('2026-09-01T00:00:00Z'), 12)).toEqual(
      new Date('2026-12-01T00:00:00Z'),
    );
  });

  it('clamps below 1 month up to 1 month', () => {
    expect(pauseEndDate(new Date('2026-09-01T00:00:00Z'), 0)).toEqual(
      new Date('2026-10-01T00:00:00Z'),
    );
  });

  it('rounds a fractional month count', () => {
    expect(pauseEndDate(new Date('2026-09-01T00:00:00Z'), 1.6)).toEqual(
      new Date('2026-11-01T00:00:00Z'),
    );
  });
});
